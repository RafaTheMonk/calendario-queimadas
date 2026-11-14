"""Regras comuns da harmonizacao MODIS x VIIRS (focos de calor, Bahia).

Leitura dos CSV do FIRMS, filtros, contagem mensal, dias sem dado,
sinalizacao de meses e definicao dos periodos.
"""
import csv
import glob
import math
import os
from collections import defaultdict

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIR_FIRMS = os.path.join(RAIZ, "Dados", "firms_bahia")
DIR_COBERTURA = os.path.join(DIR_FIRMS, "cobertura")
DIR_SAIDA = os.path.join(RAIZ, "Dados", "harmonizado")

# Retangulo estrito (limites nao incluidos)
LON_MIN, LON_MAX = -46.62, -37.34
LAT_MIN, LAT_MAX = -18.35, -8.53

GRADES = (0.01, 0.05, 0.1)   # tamanhos de celula em graus (a principal e 0,05)
G_PRINCIPAL = 0.05
LIMITE_DIAS_SEM_DADO = 3


def lista_meses(ini, fim):
    """Lista de 'AAAA-MM' de ini a fim, inclusive."""
    a, m = int(ini[:4]), int(ini[5:7])
    af, mf = int(fim[:4]), int(fim[5:7])
    saida = []
    while (a, m) <= (af, mf):
        saida.append("%04d-%02d" % (a, m))
        m += 1
        if m == 13:
            a, m = a + 1, 1
    return saida


MESES_SERIE = lista_meses("2003-01", "2025-12")        # 276 meses da serie final
MESES_CALIB = lista_meses("2012-02", "2019-12")        # calibracao das metricas
MESES_TESTE = lista_meses("2020-01", "2023-12")        # teste (metrica principal)
MESES_DERIVA = lista_meses("2024-01", "2025-12")       # deriva (reportar separado)
MESES_PRODUCAO = lista_meses("2012-02", "2023-12")     # calibracao de producao
PRIMEIRO_MES_VIIRS = "2012-02"                         # a partir daqui o VIIRS real entra na serie


def mes_do_ano(mes):
    return int(mes[5:7])


# ---------------------------------------------------------------- leitura

def _arquivos(prefixo):
    return sorted(glob.glob(os.path.join(DIR_FIRMS, prefixo + "_*_bahia.csv")))


def carregar(sensor, grades=GRADES):
    """Le todos os anos de um satelite do par principal e conta por mes.

    sensor: 'aqua' (arquivos modis, satellite == 'Aqua') ou 'snpp'
            (arquivos viirs-snpp, satellite == 'N').
    Retorna dict com:
      focos: {mes: n focos}
      celulas: {g: {mes: n de pares unicos (celula, data)}}
      lidos / descartados: contagem de linhas
    """
    if sensor == "aqua":
        arquivos, sat_ok, modis = _arquivos("modis"), "Aqua", True
    elif sensor == "snpp":
        arquivos, sat_ok, modis = _arquivos("viirs-snpp"), "N", False
    else:
        raise ValueError(sensor)
    focos = defaultdict(int)
    conjuntos = {g: defaultdict(set) for g in grades}
    lidos = descartados = 0
    for caminho in arquivos:
        with open(caminho, newline="", encoding="utf-8", errors="replace") as f:
            leitor = csv.reader(f)
            cab = next(leitor)
            ix = {c: i for i, c in enumerate(cab)}
            n_campos = len(cab)
            i_lat, i_lon = ix["latitude"], ix["longitude"]
            i_data, i_sat = ix["acq_date"], ix["satellite"]
            i_conf, i_tipo = ix["confidence"], ix["type"]
            for linha in leitor:
                lidos += 1
                if len(linha) != n_campos:      # linha final truncada
                    descartados += 1
                    continue
                try:
                    lat, lon = float(linha[i_lat]), float(linha[i_lon])
                    data = linha[i_data]
                    if len(data) != 10 or data[4] != "-":
                        raise ValueError
                    if linha[i_sat] != sat_ok or linha[i_tipo] != "0":
                        continue
                    if modis:
                        if int(linha[i_conf]) < 30:
                            continue
                    elif linha[i_conf] == "l":
                        continue
                except ValueError:
                    descartados += 1
                    continue
                if not (LON_MIN < lon < LON_MAX and LAT_MIN < lat < LAT_MAX):
                    continue
                mes = data[:7]
                focos[mes] += 1
                for g in grades:
                    conjuntos[g][mes].add((math.floor(lat / g), math.floor(lon / g), data))
    celulas = {g: {m: len(s) for m, s in conjuntos[g].items()} for g in grades}
    return {"focos": dict(focos), "celulas": celulas, "lidos": lidos, "descartados": descartados}


# ---------------------------------------------------------------- cobertura

def _datas_cobertura(prefixo, satelite):
    datas = set()
    for caminho in sorted(glob.glob(os.path.join(DIR_COBERTURA, prefixo + "_*.csv"))):
        with open(caminho, newline="", encoding="utf-8") as f:
            leitor = csv.reader(f)
            next(leitor, None)
            for linha in leitor:
                if len(linha) < 4 or linha[1] != satelite or len(linha[0]) != 10:
                    continue
                datas.add(linha[0])
    return datas


def _dias_do_mes(mes):
    a, m = int(mes[:4]), int(mes[5:7])
    if m == 12:
        n = 31
    else:
        import datetime
        n = (datetime.date(a, m + 1, 1) - datetime.date(a, m, 1)).days
    return ["%s-%02d" % (mes, d) for d in range(1, n + 1)]


def dias_sem_dado(prefixo, satelite, meses):
    """{mes: dias sem dado}. None se o satelite ainda nao operava no mes inteiro.

    Dia sem dado = data entre a primeira e a ultima data da cobertura que nao
    aparece na cobertura. Mes parcial no inicio da operacao conta so a partir
    da primeira data.
    """
    datas = _datas_cobertura(prefixo, satelite)
    primeira, ultima = min(datas), max(datas)
    saida = {}
    for mes in meses:
        dias = [d for d in _dias_do_mes(mes) if primeira <= d <= ultima]
        saida[mes] = None if not dias else sum(1 for d in dias if d not in datas)
    return saida


def sinalizar(sem_aqua, sem_viirs, meses):
    """Mes sinalizado se Aqua ou S-NPP tiver 3 ou mais dias sem dado.

    Antes do inicio do S-NPP (anterior a 2012-02) so o Aqua conta.
    """
    sinal = {}
    for mes in meses:
        a = sem_aqua.get(mes) or 0
        v = sem_viirs.get(mes) or 0
        sinal[mes] = a >= LIMITE_DIAS_SEM_DADO or (mes >= PRIMEIRO_MES_VIIRS and v >= LIMITE_DIAS_SEM_DADO)
    return sinal
