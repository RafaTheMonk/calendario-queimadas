#!/usr/bin/env python3
"""Replica o metodo da Regua de Fogo em outro pais (prova de que ele se recalibra sozinho).

Mesmas regras usadas na Bahia, sem nada calibrado na Bahia:
- arquivos anuais do NASA FIRMS do pais (MODIS C6.1, VIIRS S-NPP e NOAA-20);
- so vegetacao (type = 0), MODIS com confianca 30 ou mais, VIIRS sem confianca baixa;
- mes sinalizado (fora da calibracao e do teste) quando o Aqua ou o S-NPP tem 3 dias ou mais sem dado
  (dia em que o outro satelite do mesmo sensor viu fogo e ele nao) ou com dado degradado
  (razao diaria Aqua/S-NPP abaixo de 0,25 vez a mediana do mes);
- taxa por mes do ano (VIIRS / Aqua) aprendida em 2012-02 a 2019-12 e testada em 2020 a 2023;
- prova extra escondendo um ano de cada vez (2013 a 2023) e taxa unica como comparacao.

Uso: python3 -I Scripts/replicar_regiao.py Argentina
Saida: Dados/regioes/<pais>/ (arquivos brutos, fora do git) e Dados/regioes/<pais>.json (resumo)
"""
import calendar
import csv
import json
import os
import statistics
import sys
import time
import urllib.request
from collections import Counter, defaultdict

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://firms.modaps.eosdis.nasa.gov/data/country"
ARQUIVOS = [("modis", a) for a in range(2003, 2026)] + [("viirs-snpp", a) for a in range(2012, 2026)] + \
           [("viirs-jpss1", a) for a in range(2018, 2026)]
LIMITE_DIAS = 3
FATOR_DEGRADADO = 0.25


def meses(ini, fim):
    a, m = int(ini[:4]), int(ini[5:7])
    out = []
    while "%04d-%02d" % (a, m) <= fim:
        out.append("%04d-%02d" % (a, m))
        m += 1
        if m == 13:
            a, m = a + 1, 1
    return out


def baixar(pais, pasta):
    os.makedirs(pasta, exist_ok=True)
    for sensor, ano in ARQUIVOS:
        arq = os.path.join(pasta, "%s_%d.csv" % (sensor, ano))
        if os.path.exists(arq) and os.path.getsize(arq) > 0:
            continue
        url = "%s/%s/%d/%s_%d_%s.csv" % (BASE, sensor, ano, sensor, ano, pais)
        for k in range(4):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "regua-de-fogo"})
                with urllib.request.urlopen(req, timeout=600) as r, open(arq + ".parcial", "wb") as f:
                    while True:
                        bloco = r.read(1 << 20)
                        if not bloco:
                            break
                        f.write(bloco)
                os.replace(arq + ".parcial", arq)
                print("  baixado %s %d (%.1f MB)" % (sensor, ano, os.path.getsize(arq) / 1e6), flush=True)
                break
            except Exception as e:  # noqa: BLE001
                print("  %s %d: tentativa %d falhou (%s)" % (sensor, ano, k + 1, e), flush=True)
                time.sleep(10 * (k + 1))


def contar(pasta):
    """focos[sat][mes] com filtros e dia[sat][data] sem filtro de confianca (para cobertura)."""
    focos, dia = defaultdict(Counter), defaultdict(Counter)
    for sensor, ano in ARQUIVOS:
        arq = os.path.join(pasta, "%s_%d.csv" % (sensor, ano))
        if not os.path.exists(arq):
            continue
        with open(arq, newline="", encoding="utf-8", errors="replace") as f:
            for r in csv.DictReader(f):
                sat = {"Aqua": "aqua", "Terra": "terra", "N": "snpp", "N20": "n20", "1": "n20"}.get((r.get("satellite") or "").strip())
                if not sat:
                    continue
                d = r.get("acq_date", "")
                dia[sat][d] += 1
                if (r.get("type") or "0").strip() != "0":
                    continue
                conf = (r.get("confidence") or "").strip()
                if sensor == "modis":
                    if not conf.isdigit() or int(conf) < 30:
                        continue
                elif conf.lower() in ("l", "low"):
                    continue
                focos[sat][d[:7]] += 1
    return focos, dia


def sinalizar(dia, todos):
    sinal = {}
    razoes = defaultdict(dict)
    for d, v in dia["snpp"].items():
        if v > 0 and d in dia["aqua"]:
            razoes[d[:7]][d] = dia["aqua"][d] / v
    for m in todos:
        a, k = int(m[:4]), int(m[5:7])
        datas = ["%s-%02d" % (m, x) for x in range(1, calendar.monthrange(a, k)[1] + 1)]
        sem_aqua = sum(1 for d in datas if dia["aqua"][d] == 0 and dia["terra"][d] > 0)
        sem_snpp = sum(1 for d in datas if dia["snpp"][d] == 0 and dia["n20"][d] > 0) if m >= "2018-04" else 0
        degr = 0
        if razoes[m]:
            med = statistics.median(razoes[m].values())
            degr = sum(1 for r in razoes[m].values() if r < FATOR_DEGRADADO * med)
        sinal[m] = (sem_aqua + degr) >= LIMITE_DIAS or sem_snpp >= LIMITE_DIAS
    return sinal


def taxas(cal, aqua, viirs):
    sv, sa = Counter(), Counter()
    for m in cal:
        sv[int(m[5:7])] += viirs[m]
        sa[int(m[5:7])] += aqua[m]
    return {k: sv[k] / sa[k] for k in range(1, 13) if sa[k]}


def wape(ms, prev, real):
    return sum(abs(prev[m] - real[m]) for m in ms) / sum(real[m] for m in ms) * 100


def main():
    pais = sys.argv[1] if len(sys.argv) > 1 else "Argentina"
    pasta = os.path.join(RAIZ, "Dados", "regioes", pais.lower())
    print("baixando os arquivos anuais do FIRMS para %s..." % pais, flush=True)
    baixar(pais, pasta)
    focos, dia = contar(pasta)
    todos = meses("2003-01", "2025-12")
    aqua = {m: focos["aqua"][m] for m in todos}
    viirs = {m: focos["snpp"][m] for m in todos}
    sinal = sinalizar(dia, todos)
    validos = [m for m in todos if "2012-02" <= m <= "2023-12" and not sinal[m] and aqua[m] > 0 and viirs[m] > 0]
    cal = [m for m in validos if m <= "2019-12"]
    teste = [m for m in validos if m >= "2020-01"]
    deriva = [m for m in todos if m >= "2024-01" and not sinal[m] and aqua[m] > 0]

    r1 = taxas(cal, aqua, viirs)
    p1 = {m: r1.get(int(m[5:7]), 0) * aqua[m] for m in todos}
    unica = sum(viirs[m] for m in cal) / sum(aqua[m] for m in cal)
    p0 = {m: unica * aqua[m] for m in todos}
    vies = (sum(p1[m] for m in teste) - sum(viirs[m] for m in teste)) / sum(viirs[m] for m in teste) * 100

    loyo, loyo0 = {}, {}
    for a in range(2013, 2024):
        c = [m for m in validos if m[:4] != str(a)]
        r = taxas(c, aqua, viirs)
        u = sum(viirs[m] for m in c) / sum(aqua[m] for m in c)
        for m in validos:
            if m[:4] == str(a):
                loyo[m] = r.get(int(m[5:7]), 0) * aqua[m]
                loyo0[m] = u * aqua[m]

    # serie anual harmonizada (taxas de producao 2012-02 a 2021-12) e serie sem harmonizar
    prod = [m for m in validos if m <= "2021-12"]
    rp = taxas(prod, aqua, viirs)
    harm = {m: (viirs[m] if m >= "2012-02" else rp.get(int(m[5:7]), 0) * aqua[m]) for m in todos}
    crua = {m: (viirs[m] if m >= "2012-02" else aqua[m]) for m in todos}
    anual = {a: round(sum(harm[m] for m in todos if m[:4] == str(a))) for a in range(2003, 2026)}
    anual_cru = {a: sum(crua[m] for m in todos if m[:4] == str(a)) for a in range(2003, 2026)}

    bahia = json.load(open(os.path.join(RAIZ, "site", "data", "calendario_bahia.json"), encoding="utf-8"))["metodo"]["taxa_por_mes"]
    saida = {
        "pais": pais,
        "focos_filtrados": {"aqua": sum(aqua.values()), "snpp": sum(viirs.values())},
        "meses_sinalizados": [m for m in todos if sinal[m] and m >= "2012-02"],
        "n_meses_teste": len(teste),
        "taxa_por_mes": {"%02d" % k: round(v, 3) for k, v in sorted(r1.items())},
        "taxa_por_mes_bahia": bahia,
        "taxa_unica": round(unica, 3),
        "teste_erro_pct": round(wape(teste, p1, viirs), 2),
        "teste_vies_pct": round(vies, 2),
        "teste_erro_taxa_unica_pct": round(wape(teste, p0, viirs), 2),
        "um_ano_fora_erro_pct": round(wape(list(loyo), loyo, viirs), 2),
        "um_ano_fora_erro_taxa_unica_pct": round(wape(list(loyo0), loyo0, viirs), 2),
        "deriva_2024_2025_erro_pct": round(wape(deriva, p1, viirs), 2) if deriva else None,
        "salto_sem_harmonizar_2011_2012": round(anual_cru[2012] / anual_cru[2011], 2) if anual_cru[2011] else None,
        "anual_harmonizado": anual,
        "anual_sem_harmonizar": anual_cru,
        "ano_com_mais_fogo": max(anual, key=anual.get),
    }
    destino = os.path.join(RAIZ, "Dados", "regioes", "%s.json" % pais.lower())
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in saida.items() if k not in ("anual_harmonizado", "anual_sem_harmonizar")}, ensure_ascii=False, indent=1))
    print("anual harmonizado:", anual)
    print("anual sem harmonizar:", anual_cru)


if __name__ == "__main__":
    main()
