#!/usr/bin/env python3
"""Junta os resultados da replicacao em outros paises (Scripts/replicar_regiao.py) com os da Bahia.

Saida: Dados/harmonizado/replicacao_regioes.json (versionado; os arquivos brutos de cada pais ficam fora do git)
e copias em site/data/ (replicacao_regioes.json e conferencia_api.json)

Uso: python3 -I Scripts/resumo_regioes.py
"""
import glob
import json
import os
import shutil

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAMPOS = ["teste_erro_pct", "teste_erro_taxa_unica_pct", "um_ano_fora_erro_pct", "um_ano_fora_erro_taxa_unica_pct",
          "teste_vies_pct", "n_meses_teste", "viirs_mediana_mensal_teste", "salto_sem_harmonizar_2011_2012", "ano_com_mais_fogo"]


def main():
    regioes = []
    m = json.load(open(os.path.join(RAIZ, "Dados", "site", "metodos.json"), encoding="utf-8"))["metodos"]
    bahia = json.load(open(os.path.join(RAIZ, "Dados", "site", "calendario_bahia.json"), encoding="utf-8"))
    inpe = json.load(open(os.path.join(RAIZ, "Dados", "site", "inpe.json"), encoding="utf-8"))["anos"]
    salto = {a["ano"]: a["sem_harmonizar"] for a in inpe}
    regioes.append({
        "regiao": "Bahia (Brazil)", "teste_erro_pct": m["taxa_por_mes"]["teste_erro_pct"],
        "teste_erro_taxa_unica_pct": m["taxa_unica"]["teste_erro_pct"],
        "um_ano_fora_erro_pct": m["taxa_por_mes"]["um_ano_fora_erro_pct"],
        "um_ano_fora_erro_taxa_unica_pct": m["taxa_unica"]["um_ano_fora_erro_pct"],
        "teste_vies_pct": m["taxa_por_mes"]["teste_vies_pct"], "n_meses_teste": m["taxa_por_mes"]["teste_n_meses"],
        "salto_sem_harmonizar_2011_2012": round(salto[2012] / salto[2011], 2),
        "ano_com_mais_fogo": max((t for t in bahia["totais_por_ano"] if t["meses"] == 12), key=lambda t: t["focos"])["ano"],
        "taxa_por_mes": bahia["metodo"]["taxa_por_mes"],
    })
    for arq in sorted(glob.glob(os.path.join(RAIZ, "Dados", "regioes", "*.json"))):
        d = json.load(open(arq, encoding="utf-8"))
        item = {"regiao": d["pais"].replace("_", " ")}
        item.update({k: d.get(k) for k in CAMPOS})
        item["taxa_por_mes"] = d["taxa_por_mes"]
        regioes.append(item)
    ganha_teste = sum(1 for r in regioes if r["teste_erro_pct"] < r["teste_erro_taxa_unica_pct"])
    ganha_loyo = sum(1 for r in regioes if r["um_ano_fora_erro_pct"] < r["um_ano_fora_erro_taxa_unica_pct"])
    julho = [r["taxa_por_mes"].get("07") for r in regioes if r["taxa_por_mes"].get("07")]
    saida = {
        "descricao": "Same method (one VIIRS/MODIS Aqua ratio per calendar month, calibrated 2012-2019, tested 2020-2023) in several regions.",
        "n_regioes": len(regioes),
        "taxa_por_mes_ganha_da_taxa_unica_no_teste": ganha_teste,
        "taxa_por_mes_ganha_da_taxa_unica_um_ano_fora": ganha_loyo,
        "taxa_julho_min_max": [round(min(julho), 2), round(max(julho), 2)],
        "regioes": regioes,
    }
    destino = os.path.join(RAIZ, "Dados", "harmonizado", "replicacao_regioes.json")
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)
    # copias para a janela de metodologia do site: replicacao e conferencia com a API do FIRMS
    shutil.copy(destino, os.path.join(RAIZ, "site", "data", "replicacao_regioes.json"))
    api = os.path.join(RAIZ, "Dados", "harmonizado", "conferencia_api.json")
    if os.path.exists(api):
        shutil.copy(api, os.path.join(RAIZ, "site", "data", "conferencia_api.json"))
    print(json.dumps({k: v for k, v in saida.items() if k != "regioes"}, ensure_ascii=False))
    for r in regioes:
        print("%-16s %5.1f%% vs %5.1f%% | 1 fora %5.1f%% vs %5.1f%% | vies %+5.1f%% | salto %s | pico %s" % (
            r["regiao"], r["teste_erro_pct"], r["teste_erro_taxa_unica_pct"], r["um_ano_fora_erro_pct"],
            r["um_ano_fora_erro_taxa_unica_pct"], r["teste_vies_pct"], r["salto_sem_harmonizar_2011_2012"], r["ano_com_mais_fogo"]))


if __name__ == "__main__":
    main()
