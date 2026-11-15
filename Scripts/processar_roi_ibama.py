#!/usr/bin/env python3
"""Incendios relatados em solo na Bahia: Registros de Ocorrencia de Incendio (ROI) do IBAMA/Prevfogo.

Compara os incendios registrados pelas brigadas (relatados) com os focos de calor detectados por satelite
(serie harmonizada do site). Os registros cobrem so as areas atendidas por brigadas federais (unidades de
conservacao, terras indigenas, assentamentos e propriedades no entorno), entao nao sao um censo do fogo.

Entrada:
  Dados/ibama_roi/ROI.csv  (fora do git), de https://dadosabertos.ibama.gov.br/dados/SISFOGO/ROI.csv
  Dados/site/calendario_bahia.json
Saida: Dados/site/relatados.json e copia em site/data/relatados.json

Uso: python3 -I Scripts/processar_roi_ibama.py
"""
import csv
import json
import os
import shutil
from collections import Counter, defaultdict
from datetime import datetime

import numpy as np

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARQ_ROI = os.path.join(RAIZ, "Dados", "ibama_roi", "ROI.csv")
ARQ_SERIE = os.path.join(RAIZ, "Dados", "site", "calendario_bahia.json")
DESTINOS = [os.path.join(RAIZ, "Dados", "site"), os.path.join(RAIZ, "site", "data")]
URL_FONTE = "https://dadosabertos.ibama.gov.br/dados/SISFOGO/ROI.csv"
UF = "BA"
ANO_MIN, ANO_MAX = 2003, 2026
MIN_POR_ANO = 10   # anos com menos registros que isso ficam fora das comparacoes (cobertura incompleta)


def data(txt):
    try:
        return datetime.strptime(txt.strip(), "%d/%m/%Y %H:%M:%S")
    except ValueError:
        return None


def numero(txt):
    txt = (txt or "").strip().replace(".", "").replace(",", ".")
    try:
        return float(txt)
    except ValueError:
        return None


def main():
    csv.field_size_limit(10 ** 8)
    registros = {}
    with open(ARQ_ROI, encoding="utf-8", errors="replace", newline="") as f:
        leitor = csv.reader(f, delimiter=";")
        cab = next(leitor)
        ix = {c: i for i, c in enumerate(cab)}
        for linha in leitor:
            if len(linha) < len(cab) or linha[ix["UF"]].strip() != UF:
                continue
            seq = linha[ix["SEQ OCORRENCIA INCENDIO"]].strip()
            # o arquivo repete a ocorrencia uma vez para cada combinacao de campos com varios valores
            if seq and seq not in registros:
                registros[seq] = linha

    validos, invalidos = [], 0
    for seq, l in registros.items():
        d = data(l[ix["DATA/HORA INICIO FOGO"]]) or data(l[ix["DATA/HORA DETECCAO"]])
        if d is None or not (ANO_MIN <= d.year <= ANO_MAX):
            invalidos += 1
            continue
        validos.append({"data": d, "area": numero(l[ix["QTD AREA ATINGIDA"]]),
                        "deteccao": l[ix["TIPO DETECCAO"]].strip() or "não informado",
                        "causa": l[ix["PROVAVEL CAUSA"]].strip() or "não informada",
                        "local": l[ix["TIPO LOCALIDADE"]].strip() or "não informado",
                        "municipio": l[ix["MUNICIPIO"]].strip() or "não informado"})

    serie = json.load(open(ARQ_SERIE, encoding="utf-8"))
    focos_mes = {m["mes"]: m["focos"] for m in serie["meses"]}
    focos_ano = {t["ano"]: t["focos"] for t in serie["totais_por_ano"]}

    por_ano, area_ano = Counter(), defaultdict(float)
    por_mes = Counter()
    for v in validos:
        por_ano[v["data"].year] += 1
        area_ano[v["data"].year] += v["area"] or 0
        por_mes[v["data"].strftime("%Y-%m")] += 1
    anos_ok = sorted(a for a, n in por_ano.items() if n >= MIN_POR_ANO)
    meses_ok = [m for m in sorted(focos_mes) if int(m[:4]) in anos_ok]

    # sazonalidade: parte de cada mes do ano no total, nos anos com cobertura
    rel_mes_ano, foc_mes_ano = Counter(), Counter()
    for m in meses_ok:
        rel_mes_ano[int(m[5:7])] += por_mes.get(m, 0)
        foc_mes_ano[int(m[5:7])] += focos_mes[m]
    tot_r, tot_f = sum(rel_mes_ano.values()), sum(foc_mes_ano.values())
    sazonal = [{"mes": k, "relatados_pct": round(rel_mes_ano[k] / tot_r * 100, 1),
                "detectados_pct": round(foc_mes_ano[k] / tot_f * 100, 1)} for k in range(1, 13)]
    corr_mensal = float(np.corrcoef([por_mes.get(m, 0) for m in meses_ok], [focos_mes[m] for m in meses_ok])[0, 1])
    corr_sazonal = float(np.corrcoef([s["relatados_pct"] for s in sazonal], [s["detectados_pct"] for s in sazonal])[0, 1])

    rel_ok = sum(por_ano[a] for a in anos_ok)
    foc_ok = sum(focos_ano[a] for a in anos_ok)
    top = lambda chave, n: [{"nome": k, "n": c} for k, c in Counter(v[chave] for v in validos).most_common(n)]
    saida = {
        "descricao": "Incêndios relatados em solo (registros das brigadas do IBAMA/Prevfogo) contra focos detectados por satélite, Bahia.",
        "fonte": "IBAMA, Sisfogo, Registros de Ocorrência de Incêndio (ROI), dados abertos",
        "url_fonte": URL_FONTE,
        "cobertura": "Só áreas atendidas por brigadas federais: unidades de conservação, terras indígenas, assentamentos e propriedades no entorno.",
        "total_ocorrencias": len(validos),
        "datas_invalidas_descartadas": invalidos,
        "anos_com_cobertura": [anos_ok[0], anos_ok[-1]] if anos_ok else None,
        "minimo_registros_por_ano": MIN_POR_ANO,
        "media_ocorrencias_por_ano": round(rel_ok / len(anos_ok), 1),
        "media_focos_por_ano": round(foc_ok / len(anos_ok)),
        "focos_por_ocorrencia": round(foc_ok / rel_ok),
        "detectados_por_satelite": sum(1 for v in validos if "SATÉLITE" in v["deteccao"].upper()),
        "correlacao_mensal": round(corr_mensal, 2),
        "correlacao_sazonal": round(corr_sazonal, 2),
        "mes_pico_relatados": max(sazonal, key=lambda s: s["relatados_pct"])["mes"],
        "mes_pico_detectados": max(sazonal, key=lambda s: s["detectados_pct"])["mes"],
        "por_ano": [{"ano": a, "relatados": por_ano.get(a, 0), "area_ha": round(area_ano.get(a, 0)),
                     "detectados": focos_ano.get(a)} for a in range(anos_ok[0], anos_ok[-1] + 1)],
        "fora_dos_anos_com_cobertura": {str(a): n for a, n in sorted(por_ano.items()) if a not in anos_ok},
        "sazonal": sazonal,
        "deteccao": top("deteccao", 8),
        "causas": top("causa", 8),
        "locais": top("local", 6),
        "municipios": top("municipio", 10),
    }
    for d in DESTINOS:
        os.makedirs(d, exist_ok=True)
    destino = os.path.join(DESTINOS[0], "relatados.json")
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)
    shutil.copy(destino, os.path.join(DESTINOS[1], "relatados.json"))
    resumo = {k: v for k, v in saida.items() if not isinstance(v, list)}
    print(json.dumps(resumo, ensure_ascii=False, indent=1))
    print("por ano:", [(x["ano"], x["relatados"], x["detectados"]) for x in saida["por_ano"]])
    print("gravado em", os.path.relpath(destino, RAIZ))


if __name__ == "__main__":
    main()
