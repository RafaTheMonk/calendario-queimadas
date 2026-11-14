"""Roda as tres tecnicas de harmonizacao + linha de base B0, avalia com as
mesmas metricas, grava resultados.json e os CSV mensais.

Uso: python3 -I Scripts/harmonizacao/avaliar.py  (a partir da raiz NasaSpaceApps)
"""
import csv
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np

import comum
import t1_fator_sazonal as t1
import t2_grade_celulas as t2
import t3_quantile_mapping as t3
from comum import (MESES_CALIB, MESES_DERIVA, MESES_PRODUCAO, MESES_SERIE,
                   MESES_TESTE, PRIMEIRO_MES_VIIRS, mes_do_ano)


# ---------------------------------------------------------------- B0

class B0:
    """Taxa unica: soma S-NPP / soma Aqua em toda a calibracao."""
    @staticmethod
    def calibrar(meses, aqua, viirs):
        return {"razao_unica": sum(viirs[m] for m in meses) / sum(aqua[m] for m in meses)}

    @staticmethod
    def prever(params, mes, x):
        return params["razao_unica"] * x


# ---------------------------------------------------------------- metricas

def ranks(v):
    """Ranks medios (1..n), empates recebem a media."""
    v = np.asarray(v, float)
    ordem = np.argsort(v, kind="mergesort")
    r = np.empty(len(v))
    i = 0
    while i < len(v):
        j = i
        while j + 1 < len(v) and v[ordem[j + 1]] == v[ordem[i]]:
            j += 1
        r[ordem[i:j + 1]] = (i + j) / 2.0 + 1
        i = j + 1
    return r


def spearman(a, b):
    ra, rb = ranks(a), ranks(b)
    if ra.std() == 0 or rb.std() == 0:
        return float("nan")
    return float(np.corrcoef(ra, rb)[0, 1])


def referencia_anomalia(viirs, validos_producao):
    """Mediana e p25/p75 por mes do ano com o VIIRS real de 2012-02 a 2023-12 sem sinalizados."""
    ref = {}
    for m in range(1, 13):
        v = [viirs[x] for x in validos_producao if mes_do_ano(x) == m]
        ref[m] = {"mediana": float(np.median(v)), "p25": float(np.percentile(v, 25)),
                  "p75": float(np.percentile(v, 75))}
    return ref


def classe2(valor, r):
    return 1 if valor > r["mediana"] else 0


def classe3(valor, r):
    return 0 if valor < r["p25"] else (2 if valor > r["p75"] else 1)


def metricas(meses, prev, real, ref):
    """Metricas 1 a 6 para uma lista de meses (ja sem sinalizados)."""
    p = np.array([prev[m] for m in meses])
    r = np.array([real[m] for m in meses])
    out = {"n_meses": len(meses),
           "wape_pct": float(np.abs(p - r).sum() / r.sum() * 100),
           "vies_pct": float((p.sum() - r.sum()) / r.sum() * 100),
           "spearman": spearman(p, r)}
    anual, picos, ok, tot = {}, {}, 0, 0
    for ano in sorted({m[:4] for m in meses}):
        ms = [m for m in meses if m[:4] == ano]
        sp = sum(prev[m] for m in ms)
        sr = sum(real[m] for m in ms)
        anual[ano] = {"erro_pct": (sp - sr) / sr * 100, "n_meses": len(ms),
                      "total_prev": sp, "total_real": sr}
        pico_p = max(ms, key=lambda m: prev[m])
        pico_r = max(ms, key=lambda m: real[m])
        picos[ano] = {"prev": pico_p, "real": pico_r, "concorda": pico_p == pico_r}
        ok += pico_p == pico_r
        tot += 1
    out["erro_anual"] = anual
    out["pico"] = {"concordam": "%d de %d" % (ok, tot), "por_ano": picos}
    out["anomalia_2classes_pct"] = float(np.mean(
        [classe2(prev[m], ref[mes_do_ano(m)]) == classe2(real[m], ref[mes_do_ano(m)]) for m in meses]) * 100)
    out["anomalia_3classes_pct"] = float(np.mean(
        [classe3(prev[m], ref[mes_do_ano(m)]) == classe3(real[m], ref[mes_do_ano(m)]) for m in meses]) * 100)
    return out


def razao_anual(meses_validos, num, den):
    """Razao anual soma(num)/soma(den) de 2012 a 2023, meses nao sinalizados."""
    out = {}
    for ano in range(2012, 2024):
        ms = [m for m in meses_validos if m[:4] == str(ano)]
        if ms:
            out[str(ano)] = sum(num[m] for m in ms) / sum(den[m] for m in ms)
    return out


def cv(valores):
    v = np.array(list(valores))
    return float(v.std(ddof=1) / v.mean())


# ---------------------------------------------------------------- execucao de uma tecnica

def rodar(nome, modulo, unidade, aqua, viirs, validos, ref):
    """Calibra (metricas e producao), avalia teste, deriva e producao em amostra."""
    calib = [m for m in MESES_CALIB if m in validos]
    prod = [m for m in MESES_PRODUCAO if m in validos]
    par_teste = modulo.calibrar(calib, aqua, viirs)
    par_prod = modulo.calibrar(prod, aqua, viirs)
    prev_t = {m: modulo.prever(par_teste, m, aqua[m]) for m in MESES_SERIE}
    prev_p = {m: modulo.prever(par_prod, m, aqua[m]) for m in MESES_SERIE}
    teste = [m for m in MESES_TESTE if m in validos]
    deriva = [m for m in MESES_DERIVA if m in validos]
    anos_cv = [m for m in validos if "2012-02" <= m <= "2023-12"]
    bruta = razao_anual(anos_cv, viirs, aqua)
    # razao anual depois da conversao (VIIRS / previsao com o ajuste de teste)
    pos = razao_anual(anos_cv, viirs, prev_t)
    res = {"unidade": unidade,
           "teste": metricas(teste, prev_t, viirs, ref),
           "deriva": metricas(deriva, prev_t, viirs, ref),
           "producao_em_amostra_2012_2023": metricas(prod, prev_p, viirs, ref),
           "cv_razao_anual": cv(bruta.values()),
           "razao_anual_bruta": bruta,
           "cv_razao_anual_apos_conversao": cv(pos.values()),
           "parametros_teste": par_teste,
           "parametros_producao": par_prod}
    return res, prev_p


# ---------------------------------------------------------------- principal

def main():
    print("Lendo Aqua...")
    d_aqua = comum.carregar("aqua")
    print("Lendo S-NPP...")
    d_snpp = comum.carregar("snpp")
    print("linhas lidas/descartadas: Aqua %d/%d, S-NPP %d/%d" % (
        d_aqua["lidos"], d_aqua["descartados"], d_snpp["lidos"], d_snpp["descartados"]))

    sem_aqua = comum.dias_sem_dado("modis", "Aqua", MESES_SERIE)
    sem_viirs = comum.dias_sem_dado("viirs-snpp", "N", MESES_SERIE)
    sinal = comum.sinalizar(sem_aqua, sem_viirs, MESES_SERIE)
    validos = {m for m in MESES_SERIE if not sinal[m]}
    sinalizados = [m for m in MESES_SERIE if sinal[m]]
    print("Meses sinalizados:", sinalizados)

    # series por unidade
    unidades = {"focos": ({m: d_aqua["focos"].get(m, 0) for m in MESES_SERIE},
                          {m: d_snpp["focos"].get(m, 0) for m in MESES_SERIE})}
    for g in comum.GRADES:
        a, v = t2.series(d_aqua, d_snpp, g)
        unidades["celulas_%s" % g] = ({m: a.get(m, 0) for m in MESES_SERIE},
                                      {m: v.get(m, 0) for m in MESES_SERIE})

    producao_validos = [m for m in MESES_PRODUCAO if m in validos]
    tecnicas = [("B0_taxa_unica", B0, "focos"), ("T1_fator_sazonal", t1, "focos"),
                ("T3_quantile_mapping", t3, "focos")]
    tecnicas += [("T2_grade_g%s" % g, t2, "celulas_%s" % g) for g in comum.GRADES]

    resultados, series = {}, {}
    for nome, mod, un in tecnicas:
        aqua, viirs = unidades[un]
        ref = referencia_anomalia(viirs, producao_validos)
        res, prev_p = rodar(nome, mod, "focos" if un == "focos" else "celulas-dia (g=%s)" % un.split("_")[1],
                            aqua, viirs, validos, ref)
        res["referencia_anomalia"] = {str(k): v for k, v in ref.items()}
        resultados[nome] = res
        series[nome] = (aqua, viirs, prev_p, res["unidade"])

    # sensibilidade da grade
    sens = {}
    for g in comum.GRADES:
        r = resultados["T2_grade_g%s" % g]
        sens[str(g)] = {"wape_teste_pct": r["teste"]["wape_pct"], "vies_teste_pct": r["teste"]["vies_pct"],
                        "cv_razao_anual": r["cv_razao_anual"]}
    cv_focos = resultados["T1_fator_sazonal"]["cv_razao_anual"]
    cv_celulas = resultados["T2_grade_g%s" % comum.G_PRINCIPAL]["cv_razao_anual"]

    # CSV mensais
    nomes_csv = {"T1_fator_sazonal": "t1_fator_sazonal", "T2_grade_g%s" % comum.G_PRINCIPAL: "t2_grade_celulas",
                 "T3_quantile_mapping": "t3_quantile_mapping"}
    os.makedirs(comum.DIR_SAIDA, exist_ok=True)
    problemas = []
    for nome, arq in nomes_csv.items():
        aqua, viirs, prev_p, unidade = series[nome]
        caminho = os.path.join(comum.DIR_SAIDA, arq + "_bahia_mensal.csv")
        with open(caminho, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["mes", "aqua_bruto", "viirs_real", "modis_convertido", "harmonizado", "origem",
                        "unidade", "dias_sem_dado_aqua", "dias_sem_dado_viirs", "sinalizado"])
            for m in MESES_SERIE:
                com_viirs = m >= PRIMEIRO_MES_VIIRS
                conv = prev_p[m]
                harm = viirs[m] if com_viirs else conv
                if not all(math.isfinite(x) and x >= 0 for x in (aqua[m], conv, harm)):
                    problemas.append((nome, m))
                w.writerow([m, aqua[m], viirs[m] if com_viirs else "", round(conv, 3), round(harm, 3),
                            "VIIRS" if com_viirs else "MODIS convertido", unidade,
                            sem_aqua[m] if sem_aqua[m] is not None else "",
                            sem_viirs[m] if (com_viirs and sem_viirs[m] is not None) else "",
                            "sim" if sinal[m] else "nao"])
    assert len(MESES_SERIE) == 276
    if problemas:
        print("PROBLEMAS (NaN ou negativo):", problemas)

    saida = {"periodos": {"calibracao": [MESES_CALIB[0], MESES_CALIB[-1]], "teste": [MESES_TESTE[0], MESES_TESTE[-1]],
                          "deriva": [MESES_DERIVA[0], MESES_DERIVA[-1]],
                          "producao": [MESES_PRODUCAO[0], MESES_PRODUCAO[-1]]},
             "meses_sinalizados": sinalizados,
             "dias_sem_dado_sinalizados": {m: {"aqua": sem_aqua[m], "snpp": sem_viirs[m]} for m in sinalizados},
             "leitura": {"aqua": {"lidos": d_aqua["lidos"], "descartados": d_aqua["descartados"]},
                         "snpp": {"lidos": d_snpp["lidos"], "descartados": d_snpp["descartados"]}},
             "n_meses_teste_validos": resultados["T1_fator_sazonal"]["teste"]["n_meses"],
             "sensibilidade_grade": sens,
             "razao_celulas_mais_estavel_que_focos": cv_celulas < cv_focos,
             "tecnicas": resultados}
    with open(os.path.join(comum.DIR_SAIDA, "resultados.json"), "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)

    print("\n%-22s %8s %8s %8s %6s %6s %6s %8s" % ("tecnica", "WAPE", "vies", "spear", "an2", "an3", "CV", "deriva"))
    for nome, r in resultados.items():
        t = r["teste"]
        print("%-22s %7.2f%% %7.2f%% %8.3f %5.1f%% %5.1f%% %6.3f %7.2f%%  picos %s" % (
            nome, t["wape_pct"], t["vies_pct"], t["spearman"], t["anomalia_2classes_pct"],
            t["anomalia_3classes_pct"], r["cv_razao_anual"], r["deriva"]["wape_pct"], t["pico"]["concordam"]))
    print("B0 razao:", resultados["B0_taxa_unica"]["parametros_teste"])
    print("cv focos %.3f x celulas %.3f" % (cv_focos, cv_celulas))


if __name__ == "__main__":
    main()
