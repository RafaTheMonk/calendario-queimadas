#!/usr/bin/env python3
"""Confere a completude dos focos baixados por baixar_firms_bahia.sh.

Parte A (Brasil inteiro): para cada sensor e satelite, dias com dado, buracos
de dias seguidos sem nenhum foco no pais (provavel falta de dado) e cobertura por ano.

Parte B (retangulo da Bahia, com filtros): focos por ano e por satelite e a
proporcao VIIRS / MODIS Aqua, so como primeira olhada.

Uso: python3 Scripts/completude_firms.py [pasta]   (padrao: Dados/firms_bahia)
Grava o relatorio em <pasta>/relatorio_completude.md
"""
import csv
import glob
import os
import sys
from collections import defaultdict
from datetime import date, timedelta

PASTA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "Dados", "firms_bahia")
NOME_SAT = {"Terra": "MODIS Terra", "Aqua": "MODIS Aqua", "T": "MODIS Terra", "A": "MODIS Aqua",
            "N": "VIIRS S-NPP", "N20": "VIIRS NOAA-20", "1": "VIIRS NOAA-20", "J1": "VIIRS NOAA-20",
            "N21": "VIIRS NOAA-21", "2": "VIIRS NOAA-21"}

saida = []


def p(linha=""):
    saida.append(linha)


def d(s):
    return date.fromisoformat(s)


# ---------- Parte A: cobertura diaria no Brasil ----------
dias = defaultdict(dict)  # sat -> {data: focos_brasil}
for arq in sorted(glob.glob(os.path.join(PASTA, "cobertura", "*.csv"))):
    with open(arq, newline="") as f:
        for r in csv.DictReader(f):
            sat = NOME_SAT.get(r["satelite"], r["satelite"])
            dias[sat][r["data"]] = dias[sat].get(r["data"], 0) + int(r["focos_brasil"])

p("# Completude dos dados FIRMS baixados")
p()
p(f"Pasta: `{os.path.relpath(os.path.abspath(PASTA), os.path.dirname(os.path.dirname(os.path.abspath(__file__))))}`")
p()
p("## A. Cobertura diária (Brasil inteiro)")
p()
p("Um dia sem nenhum foco no Brasil inteiro é quase certamente falta de dado do satélite, não ausência de fogo.")
p()
p("| Satélite | Primeiro dia | Último dia | Dias com dado | Dias no intervalo | Cobertura |")
p("|---|---|---|---|---|---|")
buracos = {}
por_ano = {}
for sat in sorted(dias):
    ds = sorted(d(x) for x in dias[sat])
    ini, fim = ds[0], ds[-1]
    total = (fim - ini).days + 1
    p(f"| {sat} | {ini} | {fim} | {len(ds)} | {total} | {100 * len(ds) / total:.1f}% |")
    presentes = set(ds)
    bs, atual = [], None
    dia = ini
    while dia <= fim:
        if dia not in presentes:
            atual = [dia, dia] if atual is None else [atual[0], dia]
        elif atual is not None:
            bs.append(atual)
            atual = None
        dia += timedelta(days=1)
    buracos[sat] = bs
    anos = defaultdict(int)
    for x in ds:
        anos[x.year] += 1
    por_ano[sat] = anos

p()
p("### Buracos (dias seguidos sem nenhum foco no Brasil)")
p()
for sat in sorted(buracos):
    bs = buracos[sat]
    grandes = [b for b in bs if (b[1] - b[0]).days + 1 >= 2]
    p(f"- **{sat}:** {sum((b[1] - b[0]).days + 1 for b in bs)} dias faltando no total, "
      f"{len(bs)} buracos, {len(grandes)} com 2 dias ou mais.")
    for b in sorted(grandes, key=lambda b: (b[1] - b[0]).days, reverse=True)[:8]:
        n = (b[1] - b[0]).days + 1
        p(f"  - {b[0]} a {b[1]} ({n} dias)")

p()
p("### Dias com dado por ano")
p()
sats = sorted(por_ano)
anos_todos = sorted({a for s in sats for a in por_ano[s]})
p("| Ano | " + " | ".join(sats) + " |")
p("|---|" + "---|" * len(sats))
for a in anos_todos:
    p(f"| {a} | " + " | ".join(str(por_ano[s].get(a, "")) for s in sats) + " |")

# ---------- Parte B: Bahia com filtros ----------
cont = defaultdict(lambda: defaultdict(int))  # sat -> ano -> focos filtrados
mes = defaultdict(lambda: defaultdict(int))   # sat -> "AAAA-MM" -> focos
removidos = defaultdict(lambda: defaultdict(int))
for arq in sorted(glob.glob(os.path.join(PASTA, "*_bahia.csv"))):
    with open(arq, newline="") as f:
        for r in csv.DictReader(f):
            if None in (r.get("satellite"), r.get("acq_date"), r.get("confidence"), r.get("type")):
                removidos["(linha incompleta)"][os.path.basename(arq)] += 1
                continue
            sat = NOME_SAT.get(r["satellite"], r["satellite"])
            if r.get("type", "0") != "0":
                removidos[sat][f"type {r.get('type')}"] += 1
                continue
            c = r["confidence"]
            if c.isdigit():
                if int(c) < 30:
                    removidos[sat]["confiança baixa"] += 1
                    continue
            elif c == "l":
                removidos[sat]["confiança baixa"] += 1
                continue
            cont[sat][int(r["acq_date"][:4])] += 1
            mes[sat][r["acq_date"][:7]] += 1

p()
p("## B. Retângulo da Bahia, com filtros")
p()
p("Filtros: só `type = 0` (vegetação), MODIS com confiança 30 ou mais, VIIRS sem os de confiança `l`. "
  "Retângulo com folga, ainda inclui pedaços dos estados vizinhos. Primeira olhada, não é o resultado final.")
p()
p("### Focos removidos pelos filtros")
p()
for sat in sorted(removidos):
    p(f"- **{sat}:** " + ", ".join(f"{k}: {v}" for k, v in sorted(removidos[sat].items())))
p()
p("### Focos por ano")
p()
sats_b = sorted(cont)
aqua = "MODIS Aqua"
extras = [s for s in sats_b if s.startswith("VIIRS")]
cab = "| Ano | " + " | ".join(sats_b) + " | " + " | ".join(f"{s.split()[-1]} / Aqua" for s in extras) + " |"
p(cab)
p("|---|" + "---|" * (len(sats_b) + len(extras)))
for a in sorted({a for s in sats_b for a in cont[s]}):
    vals = " | ".join(str(cont[s].get(a, "")) for s in sats_b)
    razoes = []
    for s in extras:
        if cont[s].get(a) and cont[aqua].get(a):
            razoes.append(f"{cont[s][a] / cont[aqua][a]:.2f}")
        else:
            razoes.append("")
    p(f"| {a} | {vals} | " + " | ".join(razoes) + " |")

p()
p("### Meses sem nenhum foco na Bahia (depois dos filtros)")
p()
for sat in sats_b:
    ms = sorted(mes[sat])
    if not ms:
        continue
    a0, a1 = int(ms[0][:4]), int(ms[-1][:4])
    todos = [f"{a}-{m:02d}" for a in range(a0, a1 + 1) for m in range(1, 13)]
    todos = [x for x in todos if ms[0] <= x <= ms[-1]]
    vazios = [x for x in todos if x not in mes[sat]]
    p(f"- **{sat}:** {len(vazios)} de {len(todos)} meses" + (f" ({', '.join(vazios[:12])}{'...' if len(vazios) > 12 else ''})" if vazios else ""))

texto = "\n".join(saida) + "\n"
with open(os.path.join(PASTA, "relatorio_completude.md"), "w") as f:
    f.write(texto)
print(texto)
