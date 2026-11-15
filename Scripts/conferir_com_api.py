#!/usr/bin/env python3
"""Confere os arquivos anuais baixados do FIRMS contra a API oficial (amostra de janelas de 5 dias).

Para cada ano, duas janelas de 5 dias em datas fixas (variam de ano para ano). Na mesma area e com os
mesmos filtros da serie, conta os focos dos arquivos locais e os da API (processamento padrao, SP):
MODIS Aqua e Terra de 2003 a 2025 e VIIRS S-NPP de 2012 a 2025. Se os arquivos estiverem certos, as
contagens batem. Confere o download e os filtros, nao o metodo de harmonizacao (esse foi validado
com anos escondidos e com o INPE).

A chave vem da variavel FIRMS_MAP_KEY (arquivo .env, fora do git) e nunca e impressa.
Saida: Dados/harmonizado/conferencia_api.json

Uso: set -a; . ./.env; set +a; python3 -I Scripts/conferir_com_api.py
"""
import csv
import io
import json
import os
import sys
import time
import urllib.request
from datetime import date, timedelta

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR_FIRMS = os.path.join(RAIZ, "Dados", "firms_bahia")
SAIDA = os.path.join(RAIZ, "Dados", "harmonizado", "conferencia_api.json")
API = "https://firms.modaps.eosdis.nasa.gov/api"
AREA = "-46.62,-18.35,-37.34,-8.53"
LON_MIN, LON_MAX, LAT_MIN, LAT_MAX = -46.62, -37.34, -18.35, -8.53
DIAS = 5


def pedir(url):
    for k in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "regua-de-fogo"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001
            print("    tentativa %d falhou (%s)" % (k + 1, type(e).__name__), flush=True)
            time.sleep(5 * (k + 1))
    raise RuntimeError("pedido falhou")


def conta(linhas, modis, ini, fim):
    """{satelite: (sem filtro, com filtros)} dentro do retangulo e da janela de datas."""
    out = {}
    for r in linhas:
        d = r.get("acq_date", "")
        if not (ini <= d <= fim):
            continue
        try:
            lat, lon = float(r["latitude"]), float(r["longitude"])
        except (KeyError, ValueError):
            continue
        if not (LON_MIN < lon < LON_MAX and LAT_MIN < lat < LAT_MAX):
            continue
        sat = (r.get("satellite") or "?").strip()
        sat = {"A": "Aqua", "T": "Terra"}.get(sat, sat)
        bruto, filtrado = out.get(sat, (0, 0))
        ok = (r.get("type", "0") or "0").strip() == "0"
        conf = (r.get("confidence") or "").strip()
        if modis:
            ok = ok and conf.isdigit() and int(conf) >= 30
        else:
            ok = ok and conf.lower() not in ("l", "low")
        out[sat] = (bruto + 1, filtrado + int(ok))
    return out


def main():
    chave = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if len(chave) != 32:
        sys.exit("defina FIRMS_MAP_KEY (arquivo .env)")
    resultados = []
    for ano in range(2003, 2026):
        janelas = [date(ano, 1, 1) + timedelta(days=(37 * ano) % 170), date(ano, 7, 1) + timedelta(days=(53 * ano) % 170)]
        alvos = [("modis", "MODIS_SP", True)]
        if ano >= 2012:
            alvos.append(("viirs-snpp", "VIIRS_SNPP_SP", False))
        for prefixo, produto, modis in alvos:
            arq = os.path.join(DIR_FIRMS, "%s_%d_bahia.csv" % (prefixo, ano))
            with open(arq, newline="", encoding="utf-8", errors="replace") as f:
                local = list(csv.DictReader(f))
            for ini in janelas:
                if produto == "VIIRS_SNPP_SP" and ini < date(2012, 1, 20):
                    continue
                fim = ini + timedelta(days=DIAS - 1)
                texto = pedir("%s/area/csv/%s/%s/%s/%d/%s" % (API, chave, produto, AREA, DIAS, ini.isoformat()))
                if not texto.startswith("latitude"):
                    print("  %s %s: resposta inesperada" % (produto, ini), flush=True)
                    continue
                api = list(csv.DictReader(io.StringIO(texto)))
                cl = conta(local, modis, ini.isoformat(), fim.isoformat())
                ca = conta(api, modis, ini.isoformat(), fim.isoformat())
                for sat in sorted(set(cl) | set(ca)):
                    l, a = cl.get(sat, (0, 0)), ca.get(sat, (0, 0))
                    resultados.append({"produto": produto, "satelite": sat, "inicio": ini.isoformat(), "fim": fim.isoformat(),
                                       "local_bruto": l[0], "api_bruto": a[0], "local_filtrado": l[1], "api_filtrado": a[1]})
                    marca = "ok" if l[1] == a[1] else "DIFERENTE"
                    print("  %s %-5s %s  local %6d  api %6d  %s" % (produto, sat, ini, l[1], a[1], marca), flush=True)
                time.sleep(0.5)
    iguais = sum(1 for r in resultados if r["local_filtrado"] == r["api_filtrado"])
    tl = sum(r["local_filtrado"] for r in resultados)
    ta = sum(r["api_filtrado"] for r in resultados)
    resumo = {"janelas_comparadas": len(resultados), "contagens_iguais": iguais,
              "focos_locais": tl, "focos_api": ta, "diferenca_pct": round((tl - ta) / ta * 100, 3) if ta else None}
    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with open(SAIDA, "w", encoding="utf-8") as f:
        json.dump({"resumo": resumo, "janelas": resultados}, f, ensure_ascii=False, indent=1)
    print(json.dumps(resumo, ensure_ascii=False))


if __name__ == "__main__":
    main()
