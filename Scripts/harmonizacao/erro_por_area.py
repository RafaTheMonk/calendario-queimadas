#!/usr/bin/env python3
"""Erro da conversao por tamanho de area, no mesmo teste da Bahia (calibra 2012-2019, preve 2020-2023).

As taxas por mes do ano sao as da Bahia inteira (como o site faz numa area desenhada) e o erro e
medido contra o VIIRS S-NPP real de cada area, nos meses validos do teste (sem falha de satelite).
Escalas: uma celula da grade NASA POWER (0,5 x 0,625 grau, cerca de 55 x 68 km), blocos de 2 x 2 e
de 4 x 4 celulas, e a Bahia inteira. Antes de 2012 nao ha VIIRS para medir o erro; o numero de
2020-2023 e a melhor referencia para o passado.

Entrada: Dados/harmonizado/fatores/tabela_celula_mes.csv e os arquivos de cobertura do FIRMS
Saida: Dados/harmonizado/erro_por_area.json

Uso: python3 -I Scripts/harmonizacao/erro_por_area.py
"""
import csv
import json
import os
import statistics
import sys
from collections import defaultdict

AQUI = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(AQUI)
for p in (AQUI, SCRIPTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import comum  # noqa: E402
import gerar_json_site  # noqa: E402

TABELA = os.path.join(comum.DIR_SAIDA, "fatores", "tabela_celula_mes.csv")
SAIDA = os.path.join(comum.DIR_SAIDA, "erro_por_area.json")
MIN_FOCOS_AREA = 2000   # para a mediana por area: so areas com fogo suficiente no teste


def ler_tabela():
    v, a = defaultdict(dict), defaultdict(dict)
    with open(TABELA, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            c, m = r["celula"], r["mes"]
            v[c][m] = float(r["V_snpp"] or 0)
            a[c][m] = float(r["A_aqua"] or 0)
    return v, a


def bloco(celula, lado):
    lin, col = int(celula[1:3]), int(celula[4:6])
    return "B%02d_%02d" % (lin // lado, col // lado)


def main():
    meses = comum.MESES_SERIE
    degr = gerar_json_site.dias_degradados_aqua()
    sem_aqua = comum.dias_sem_dado("modis", "Aqua", meses)
    sem_aqua_tot = {m: (sem_aqua[m] or 0) + degr.get(m, 0) for m in meses}
    sem_snpp = comum.dias_sem_dado("viirs-snpp", "N", meses)
    sinal = comum.sinalizar(sem_aqua_tot, sem_snpp, meses)
    calib = [m for m in comum.MESES_CALIB if not sinal[m]]
    teste = [m for m in comum.MESES_TESTE if not sinal[m]]

    v, a = ler_tabela()
    celulas = sorted(v)

    # taxas da Bahia inteira, por mes do ano, so com a calibracao (como no teste principal)
    sv, sa = defaultdict(float), defaultdict(float)
    for m in calib:
        k = int(m[5:7])
        sv[k] += sum(v[c][m] for c in celulas)
        sa[k] += sum(a[c][m] for c in celulas)
    taxa = {k: sv[k] / sa[k] for k in sv}

    escalas = [
        ("celula", "1 célula, cerca de 55 x 68 km", lambda c: c),
        ("bloco_2x2", "2 x 2 células, cerca de 110 x 135 km", lambda c: bloco(c, 2)),
        ("bloco_4x4", "4 x 4 células, cerca de 220 x 270 km", lambda c: bloco(c, 4)),
        ("bahia", "Bahia inteira", lambda c: "BA"),
    ]
    resultado = []
    for chave, nome, agrupar in escalas:
        grupos = defaultdict(list)
        for c in celulas:
            grupos[agrupar(c)].append(c)
        soma_erro = soma_real = 0.0
        por_area = []
        for cs in grupos.values():
            e_area = r_area = 0.0
            for m in teste:
                real = sum(v[c][m] for c in cs)
                prev = taxa[int(m[5:7])] * sum(a[c][m] for c in cs)
                e_area += abs(prev - real)
                r_area += real
            soma_erro += e_area
            soma_real += r_area
            if r_area >= MIN_FOCOS_AREA:
                por_area.append(100 * e_area / r_area)
        resultado.append({
            "escala": chave, "descricao": nome,
            "celulas_por_area": max(len(cs) for cs in grupos.values()),
            "n_areas": len(grupos),
            "erro_mensal_wape_pct": round(100 * soma_erro / soma_real, 1),
            "mediana_por_area_pct": round(statistics.median(por_area), 1) if por_area else None,
            "n_areas_na_mediana": len(por_area),
        })

    saida = {
        "descricao": ("Erro mensal (WAPE) da conversão por mês do ano quando aplicada a áreas menores que a Bahia. "
                      "Taxas da Bahia inteira calibradas em 2012-2019, erro medido contra o VIIRS real em 2020-2023."),
        "periodo_calibracao": [calib[0], calib[-1]],
        "periodo_teste": [teste[0], teste[-1]],
        "n_meses_teste": len(teste),
        "min_focos_para_mediana": MIN_FOCOS_AREA,
        "escalas": resultado,
    }
    with open(SAIDA, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)
        f.write("\n")
    for r in resultado:
        print("%-10s %3d áreas  erro %5.1f%%  mediana por área %s" % (
            r["escala"], r["n_areas"], r["erro_mensal_wape_pct"], r["mediana_por_area_pct"]))
    print("meses de teste:", len(teste), "| gravado em", SAIDA)


if __name__ == "__main__":
    main()
