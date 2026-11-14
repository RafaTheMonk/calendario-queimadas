"""Monta a tabela celula x mes do modelo com fatores (fase A).

Celula = ponto da grade da NASA POWER (0,5 grau de latitude por 0,625 de
longitude). Cada foco vai para o ponto mais proximo. Le os CSV do FIRMS
com os mesmos filtros de comum.py e junta o clima da NASA POWER.

Saida (matrizes densas celula x mes, 276 meses de 2003-01 a 2025-12):
  V (S-NPP), A (Aqua), T (Terra), N20 (NOAA-20), e para Aqua e Terra:
  FRP medio, fracao noturna, scan medio, hora media diurna (UTC),
  mais chuva, vento, umidade, temperatura e altitude.

Uso direto: python3 -I Scripts/harmonizacao/fatores/montar_tabela.py
Grava Dados/harmonizado/fatores/tabela_celula_mes.csv
"""
import csv
import glob
import json
import os
import sys

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))   # Scripts/harmonizacao
import comum  # noqa: E402

RAIZ = comum.RAIZ
DIR_POWER = os.path.join(RAIZ, "Dados", "nasa_power")
DIR_SAIDA = os.path.join(comum.DIR_SAIDA, "fatores")

MESES = comum.MESES_SERIE                      # 276 meses
IDX_MES = {m: i for i, m in enumerate(MESES)}
NM = len(MESES)
LON0, DLON, NLON = -46.875, 0.625, 16
LAT0, DLAT, NLAT = -18.5, 0.5, 21
NC_TODAS = NLON * NLAT                          # 336 pontos da grade
PARAMETROS = {"chuva": "PRECTOTCORR", "vento": "WS10M", "umidade": "RH2M", "temperatura": "T2M"}


def indice_celula(lon, lat):
    """Ponto da grade mais proximo (indice linha * 16 + coluna)."""
    j = min(max(int(round((lon - LON0) / DLON)), 0), NLON - 1)
    i = min(max(int(round((lat - LAT0) / DLAT)), 0), NLAT - 1)
    return i * NLON + j


def _acumulador():
    return {k: np.zeros(NC_TODAS * NM) for k in ("n", "frp", "noite", "scan", "dia", "hora")}


def _ler_arquivo(caminho, modis, sat_ok, acc_por_sat, contagem):
    """Acumula um CSV anual. acc_por_sat: {satelite: acumulador} (MODIS) ou contagem (VIIRS)."""
    with open(caminho, newline="", encoding="utf-8", errors="replace") as f:
        leitor = csv.reader(f)
        cab = next(leitor)
        ix = {c: i for i, c in enumerate(cab)}
        n_campos = len(cab)
        i_lat, i_lon, i_data = ix["latitude"], ix["longitude"], ix["acq_date"]
        i_sat, i_conf, i_tipo = ix["satellite"], ix["confidence"], ix["type"]
        i_frp, i_scan, i_dn, i_hora = ix["frp"], ix["scan"], ix["daynight"], ix["acq_time"]
        celulas, meses, frps, scans, noites, horas = [], [], [], [], [], []
        sats = []
        for linha in leitor:
            if len(linha) != n_campos:
                continue
            try:
                lat, lon = float(linha[i_lat]), float(linha[i_lon])
                data = linha[i_data]
                if len(data) != 10 or data[4] != "-":
                    continue
                sat = linha[i_sat]
                if sat not in sat_ok or linha[i_tipo] != "0":
                    continue
                if modis:
                    if int(linha[i_conf]) < 30:
                        continue
                elif linha[i_conf] == "l":
                    continue
                if not (comum.LON_MIN < lon < comum.LON_MAX and comum.LAT_MIN < lat < comum.LAT_MAX):
                    continue
                mes = IDX_MES.get(data[:7])
                if mes is None:
                    continue
                if modis:
                    frp, scan = float(linha[i_frp]), float(linha[i_scan])
                    hhmm = linha[i_hora]
                    hora = int(hhmm[:2]) + int(hhmm[2:4]) / 60.0
            except (ValueError, IndexError):
                continue
            celulas.append(indice_celula(lon, lat) * NM + mes)
            if modis:
                sats.append(sat)
                frps.append(frp)
                scans.append(scan)
                noites.append(1 if linha[i_dn] == "N" else 0)
                horas.append(hora)
    celulas = np.array(celulas, dtype=np.int64)
    if not modis:
        contagem += np.bincount(celulas, minlength=NC_TODAS * NM)
        return
    sats = np.array(sats)
    frps, scans = np.array(frps), np.array(scans)
    noites, horas = np.array(noites), np.array(horas)
    for sat, acc in acc_por_sat.items():
        s = sats == sat
        c = celulas[s]
        dia = noites[s] == 0
        acc["n"] += np.bincount(c, minlength=NC_TODAS * NM)
        acc["frp"] += np.bincount(c, weights=frps[s], minlength=NC_TODAS * NM)
        acc["noite"] += np.bincount(c, weights=noites[s], minlength=NC_TODAS * NM)
        acc["scan"] += np.bincount(c, weights=scans[s], minlength=NC_TODAS * NM)
        acc["dia"] += np.bincount(c[dia], minlength=NC_TODAS * NM)
        acc["hora"] += np.bincount(c[dia], weights=horas[s][dia], minlength=NC_TODAS * NM)


def ler_firms():
    """Le todos os CSV de 2003 a 2025 e devolve as matrizes (336 x 276)."""
    aqua, terra = _acumulador(), _acumulador()
    snpp = np.zeros(NC_TODAS * NM)
    n20 = np.zeros(NC_TODAS * NM)
    lidos = {}
    for ano in range(2003, 2026):
        _ler_arquivo(os.path.join(comum.DIR_FIRMS, "modis_%d_bahia.csv" % ano), True,
                     {"Aqua", "Terra"}, {"Aqua": aqua, "Terra": terra}, None)
        if ano >= 2012:
            _ler_arquivo(os.path.join(comum.DIR_FIRMS, "viirs-snpp_%d_bahia.csv" % ano), False, {"N"}, None, snpp)
        if ano >= 2018:
            _ler_arquivo(os.path.join(comum.DIR_FIRMS, "viirs-jpss1_%d_bahia.csv" % ano), False, {"N20"}, None, n20)
        print("  lido", ano, flush=True)

    def moda(acc):
        n = acc["n"].reshape(NC_TODAS, NM)
        dia = acc["dia"].reshape(NC_TODAS, NM)
        with np.errstate(invalid="ignore", divide="ignore"):
            frp = np.where(n > 0, acc["frp"].reshape(NC_TODAS, NM) / n, np.nan)
            return {"n": n,
                    "frp_medio": frp,
                    "frac_noturna": np.where(n > 0, acc["noite"].reshape(NC_TODAS, NM) / n, np.nan),
                    "scan_medio": np.where(n > 0, acc["scan"].reshape(NC_TODAS, NM) / n, np.nan),
                    "hora_dia": np.where(dia > 0, acc["hora"].reshape(NC_TODAS, NM) / dia, np.nan)}
    return {"V": snpp.reshape(NC_TODAS, NM), "N20": n20.reshape(NC_TODAS, NM),
            "aqua": moda(aqua), "terra": moda(terra)}


def ler_power():
    """Clima mensal e altitude por ponto da grade. Devolve (dict nome -> 336x276, lon, lat, alt)."""
    clima = {}
    lon = np.full(NC_TODAS, np.nan)
    lat = np.full(NC_TODAS, np.nan)
    alt = np.full(NC_TODAS, np.nan)
    for nome, par in PARAMETROS.items():
        with open(os.path.join(DIR_POWER, "power_%s_2003_2025.json" % par), encoding="utf-8") as f:
            dados = json.load(f)
        mat = np.full((NC_TODAS, NM), np.nan)
        for feat in dados["features"]:
            x, y, z = feat["geometry"]["coordinates"]
            c = indice_celula(x, y)
            lon[c], lat[c], alt[c] = x, y, z
            for chave, v in feat["properties"]["parameter"][par].items():
                mes = chave[:4] + "-" + chave[4:]
                if chave.endswith("13") or mes not in IDX_MES:   # AAAA13 = media anual
                    continue
                mat[c, IDX_MES[mes]] = np.nan if v <= -900 else v
        clima[nome] = mat
    return clima, lon, lat, alt


def montar(usar_cache=True):
    """Tabela completa (so celulas do dominio). Devolve dict de matrizes e metadados."""
    firms = ler_firms()
    clima, lon, lat, alt = ler_power()
    # dominio: pontos que viram ao menos um foco MODIS (Aqua ou Terra) em 2003-2025.
    # E so uma mascara geografica (tira o mar), sem usar informacao do VIIRS.
    modis_total = firms["aqua"]["n"].sum(axis=1) + firms["terra"]["n"].sum(axis=1)
    dominio = np.where(modis_total > 0)[0]
    tab = {"celulas": dominio, "lon": lon[dominio], "lat": lat[dominio], "altitude": alt[dominio],
           "V": firms["V"][dominio], "N20": firms["N20"][dominio],
           "A": firms["aqua"]["n"][dominio], "T": firms["terra"]["n"][dominio]}
    for sat in ("aqua", "terra"):
        for k in ("frp_medio", "frac_noturna", "scan_medio", "hora_dia"):
            tab["%s_%s" % (sat, k)] = firms[sat][k][dominio]
    for k, mat in clima.items():
        tab[k] = mat[dominio]
    tab["fora_dominio"] = {"V": float(firms["V"].sum() - tab["V"].sum()),
                           "A": float(firms["aqua"]["n"].sum() - tab["A"].sum()),
                           "N20": float(firms["N20"].sum() - tab["N20"].sum()),
                           "V_total": float(firms["V"].sum())}
    return tab


COLUNAS = ["celula", "lon", "lat", "altitude_m", "mes", "V_snpp", "A_aqua", "T_terra", "N20",
           "chuva_mm_dia", "vento_m_s", "umidade_pct", "temperatura_c",
           "aqua_frp_medio", "aqua_frac_noturna", "aqua_scan_medio", "aqua_hora_dia_utc",
           "terra_frp_medio", "terra_frac_noturna", "terra_scan_medio", "terra_hora_dia_utc"]


def salvar_csv(tab, caminho):
    """Uma linha por celula e mes (celula e mes sem nenhum foco tambem entram: contam como zero)."""
    def f(x, nd):
        return "" if not np.isfinite(x) else ("%.*f" % (nd, x))
    nc = len(tab["celulas"])
    with open(caminho, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(COLUNAS)
        for c in range(nc):
            for m in range(NM):
                w.writerow(["L%02dC%02d" % (tab["celulas"][c] // NLON, tab["celulas"][c] % NLON),
                            "%.3f" % tab["lon"][c], "%.2f" % tab["lat"][c], "%.1f" % tab["altitude"][c], MESES[m],
                            int(tab["V"][c, m]), int(tab["A"][c, m]), int(tab["T"][c, m]), int(tab["N20"][c, m]),
                            f(tab["chuva"][c, m], 2), f(tab["vento"][c, m], 2), f(tab["umidade"][c, m], 2),
                            f(tab["temperatura"][c, m], 2),
                            f(tab["aqua_frp_medio"][c, m], 2), f(tab["aqua_frac_noturna"][c, m], 3),
                            f(tab["aqua_scan_medio"][c, m], 3), f(tab["aqua_hora_dia"][c, m], 3),
                            f(tab["terra_frp_medio"][c, m], 2), f(tab["terra_frac_noturna"][c, m], 3),
                            f(tab["terra_scan_medio"][c, m], 3), f(tab["terra_hora_dia"][c, m], 3)])


if __name__ == "__main__":
    tabela = montar()
    os.makedirs(DIR_SAIDA, exist_ok=True)
    salvar_csv(tabela, os.path.join(DIR_SAIDA, "tabela_celula_mes.csv"))
    print("celulas no dominio:", len(tabela["celulas"]), "| fora do dominio:", tabela["fora_dominio"])
