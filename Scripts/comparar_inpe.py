#!/usr/bin/env python3
"""Compara a serie harmonizada da Bahia com a serie do satelite de referencia do INPE (validacao externa).

O INPE (Programa Queimadas) publica os focos do "satelite de referencia", o mesmo satelite desde 2003,
justamente para comparar anos. Se a nossa harmonizacao estiver certa, a nossa serie tem que ter o mesmo
desenho da do INPE, sem o salto de 2012. Sem harmonizar, a razao contra o INPE pula na troca de satelite.

Entrada:
  Dados/inpe_ref/focos_br_ref_AAAA.zip (2003 a 2025), baixados de
  https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/anual/Brasil_sat_ref/  (fora do git)
  Dados/site/calendario_bahia.json (gerado por Scripts/gerar_json_site.py)
Saida: Dados/site/inpe.json e copia em site/data/inpe.json

Uso: python3 -I Scripts/comparar_inpe.py
"""
import csv
import io
import json
import os
import shutil
import zipfile
from collections import Counter, defaultdict

import numpy as np

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR_INPE = os.path.join(RAIZ, "Dados", "inpe_ref")
ARQ_SERIE = os.path.join(RAIZ, "Dados", "site", "calendario_bahia.json")
DESTINOS = [os.path.join(RAIZ, "Dados", "site"), os.path.join(RAIZ, "site", "data")]
URL_FONTE = "https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/anual/Brasil_sat_ref/"
ANOS = list(range(2003, 2026))
BASE_INDICE = (2012, 2021)   # cada serie e dividida pela propria media destes anos (= 100)


def ler_inpe(ano):
    """Focos com estado = BAHIA por mes e hora UTC das passagens no ano."""
    por_mes, horas = Counter(), Counter()
    with zipfile.ZipFile(os.path.join(DIR_INPE, "focos_br_ref_%d.zip" % ano)) as z:
        nome = [n for n in z.namelist() if n.endswith(".csv")][0]
        with z.open(nome) as f:
            for linha in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", errors="replace")):
                if (linha.get("estado") or "").strip().upper() != "BAHIA":
                    continue
                data = (linha.get("data_pas") or "").strip()
                if len(data) < 13 or data[4] != "-":
                    continue
                por_mes[data[:7]] += 1
                horas[data[11:13]] += 1
    return por_mes, horas


def ranks(v):
    return np.argsort(np.argsort(np.asarray(v, dtype=float)))


def corr(a, b):
    return float(np.corrcoef(a, b)[0, 1])


def media(d, ini, fim):
    vs = [d[a] for a in range(ini, fim + 1)]
    return sum(vs) / len(vs)


def main():
    serie = json.load(open(ARQ_SERIE, encoding="utf-8"))
    nossa_mes = {m["mes"]: m["focos"] for m in serie["meses"]}
    # mesma serie "sem harmonizar" do site: MODIS cru ate 2011, VIIRS de 2012 em diante
    crua_mes = {m["mes"]: (m["viirs_real"] if m.get("viirs_real") is not None else (m.get("modis_bruto") or 0))
                for m in serie["meses"]}

    inpe_mes, hora_moda = {}, {}
    for ano in ANOS:
        pm, horas = ler_inpe(ano)
        inpe_mes.update(pm)
        hora_moda[ano] = int(horas.most_common(1)[0][0]) if horas else None
        print("  INPE %d: %d focos na Bahia, hora mais comum %s UTC" % (ano, sum(pm.values()), hora_moda[ano]))

    meses = [m for m in sorted(nossa_mes) if int(m[:4]) in ANOS]
    soma = lambda d, a: sum(v for m, v in d.items() if m.startswith("%d-" % a))
    inpe = {a: soma(inpe_mes, a) for a in ANOS}
    nossa = {a: soma(nossa_mes, a) for a in ANOS}
    crua = {a: soma(crua_mes, a) for a in ANOS}

    base = {k: media(d, *BASE_INDICE) for k, d in (("inpe", inpe), ("nossa", nossa), ("crua", crua))}
    anos_saida = []
    for a in ANOS:
        ms = [m for m in meses if m.startswith("%d-" % a)]
        pico_inpe = max(ms, key=lambda m: inpe_mes.get(m, 0))
        pico_nossa = max(ms, key=lambda m: nossa_mes[m])
        anos_saida.append({
            "ano": a, "inpe": inpe[a], "nossa": nossa[a], "sem_harmonizar": crua[a],
            "razao_nossa_inpe": round(nossa[a] / inpe[a], 2), "razao_sem_harmonizar_inpe": round(crua[a] / inpe[a], 2),
            "indice_inpe": round(inpe[a] / base["inpe"] * 100, 1), "indice_nossa": round(nossa[a] / base["nossa"] * 100, 1),
            "indice_sem_harmonizar": round(crua[a] / base["crua"] * 100, 1),
            "mes_pico_inpe": pico_inpe, "mes_pico_nossa": pico_nossa, "hora_utc_mais_comum_inpe": hora_moda[a],
        })

    vi = [inpe[a] for a in ANOS]
    vn = [nossa[a] for a in ANOS]
    vc = [crua[a] for a in ANOS]
    vm_i = [inpe_mes.get(m, 0) for m in meses]
    vm_n = [nossa_mes[m] for m in meses]
    top = lambda d: [a for a, _ in sorted(d.items(), key=lambda x: -x[1])[:5]]
    razao = lambda d, ini, fim: sum(d[a] for a in range(ini, fim + 1)) / sum(inpe[a] for a in range(ini, fim + 1))
    r_antes, r_depois = razao(nossa, 2003, 2011), razao(nossa, 2012, 2021)
    resumo = {
        "correlacao_anual": round(corr(vi, vn), 3),
        "correlacao_anual_ranking": round(corr(ranks(vi), ranks(vn)), 3),
        "correlacao_mensal": round(corr(vm_i, vm_n), 3),
        "correlacao_anual_sem_harmonizar": round(corr(vi, vc), 3),
        "mes_pico_igual": sum(1 for x in anos_saida if x["mes_pico_inpe"] == x["mes_pico_nossa"]),
        "n_anos": len(ANOS),
        "top5_inpe": top(inpe), "top5_nossa": top(nossa),
        "razao_media_2003_2011": round(r_antes, 2), "razao_media_2012_2021": round(r_depois, 2),
        "diferenca_entre_periodos_pct": round((r_depois / r_antes - 1) * 100, 1),
        "razao_sem_harmonizar_2011": round(crua[2011] / inpe[2011], 2),
        "razao_sem_harmonizar_2012": round(crua[2012] / inpe[2012], 2),
        "salto_sem_harmonizar_vezes": round((crua[2012] / inpe[2012]) / (crua[2011] / inpe[2011]), 1),
    }
    saida = {
        "descricao": "Comparação da série harmonizada da Bahia com a série do satélite de referência do INPE.",
        "fonte": "INPE, Programa Queimadas, focos do satélite de referência (arquivos anuais do Brasil)",
        "url_fonte": URL_FONTE,
        "recorte_inpe": "focos com estado = BAHIA (contorno oficial do estado)",
        "recorte_nosso": serie["area"]["descricao"],
        "indice_base": "cada série dividida pela própria média de %d a %d (= 100)" % BASE_INDICE,
        "resumo": resumo,
        "anos": anos_saida,
    }
    for d in DESTINOS:
        os.makedirs(d, exist_ok=True)
    destino = os.path.join(DESTINOS[0], "inpe.json")
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)
    shutil.copy(destino, os.path.join(DESTINOS[1], "inpe.json"))
    print(json.dumps(resumo, ensure_ascii=False, indent=1))
    print("gravado em", os.path.relpath(destino, RAIZ))


if __name__ == "__main__":
    main()
