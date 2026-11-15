#!/usr/bin/env python3
"""Baixa os focos VIIRS de 2026 na area da Bahia pela API de area do NASA FIRMS (precisa da MAP_KEY).

Os arquivos anuais por pais, usados de 2003 a 2025, ainda nao existem para 2026. Pela API:
- S-NPP: processamento padrao (SP) ate o fim do SP e quase tempo real (NRT) depois (o S-NPP parou em 02/11/2026);
- NOAA-20: SP ate o fim do SP e NRT depois (completa os meses em que falta S-NPP).
As datas de cada produto vem do endpoint data_availability da propria API.

A chave vem da variavel FIRMS_MAP_KEY (arquivo .env, fora do git) e nunca e impressa.
Saida: Dados/firms_2026/<produto>_<inicio>.csv (fora do git)

Uso: set -a; . ./.env; set +a; python3 -I Scripts/baixar_firms_2026.py
"""
import csv
import io
import os
import sys
import time
import urllib.request
from datetime import date, timedelta

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "Dados", "firms_2026")
API = "https://firms.modaps.eosdis.nasa.gov/api"
AREA = "-46.62,-18.35,-37.34,-8.53"   # oeste, sul, leste, norte (mesmo retangulo da serie)
INICIO = date(2026, 1, 1)
DIAS_POR_PEDIDO = 5
PRODUTOS = ["VIIRS_SNPP_SP", "VIIRS_SNPP_NRT", "VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"]


def pedir(url, tentativas=4):
    for k in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "regua-de-fogo"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001
            # a mensagem de erro pode trazer a URL com a chave: mostra so o tipo
            print("    tentativa %d falhou (%s)" % (k + 1, type(e).__name__), flush=True)
            time.sleep(5 * (k + 1))
    raise RuntimeError("pedido falhou depois de %d tentativas" % tentativas)


def main():
    chave = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if len(chave) != 32:
        sys.exit("defina FIRMS_MAP_KEY (arquivo .env)")
    os.makedirs(SAIDA, exist_ok=True)
    disp = {l["data_id"]: (date.fromisoformat(l["min_date"]), date.fromisoformat(l["max_date"]))
            for l in csv.DictReader(io.StringIO(pedir("%s/data_availability/csv/%s/all" % (API, chave))))}
    for p in PRODUTOS:
        ini, fim = disp[p]
        ini = max(ini, INICIO)
        print("%s: %s a %s" % (p, ini, fim), flush=True)
        d = ini
        while d <= fim:
            n = min(DIAS_POR_PEDIDO, (fim - d).days + 1)
            arq = os.path.join(SAIDA, "%s_%s.csv" % (p, d.isoformat()))
            if not os.path.exists(arq):
                texto = pedir("%s/area/csv/%s/%s/%s/%d/%s" % (API, chave, p, AREA, n, d.isoformat()))
                if not texto.startswith("latitude"):
                    raise RuntimeError("resposta inesperada para %s %s: %s" % (p, d, texto[:120].replace(chave, "***")))
                with open(arq, "w", encoding="utf-8") as f:
                    f.write(texto)
                time.sleep(0.5)
            d += timedelta(days=n)
    print("ok:", len(os.listdir(SAIDA)), "arquivos em", os.path.relpath(SAIDA, RAIZ))


if __name__ == "__main__":
    main()
