#!/usr/bin/env python3
"""Compara todos os metodos de harmonizacao testados na mesma regua, para o site.

Mesmos meses para todos (meses validos do Aqua, sem os dias degradados, como na producao):
- teste: calibra em 2012-02..2019-12 e preve 2020-2023 (44 meses validos);
- deixa um ano de fora: para cada ano de 2013 a 2023, calibra nos outros anos de 2012-2023 e preve o ano tirado;
- deriva: 2024-2025, com a calibracao do teste (orbita do Aqua mudando);
- anos que viu: erro do ajuste do teste nos proprios meses de calibracao (mostra se o metodo decora).

Metodos: taxa unica (B0), taxa por mes (T1), quadradinhos com fogo (T2, celulas-dia de 0,05 grau),
posicao no ranking (T3), formula com pesos (modelo com fatores v2), taxa por mes a partir do Terra
e mistura T1 + formula com o peso escolhido so com 2013-2019, sem olhar o teste.

Uso: python3 -I Scripts/harmonizacao/comparar_metodos.py   (cerca de 1 minuto)
Saida: Dados/site/metodos.json e copia em site/data/metodos.json
"""
import json
import os
import shutil
import sys

import numpy as np

HARM = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HARM)
for p in (os.path.join(HARM, "fatores"), HARM, SCRIPTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import avaliar  # noqa: E402
import comum  # noqa: E402
import gerar_json_site  # noqa: E402
import modelo  # noqa: E402
import montar_tabela  # noqa: E402
import t1_fator_sazonal as t1  # noqa: E402
import t3_quantile_mapping as t3  # noqa: E402
import versao2 as v2  # noqa: E402

M = comum.MESES_SERIE
IDX = {m: i for i, m in enumerate(M)}
B_TRIAGEM = 300
PASSO_PESO = 0.05
DESTINOS = [os.path.join(comum.RAIZ, "Dados", "site"), os.path.join(comum.RAIZ, "site", "data")]


def wape(meses, prev, real):
    return float(sum(abs(prev[m] - real[m]) for m in meses) / sum(real[m] for m in meses) * 100)


def vies(meses, prev, real):
    return float((sum(prev[m] for m in meses) - sum(real[m] for m in meses)) / sum(real[m] for m in meses) * 100)


def main():
    print("montando a tabela (FIRMS + NASA POWER)...")
    tab = montar_tabela.montar()
    cells = np.arange(len(tab["celulas"]))
    V, A, T = tab["V"], tab["A"], tab["T"]
    real = {m: float(V[:, i].sum()) for i, m in enumerate(M)}
    aqua = {m: float(A[:, i].sum()) for i, m in enumerate(M)}
    terra = {m: float(T[:, i].sum()) for i, m in enumerate(M)}

    degr = gerar_json_site.dias_degradados_aqua()
    sem_aqua = comum.dias_sem_dado("modis", "Aqua", M)
    sem_snpp = comum.dias_sem_dado("viirs-snpp", "N", M)
    sem_terra = comum.dias_sem_dado("modis", "Terra", M)
    sinal = comum.sinalizar({m: (sem_aqua[m] or 0) + degr.get(m, 0) for m in M}, sem_snpp, M)
    sinal_t = comum.sinalizar(sem_terra, sem_snpp, M)

    calib = [m for m in comum.MESES_CALIB if not sinal[m]]
    teste = [m for m in comum.MESES_TESTE if not sinal[m]]
    deriva = [m for m in comum.MESES_DERIVA if not sinal[m]]
    validos = [m for m in M if "2012-02" <= m <= "2023-12" and not sinal[m]]
    anos_loyo = sorted({m[:4] for m in validos if m[:4] != "2012"})

    print("lendo celulas-dia (T2)...")
    d_aqua, d_snpp = comum.carregar("aqua", (comum.G_PRINCIPAL,)), comum.carregar("snpp", (comum.G_PRINCIPAL,))
    cel_a = {m: float(d_aqua["celulas"][comum.G_PRINCIPAL].get(m, 0)) for m in M}
    cel_v = {m: float(d_snpp["celulas"][comum.G_PRINCIPAL].get(m, 0)) for m in M}

    ctx = modelo.contexto(tab, "aqua", M)

    def fatores(cal):
        tri = v2.triagem_condicionada(ctx, cells, [IDX[m] for m in cal], B_TRIAGEM, v2.SEMENTE)
        nomes = [r["fator"] for r in tri if r["mantido"]]
        fit = v2.ajustar(ctx, cells, [IDX[m] for m in cal], nomes)
        tot = modelo.total_previsto(fit["X"], fit["beta"])
        return {m: float(tot[i]) for i, m in enumerate(M)}, nomes

    def taxa_unica(cal, x, y):
        r = sum(y[m] for m in cal) / sum(x[m] for m in cal)
        return {m: r * x[m] for m in M}

    def taxa_mes(cal, x, y):
        p = t1.calibrar(cal, x, y)
        return {m: t1.prever(p, m, x[m]) for m in M}

    def ranking(cal, x, y):
        p = t3.calibrar(cal, x, y)
        return {m: t3.prever(p, m, x[m]) for m in M}

    # previsores: (calibracao) -> previsao para todos os meses; real e meses de cada metodo
    def terra_mes(cal):
        return taxa_mes([m for m in cal if not sinal_t[m]], terra, real)

    base = {
        "taxa_unica": (lambda cal: taxa_unica(cal, aqua, real), real),
        "taxa_por_mes": (lambda cal: taxa_mes(cal, aqua, real), real),
        "quadradinhos": (lambda cal: taxa_mes(cal, cel_a, cel_v), cel_v),
        "ranking": (lambda cal: ranking(cal, aqua, real), real),
        "formula_pesos": (lambda cal: fatores(cal)[0], real),
        "terra": (terra_mes, real),
    }

    # peso da mistura escolhido so com 2013-2019 (deixa um ano de fora dentro da calibracao)
    print("escolhendo o peso da mistura so com 2013-2019...")
    p_in = {}
    for a in sorted({m[:4] for m in calib if m[:4] != "2012"}):
        cal = [m for m in calib if m[:4] != a]
        pt, pf = base["taxa_por_mes"][0](cal), base["formula_pesos"][0](cal)
        for m in calib:
            if m[:4] == a:
                p_in[m] = (pt[m], pf[m])
    pesos = np.round(np.arange(0, 1 + 1e-9, PASSO_PESO), 2)
    peso = float(min(pesos, key=lambda w: sum(abs(w * t + (1 - w) * f - real[m]) for m, (t, f) in p_in.items())))
    print("  peso da taxa por mes: %.2f" % peso)

    def mistura(cal):
        pt, pf = base["taxa_por_mes"][0](cal), base["formula_pesos"][0](cal)
        return {m: peso * pt[m] + (1 - peso) * pf[m] for m in M}
    base["mistura"] = (mistura, real)

    resultados = {}
    for chave, (prever, y) in base.items():
        print("avaliando %s..." % chave)
        cal_m = calib
        teste_m = [m for m in teste if not (chave == "terra" and sinal_t[m])]
        deriva_m = [m for m in deriva if not (chave == "terra" and sinal_t[m])]
        p = prever(cal_m)
        loyo, por_ano = {}, {}
        for a in anos_loyo:
            pa = prever([m for m in validos if m[:4] != a])
            alvo = [m for m in validos if m[:4] == a and not (chave == "terra" and sinal_t[m])]
            for m in alvo:
                loyo[m] = pa[m]
            por_ano[a] = round(wape(alvo, pa, y), 2)
        ms = list(loyo)
        resultados[chave] = {
            "teste_erro_pct": round(wape(teste_m, p, y), 2),
            "teste_vies_pct": round(vies(teste_m, p, y), 2),
            "teste_n_meses": len(teste_m),
            "deriva_erro_pct": round(wape(deriva_m, p, y), 2),
            "anos_que_viu_erro_pct": round(wape([m for m in cal_m if not (chave == "terra" and sinal_t[m])], p, y), 2),
            "um_ano_fora_erro_pct": round(wape(ms, loyo, y), 2),
            "um_ano_fora_n_meses": len(ms),
            "um_ano_fora_por_ano": por_ano,
        }
    ganha = {}
    for chave, r in resultados.items():
        ganha[chave] = sum(1 for a in anos_loyo if r["um_ano_fora_por_ano"][a] < resultados["taxa_por_mes"]["um_ano_fora_por_ano"][a])
        r["anos_que_ganha_da_taxa_por_mes"] = ganha[chave] if chave != "taxa_por_mes" else None

    # correlacao da ordem dos meses: o Aqua cru ja chega perto, entao nao serve de prova
    p_t1 = base["taxa_por_mes"][0](calib)
    corr = {"aqua_sem_conversao": round(avaliar.spearman(np.array([aqua[m] for m in teste]), np.array([real[m] for m in teste])), 3),
            "taxa_por_mes": round(avaliar.spearman(np.array([p_t1[m] for m in teste]), np.array([real[m] for m in teste])), 3)}

    vencedor = min(("taxa_unica", "taxa_por_mes", "ranking", "formula_pesos", "terra"),
                   key=lambda k: resultados[k]["teste_erro_pct"])
    saida = {
        "descricao": "Comparação dos métodos de harmonização testados, todos com os mesmos meses e o mesmo teste.",
        "periodos": {"calibracao_teste": [calib[0], calib[-1]], "teste": ["2020-01", "2023-12"],
                     "um_ano_fora": [anos_loyo[0], anos_loyo[-1]], "deriva": ["2024-01", "2025-12"]},
        "peso_mistura_taxa_por_mes": peso,
        "vencedor_entre_metodos_simples": vencedor,
        "correlacao_ordem_dos_meses": corr,
        "metodos": resultados,
        "notas": ["Quadradinhos: erro medido em quadradinhos de 0,05 grau com fogo por dia, não em focos.",
                  "Terra: sem os meses em que o Terra teve falta de dados.",
                  "Mistura: o peso foi escolhido só com 2013 a 2019, sem olhar o teste."],
    }
    for d in DESTINOS:
        os.makedirs(d, exist_ok=True)
    destino = os.path.join(DESTINOS[0], "metodos.json")
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)
    shutil.copy(destino, os.path.join(DESTINOS[1], "metodos.json"))

    print("\n%-14s %7s %7s %8s %8s %8s %6s" % ("metodo", "teste", "vies", "1 fora", "deriva", "viu", "ganha"))
    for k, r in resultados.items():
        print("%-14s %6.2f%% %+6.2f%% %7.2f%% %7.2f%% %7.2f%% %6s" % (
            k, r["teste_erro_pct"], r["teste_vies_pct"], r["um_ano_fora_erro_pct"], r["deriva_erro_pct"],
            r["anos_que_viu_erro_pct"], r["anos_que_ganha_da_taxa_por_mes"]))
    print("correlacao:", corr, "| vencedor:", vencedor, "| gravado em", os.path.relpath(destino, comum.RAIZ))


if __name__ == "__main__":
    main()
