"""Modelo com fatores (fase A): monta a tabela, faz a triagem por extremos, ajusta
o modelo de Poisson, valida no tempo e no espaco e grava as saidas.

Uso (a partir de NasaSpaceApps): python3 -I Scripts/harmonizacao/fatores/avaliar_fatores.py
Saidas em Dados/harmonizado/fatores/.
"""
import csv
import json
import math
import os
import sys
import time

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(os.path.dirname(AQUI))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.dirname(AQUI))   # harmonizacao
sys.path.insert(0, SCRIPTS)

import avaliar  # noqa: E402  (metricas e referencia de anomalia, as mesmas da T1)
import comum  # noqa: E402
import gerar_json_site  # noqa: E402  (dias degradados do Aqua)
import glm  # noqa: E402
import modelo  # noqa: E402
import montar_tabela  # noqa: E402
import t1_fator_sazonal as t1  # noqa: E402
import triagem  # noqa: E402

MESES = comum.MESES_SERIE
NM = len(MESES)
IDX = {m: i for i, m in enumerate(MESES)}
B_BOOT = 500            # reamostragens por ano (principal)
B_FOLD = 200            # triagem nas dobras espaciais
SEMENTE = 20261114
LIMITE_PCT = 10.0
ARQ_SAIDA = comum.DIR_SAIDA + "/fatores"
MES_PROD_FIM = "2021-12"   # ajuste de producao: antes da deriva do Aqua (igual ao site)

ROTULOS = {
    "log_n_mais_1": "log(n+1) (n = focos do MODIS na celula e mes)",
    "indicador_n_zero": "indicador n == 0",
    "frp_medio_log": "FRP medio dos focos (log)",
    "frac_noturna": "fracao de focos noturnos",
    "scan_medio": "scan medio (tamanho do pixel)",
    "hora_dia": "hora media da passagem diurna (UTC)",
    "log_terra_mais_1": "log(T+1) do Terra",
    "chuva": "chuva (mm/dia)", "vento": "vento a 10 m (m/s)", "umidade": "umidade relativa (%)",
    "temperatura": "temperatura a 2 m (C)", "altitude": "altitude (m)",
}
# (passo na unidade original, texto do passo, log2?) para a leitura em unidade original
UNIDADES = {
    "frp_medio_log": (1.0, "dobrar o FRP medio (de x para 2x)", True),
    "log_terra_mais_1": (1.0, "dobrar T+1 (focos do Terra na celula e mes)", True),
    "frac_noturna": (0.1, "cada +10 pontos percentuais de focos noturnos", False),
    "scan_medio": (0.1, "cada +0,1 km de scan", False),
    "hora_dia": (1.0, "cada +1 hora na passagem diurna", False),
    "chuva": (1.0, "cada +1 mm/dia de chuva", False),
    "vento": (1.0, "cada +1 m/s de vento", False),
    "umidade": (10.0, "cada +10 pontos de umidade relativa", False),
    "temperatura": (1.0, "cada +1 C", False),
    "altitude": (100.0, "cada +100 m de altitude", False),
}


def py(o):
    """Converte numpy para tipos do Python (para o json)."""
    if isinstance(o, dict):
        return {str(k): py(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [py(v) for v in o]
    if isinstance(o, np.ndarray):
        return py(o.tolist())
    if isinstance(o, (np.floating, float)):
        return None if not math.isfinite(o) else float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return o


def br(x, nd=2):
    return ("%.*f" % (nd, x)).replace(".", ",")


# ---------------------------------------------------------------- triagem de um sensor

def triagem_sensor(ctx, cells, idx, n_boot, semente=SEMENTE):
    sub = np.ix_(cells, idx)
    n = ctx["n"][sub]
    ok = n > 0
    v = ctx["V"][sub][ok].astype(float)
    a = n[ok].astype(float)
    anos = np.repeat(ctx["anos"][idx][None, :], len(cells), axis=0)[ok]
    candidatos = {"log_n_mais_1": ctx["logn"][sub][ok]}
    for nome, mat in ctx["brutos"].items():
        candidatos[nome] = mat[sub][ok]
    saida = []
    for nome, x in candidatos.items():
        f = np.isfinite(x)
        r = triagem.triar({nome: x[f]}, v[f], a[f], anos[f], n_boot=n_boot, limite_pct=LIMITE_PCT,
                          semente=semente, sempre_mantidos=("log_n_mais_1",))[0]
        r["n_celulas_mes"] = int(f.sum())
        saida.append(r)
    return saida


def fatores_mantidos(tri):
    return [r["fator"] for r in tri if r["mantido"] and r["fator"] != "log_n_mais_1"]


# ---------------------------------------------------------------- ajuste de uma variante

def ajustar_variante(ctx, cells, idx_calib, nomes, com_mes, ridge):
    padr = modelo.padronizacao(ctx, nomes, cells, idx_calib)
    X = modelo.matriz(ctx, nomes, padr, cells, com_mes)
    Xl, yl = modelo.recortar(X, ctx["V"], cells, idx_calib)
    r = glm.ajustar(Xl, yl, ridge=ridge)
    r["padr"], r["X"], r["yl"] = padr, X, yl
    return r


def wape_idx(real, prev, idx):
    idx = list(idx)
    return float(np.abs(prev[idx] - real[idx]).sum() / real[idx].sum() * 100)


# ---------------------------------------------------------------- leitura dos pesos

def tabela_pesos(nomes_col, beta, padr, ic, ep_quasi, com_mes):
    linhas = []
    soma_abs = sum(abs(beta[i]) for i, c in enumerate(nomes_col) if c in padr)
    for i, c in enumerate(nomes_col):
        lo, hi = ic[0][i], ic[1][i]
        item = {"termo": c, "rotulo": ROTULOS.get(c, c), "peso": float(beta[i]), "ic95": [float(lo), float(hi)],
                "erro_padrao_quasi_poisson": float(ep_quasi[i]),
                "efeito_multiplicativo": float(math.exp(beta[i])), "ic95_multiplicativo": [math.exp(lo), math.exp(hi)],
                "ic_cruza_zero": bool(lo <= 0 <= hi)}
        if c in padr:
            m, s = padr[c]
            item.update({"media_treino": m, "desvio_treino": s,
                         "importancia_pct": float(abs(beta[i]) / soma_abs * 100) if soma_abs else None})
            mult, ml, mh = math.exp(beta[i]), math.exp(lo), math.exp(hi)
            txt = ("cada 1 desvio-padrao a mais de %s (1 desvio = %s) multiplica a razao VIIRS/MODIS por %s (IC 95%%: %s a %s)"
                   % (ROTULOS[c], br(s, 3), br(mult, 3), br(ml, 3), br(mh, 3)))
            if c in UNIDADES:
                passo, txt_passo, lg = UNIDADES[c]
                fator = math.exp(beta[i] / s * (math.log(2) if lg else passo))
                fl = math.exp(lo / s * (math.log(2) if lg else passo))
                fh = math.exp(hi / s * (math.log(2) if lg else passo))
                txt += "; em unidade original, %s multiplica por %s (IC 95%%: %s a %s)" % (txt_passo, br(fator, 3), br(fl, 3), br(fh, 3))
                item["efeito_na_unidade_original"] = {"passo": txt_passo, "multiplicador": fator, "ic95": [fl, fh]}
            if item["ic_cruza_zero"]:
                txt += ". Atencao: o intervalo inclui 1, efeito nao distinguivel de zero"
            item["leitura"] = txt
        elif c == "log_n_mais_1":
            item["leitura"] = ("elasticidade: dobrar (n+1) multiplica o esperado de V por %s; se for menor que 2, a razao V/n cai quando "
                               "o MODIS conta mais focos" % br(2 ** beta[i], 3))
        elif c == "indicador_n_zero":
            item["leitura"] = ("celula-mes sem foco MODIS (n = 0): com todos os fatores na media, o esperado de V e exp(b0 + b2) = %s focos VIIRS por celula-mes"
                               % br(math.exp(beta[0] + beta[i]), 2))
        elif c == "intercepto":
            item["leitura"] = "constante do modelo (log do esperado de V com todos os termos em zero); so faz sentido junto com os demais termos"
        else:
            item["leitura"] = "efeito do mes do ano em relacao a janeiro: multiplica por %s" % br(math.exp(beta[i]), 3)
        linhas.append(item)
    return linhas



def t1_loyo_wape(base_dict, real, ok, idx_calib):
    """WAPE da T1 deixando um ano da calibracao de fora (mesma ideia do LOYO do modelo)."""
    anos = sorted({MESES[i][:4] for i in idx_calib})
    err = tot = 0.0
    for a in anos:
        tr = [MESES[i] for i in idx_calib if MESES[i][:4] != a]
        fo = [MESES[i] for i in idx_calib if MESES[i][:4] == a]
        par = t1.calibrar(tr, base_dict, real)
        for m in fo:
            err += abs(t1.prever(par, m, base_dict[m]) - real[m])
            tot += real[m]
    return float(err / tot * 100)


def ablacao(ctx, cells, idx_calib, nomes_triagem, ref, real, meses_teste, meses_deriva, ridge):
    """Mesmo modelo com conjuntos diferentes de termos, para ver o que cada bloco acrescenta."""
    todos = list(ctx["brutos"].keys())
    clima = [k for k in todos if k in ("chuva", "vento", "umidade", "temperatura", "altitude")]
    outro = [k for k in todos if k == "log_terra_mais_1"]
    conjuntos = [("so_base_sem_mes", [], False), ("so_base_com_mes", [], True),
                 ("base_mais_outro_sensor_com_mes", outro, True), ("so_clima_com_mes", clima, True),
                 ("clima_mais_outro_sensor_com_mes", clima + outro, True),
                 ("triagem_sem_mes", nomes_triagem, False), ("triagem_com_mes", nomes_triagem, True),
                 ("todos_os_fatores_sem_mes", todos, False), ("todos_os_fatores_com_mes", todos, True)]
    saida = {}
    for nome, nm, cm in conjuntos:
        fit = ajustar_variante(ctx, cells, idx_calib, nm, cm, ridge)
        tp = modelo.total_previsto(fit["X"], fit["beta"])
        prev = {m: float(tp[i]) for i, m in enumerate(MESES)}
        ix, r, pr = modelo.loyo(fit["X"], ctx["V"], cells, idx_calib, ctx, ridge)
        t = avaliar.metricas(meses_teste, prev, real, ref)
        d = avaliar.metricas(meses_deriva, prev, real, ref)
        saida[nome] = {"fatores": nm, "mes_do_ano": cm, "wape_loyo_pct": float(np.abs(pr - r).sum() / r.sum() * 100),
                       "wape_teste_pct": t["wape_pct"], "vies_teste_pct": t["vies_pct"],
                       "anomalia_2classes_teste_pct": t["anomalia_2classes_pct"], "wape_deriva_pct": d["wape_pct"]}
    return saida


def extrapolacao(ctx, nomes, padr, idx_treino, idx_alvo):
    """Parcela dos focos do MODIS (peso = n) em celulas-mes do periodo alvo cujo fator sai do
    intervalo [p1, p99] visto no treino. Mede o quanto a conversao de 2003-2011 extrapola."""
    sub_t = np.ix_(np.arange(ctx["nc"]), idx_treino)
    sub_a = np.ix_(np.arange(ctx["nc"]), idx_alvo)
    n_t, n_a = ctx["n"][sub_t], ctx["n"][sub_a]
    out = {}
    for nome in nomes:
        xt = ctx["brutos"][nome][sub_t][n_t > 0]
        xt = xt[np.isfinite(xt)]
        lo, hi = np.percentile(xt, [1, 99])
        xa = ctx["brutos"][nome][sub_a]
        ok = np.isfinite(xa) & (n_a > 0)
        fora = ok & ((xa < lo) | (xa > hi))
        out[nome] = {"faixa_treino_p1_p99": [float(lo), float(hi)],
                     "pct_focos_fora": float(n_a[fora].sum() / max(n_a[ok].sum(), 1) * 100)}
    return out

# ---------------------------------------------------------------- principal

def main():
    t0 = time.time()
    auto = glm.autoteste()
    print("autoteste do IRLS:", auto)

    print("montando a tabela celula x mes...")
    tab = montar_tabela.montar()
    os.makedirs(ARQ_SAIDA, exist_ok=True)
    montar_tabela.salvar_csv(tab, os.path.join(ARQ_SAIDA, "tabela_celula_mes.csv"))
    nc = len(tab["celulas"])
    V, A, T, N20 = tab["V"], tab["A"], tab["T"], tab["N20"]
    print("celulas no dominio: %d | linhas da tabela: %d | focos fora do dominio: %s" % (nc, nc * NM, tab["fora_dominio"]))

    # meses sinalizados
    degr = gerar_json_site.dias_degradados_aqua()
    sem_aqua = comum.dias_sem_dado("modis", "Aqua", MESES)
    sem_aqua_tot = {m: (sem_aqua[m] or 0) + degr.get(m, 0) for m in MESES}
    sem_snpp = comum.dias_sem_dado("viirs-snpp", "N", MESES)
    sem_terra = comum.dias_sem_dado("modis", "Terra", MESES)
    sem_n20 = comum.dias_sem_dado("viirs-jpss1", "N20", MESES)
    sinal_av = comum.sinalizar(sem_aqua_tot, sem_snpp, MESES)
    sinal_terra = comum.sinalizar(sem_terra, sem_snpp, MESES)
    sinalizados_av = [m for m in MESES if sinal_av[m]]
    sinalizados_terra = [m for m in MESES if sinal_terra[m]]
    print("sinalizados Aqua/S-NPP (incl. degradados):", sinalizados_av)
    print("sinalizados Terra/S-NPP:", sinalizados_terra)
    ok_av = np.array([not sinal_av[m] for m in MESES])
    ok_terra = np.array([not sinal_terra[m] for m in MESES])

    real_vec = V.sum(axis=0).astype(float)
    real = {m: real_vec[i] for i, m in enumerate(MESES)}
    val_prod = [m for m in comum.MESES_PRODUCAO if not sinal_av[m]]
    ref = avaliar.referencia_anomalia(real, val_prod)

    def meses_validos(lista, ok):
        return [m for m in lista if ok[IDX[m]]]

    def idx_de(lista, ok):
        return [IDX[m] for m in lista if ok[IDX[m]]]

    cells = np.arange(nc)
    resultados = {"periodos": {"calibracao": [comum.MESES_CALIB[0], comum.MESES_CALIB[-1]],
                               "teste": [comum.MESES_TESTE[0], comum.MESES_TESTE[-1]],
                               "deriva": [comum.MESES_DERIVA[0], comum.MESES_DERIVA[-1]],
                               "producao_serie": [comum.MESES_CALIB[0], MES_PROD_FIM]},
                  "dominio": {"celulas": nc, "linhas_tabela": nc * NM, "grade": "NASA POWER 0,5 x 0,625 grau",
                              "focos_fora_do_dominio": tab["fora_dominio"],
                              "criterio": "pontos da grade que viram ao menos um foco MODIS (Aqua ou Terra) em 2003-2025; so tira o mar, nao usa VIIRS"},
                  "autoteste_irls": auto,
                  "meses_sinalizados_aqua_snpp": sinalizados_av, "meses_sinalizados_terra_snpp": sinalizados_terra,
                  "modelos": {}}

    # divisao espacial: 3 faixas de longitude com numero parecido de focos (V na calibracao)
    col = tab["celulas"] % montar_tabela.NLON
    idx_cal_av = idx_de(comum.MESES_CALIB, ok_av)
    focos_col = {c: V[np.ix_(np.where(col == c)[0], idx_cal_av)].sum() for c in np.unique(col)}
    total_f = sum(focos_col.values())
    acum, cortes, faixa_col = 0.0, [total_f / 3, 2 * total_f / 3], {}
    for c in sorted(focos_col):
        acum += focos_col[c]
        faixa_col[c] = 0 if acum - focos_col[c] / 2 < cortes[0] else (1 if acum - focos_col[c] / 2 < cortes[1] else 2)
    nomes_faixa = ["oeste", "centro", "leste"]
    faixa_de_celula = np.array([faixa_col[c] for c in col])
    resultados["faixas_longitude"] = {
        nomes_faixa[k]: {"celulas": int((faixa_de_celula == k).sum()),
                         "colunas_lon": [float(montar_tabela.LON0 + montar_tabela.DLON * c) for c in sorted(faixa_col) if faixa_col[c] == k],
                         "focos_viirs_calibracao": float(sum(focos_col[c] for c in focos_col if faixa_col[c] == k))}
        for k in range(3)}
    print("faixas:", {k: (v["celulas"], v["focos_viirs_calibracao"]) for k, v in resultados["faixas_longitude"].items()})

    series_prod = {}   # sensor -> dict com previsao de producao e faixa

    for sensor, ok in (("aqua", ok_av), ("terra", ok_terra)):
        print("\n==================== modelo %s ====================" % sensor.upper())
        ctx = modelo.contexto(tab, sensor, MESES)
        n_sens = ctx["n"]
        base_dict = {m: float(n_sens.sum(axis=0)[i]) for i, m in enumerate(MESES)}
        idx_calib = idx_de(comum.MESES_CALIB, ok)
        meses_teste = meses_validos(comum.MESES_TESTE, ok)
        meses_deriva = meses_validos(comum.MESES_DERIVA, ok)
        saida = {"sensor": sensor, "n_meses_calibracao": len(idx_calib), "n_meses_teste": len(meses_teste),
                 "n_meses_deriva": len(meses_deriva)}

        # ---- passo 1: triagem
        tri = triagem_sensor(ctx, cells, idx_calib, B_BOOT)
        saida["triagem"] = tri
        nomes = fatores_mantidos(tri)
        for r in tri:
            print("  triagem %-18s efeito %7.1f%%  IC [%7.1f; %7.1f]  baixo %.2f alto %.2f  %s" % (
                r["fator"], r["efeito_pct"], r["ic95_pct"][0], r["ic95_pct"][1], r["razao_decil_baixo"],
                r["razao_decil_alto"], "MANTIDO" if r["mantido"] else "descartado"))
        print("  fatores mantidos:", nomes)

        # ---- passo 2: ajuste (sem e com mes do ano)
        padr0 = modelo.padronizacao(ctx, nomes, cells, idx_calib)
        X0 = modelo.matriz(ctx, nomes, padr0, cells, False)
        Xl0, _ = modelo.recortar(X0, ctx["V"], cells, idx_calib)
        vif, vifs = modelo.vif_max(Xl0)
        ridge = 0.0 if vif <= 10 else float(len(Xl0)) * 1e-4
        saida["colinearidade"] = {"vif_maximo": vif, "vif_por_coluna": vifs, "ridge_usado": ridge > 0, "lambda": ridge}
        print("  VIF maximo %.2f, ridge %s" % (vif, "sim (%.2f)" % ridge if ridge else "nao"))

        variantes = {}
        for com_mes in (False, True):
            fit = ajustar_variante(ctx, cells, idx_calib, nomes, com_mes, ridge)
            assert fit["convergiu"], "IRLS nao convergiu"
            tp = modelo.total_previsto(fit["X"], fit["beta"])
            ix_l, r_l, p_l = modelo.loyo(fit["X"], ctx["V"], cells, idx_calib, ctx, ridge)
            chi2, phi = glm.pearson_dispersao(fit["yl"], fit["mu"], fit["p"])
            variantes[com_mes] = {"fit": fit, "total": tp, "loyo": (ix_l, r_l, p_l),
                                  "wape_loyo": float(np.abs(p_l - r_l).sum() / r_l.sum() * 100), "phi": phi}
            print("  variante com_mes=%s: iter %d, deviance %.0f, Pearson/gl %.1f, WAPE LOYO %.2f%%" % (
                com_mes, fit["iteracoes"], fit["deviance"], phi, variantes[com_mes]["wape_loyo"]))
        ganho = variantes[False]["wape_loyo"] - variantes[True]["wape_loyo"]
        usar_mes = ganho >= 0.25
        saida["mes_do_ano"] = {"wape_loyo_sem_mes": variantes[False]["wape_loyo"], "wape_loyo_com_mes": variantes[True]["wape_loyo"],
                               "ganho_pontos": ganho, "criterio": "entra se reduzir o WAPE LOYO (deixa um ano de fora, so na calibracao) em 0,25 ponto ou mais",
                               "entrou": bool(usar_mes)}
        print("  mes do ano: ganho LOYO %.2f pontos -> %s" % (ganho, "ENTRA" if usar_mes else "nao entra"))

        # ---- passo 3a: validacao no tempo (as duas variantes; a escolhida e a principal)
        t1_par = t1.calibrar([m for m in comum.MESES_CALIB if ok[IDX[m]]], base_dict, real)
        t1_prev = {m: t1.prever(t1_par, m, base_dict[m]) for m in MESES}
        saida["t1_mesmos_meses"] = {"teste": avaliar.metricas(meses_teste, t1_prev, real, ref),
                                    "deriva": avaliar.metricas(meses_deriva, t1_prev, real, ref),
                                    "razao_por_mes": t1_par["razao_por_mes"]}
        par_orac = t1.calibrar(meses_teste, base_dict, real)
        prev_orac = {m: t1.prever(par_orac, m, base_dict[m]) for m in MESES}
        saida["t1_mesmos_meses"]["wape_loyo_pct"] = t1_loyo_wape(base_dict, real, ok, idx_calib)
        saida["t1_oraculo_no_teste"] = {"nota": "T1 calibrada nos proprios meses de teste (nao e previsao, e o piso de uma taxa fixa por mes do ano)",
                                        "wape_pct": avaliar.metricas(meses_teste, prev_orac, real, ref)["wape_pct"]}
        print("  T1 LOYO %.2f%% | piso da T1 calibrada no proprio teste %.2f%%" % (
            saida["t1_mesmos_meses"]["wape_loyo_pct"], saida["t1_oraculo_no_teste"]["wape_pct"]))
        saida["variantes"] = {}
        for com_mes, nome_v in ((False, "sem_mes"), (True, "com_mes")):
            prev = {m: float(variantes[com_mes]["total"][i]) for i, m in enumerate(MESES)}
            saida["variantes"][nome_v] = {"teste": avaliar.metricas(meses_teste, prev, real, ref),
                                          "deriva": avaliar.metricas(meses_deriva, prev, real, ref),
                                          "wape_loyo": variantes[com_mes]["wape_loyo"]}
        escolhida = variantes[usar_mes]
        nome_esc = "com_mes" if usar_mes else "sem_mes"
        saida["variante_principal"] = nome_esc
        saida["teste"] = saida["variantes"][nome_esc]["teste"]
        saida["deriva"] = saida["variantes"][nome_esc]["deriva"]
        for rot in ("teste", "deriva"):
            m, t = saida[rot], saida["t1_mesmos_meses"][rot]
            print("  %s: modelo WAPE %.2f%% vies %.2f%% an2 %.1f%% an3 %.1f%% | T1 WAPE %.2f%% vies %.2f%% an2 %.1f%%" % (
                rot, m["wape_pct"], m["vies_pct"], m["anomalia_2classes_pct"], m["anomalia_3classes_pct"],
                t["wape_pct"], t["vies_pct"], t["anomalia_2classes_pct"]))

        fit = escolhida["fit"]
        ncol = modelo.nomes_colunas(nomes, usar_mes)
        saida["ablacao"] = ablacao(ctx, cells, idx_calib, nomes, ref, real, meses_teste, meses_deriva, ridge)
        for k, v in saida["ablacao"].items():
            print("  ablacao %-34s LOYO %5.2f%% teste %5.2f%% (vies %5.1f%%) deriva %5.2f%%" % (
                k, v["wape_loyo_pct"], v["wape_teste_pct"], v["vies_teste_pct"], v["wape_deriva_pct"]))
        if usar_mes:
            # pesos do mesmo conjunto de fatores sem o mes do ano: ai o clima carrega a sazonalidade
            fit_sm = variantes[False]["fit"]
            b_sm, _, _ = modelo.bootstrap_anos(fit_sm["X"], ctx["V"], cells, idx_calib, ctx, ridge, 300, SEMENTE + 3)
            ep_sm, _ = glm.erro_padrao_quasi(fit_sm, fit_sm["yl"])
            saida["pesos_sem_mes_do_ano"] = tabela_pesos(modelo.nomes_colunas(nomes, False), fit_sm["beta"], fit_sm["padr"],
                                                          np.percentile(b_sm, [2.5, 97.5], axis=0), ep_sm, False)
        idx_pre = [i for i, m in enumerate(MESES) if m < comum.PRIMEIRO_MES_VIIRS]
        saida["extrapolacao_2003_2011"] = extrapolacao(ctx, nomes, fit["padr"], idx_calib, idx_pre)
        print("  extrapolacao 2003-2011 (% dos focos fora de p1-p99 do treino):",
              {k: round(v["pct_focos_fora"], 1) for k, v in saida["extrapolacao_2003_2011"].items()})
        saida["sobredispersao"] = {"qui2_pearson": glm.pearson_dispersao(fit["yl"], fit["mu"], fit["p"])[0],
                                   "graus_liberdade": fit["n"] - fit["p"], "phi": escolhida["phi"],
                                   "tratamento": "coeficientes do Poisson mantidos (a media continua certa); erro padrao com escala quasi-Poisson e intervalos por bootstrap de anos"}

        # ---- passo 3b: confianca por bootstrap de anos (calibracao)
        betas_b, totais_b, ruim = modelo.bootstrap_anos(fit["X"], ctx["V"], cells, idx_calib, ctx, ridge, B_BOOT, SEMENTE + 1)
        ic = np.percentile(betas_b, [2.5, 97.5], axis=0)
        ep, _ = glm.erro_padrao_quasi(fit, fit["yl"])
        saida["pesos"] = tabela_pesos(ncol, fit["beta"], fit["padr"], ic, ep, usar_mes)
        saida["bootstrap"] = {"reamostragens": B_BOOT, "nao_convergiu": int(ruim), "unidade": "anos inteiros da calibracao"}
        faixa_param = np.percentile(totais_b, [2.5, 97.5], axis=0)
        ix_l, r_l, p_l = escolhida["loyo"]
        le = np.log(r_l / p_l)
        q_lo, q_hi = np.percentile(le, [2.5, 97.5])
        pred_vec = escolhida["total"]
        faixa_pred = (pred_vec * math.exp(q_lo), pred_vec * math.exp(q_hi))
        saida["faixa_previsao"] = {"quantis_log_erro_loyo": [float(q_lo), float(q_hi)], "n_erros_loyo": int(len(le)),
                                   "descricao": "faixa de 95% = previsao x exp(quantis 2,5% e 97,5% do log(real/previsto) deixando um ano da calibracao de fora)"}

        def cobertura(lo, hi, meses):
            ix = [IDX[m] for m in meses]
            dentro = [bool(lo[i] <= real_vec[i] <= hi[i]) for i in ix]
            return {"dentro": int(sum(dentro)), "meses": len(ix), "pct": float(100 * sum(dentro) / len(ix)),
                    "fora": [m for m, d in zip(meses, dentro) if not d]}
        saida["cobertura"] = {"faixa_parametros_bootstrap_teste": cobertura(faixa_param[0], faixa_param[1], meses_teste),
                              "faixa_previsao_teste": cobertura(faixa_pred[0], faixa_pred[1], meses_teste),
                              "faixa_previsao_deriva": cobertura(faixa_pred[0], faixa_pred[1], meses_deriva)}
        print("  cobertura teste: so parametros %s | faixa de previsao %s" % (
            (saida["cobertura"]["faixa_parametros_bootstrap_teste"]["dentro"], saida["cobertura"]["faixa_parametros_bootstrap_teste"]["meses"]),
            (saida["cobertura"]["faixa_previsao_teste"]["dentro"], saida["cobertura"]["faixa_previsao_teste"]["meses"])))
        for p in saida["pesos"]:
            print("   peso %-18s %7.3f  IC [%7.3f; %7.3f]" % (p["termo"], p["peso"], p["ic95"][0], p["ic95"][1]))

        # ---- passo 3c: validacao no espaco (3 faixas de longitude)
        esp = {}
        for k in range(3):
            fora = np.where(faixa_de_celula == k)[0]
            dentro = np.where(faixa_de_celula != k)[0]
            tri_k = triagem_sensor(ctx, dentro, idx_calib, B_FOLD, SEMENTE + 10 + k)
            nomes_k = fatores_mantidos(tri_k)
            padr_k = modelo.padronizacao(ctx, nomes_k, dentro, idx_calib)
            X_k = modelo.matriz(ctx, nomes_k, padr_k, np.arange(nc), usar_mes)
            Xl_k, yl_k = modelo.recortar(X_k[dentro], ctx["V"][dentro], np.arange(len(dentro)), idx_calib)
            f_k = glm.ajustar(Xl_k, yl_k, ridge=ridge)
            assert f_k["convergiu"]
            prev_k = modelo.total_previsto(X_k[fora], f_k["beta"])
            real_k = V[fora].sum(axis=0).astype(float)
            sa_k = n_sens[dentro].sum(axis=0)
            par_k = t1.calibrar([m for m in comum.MESES_CALIB if ok[IDX[m]]],
                                {m: float(sa_k[i]) for i, m in enumerate(MESES)},
                                {m: float(V[dentro].sum(axis=0)[i]) for i, m in enumerate(MESES)})
            t1_k = np.array([t1.prever(par_k, m, float(n_sens[fora].sum(axis=0)[i])) for i, m in enumerate(MESES)])
            ix_t = [IDX[m] for m in meses_teste]
            esp[nomes_faixa[k]] = {
                "celulas_fora": int(len(fora)), "fatores_mantidos_na_dobra": nomes_k,
                "wape_modelo_pct": wape_idx(real_k, prev_k, ix_t), "wape_t1_pct": wape_idx(real_k, t1_k, ix_t),
                "vies_modelo_pct": float((prev_k[ix_t].sum() - real_k[ix_t].sum()) / real_k[ix_t].sum() * 100),
                "vies_t1_pct": float((t1_k[ix_t].sum() - real_k[ix_t].sum()) / real_k[ix_t].sum() * 100)}
            print("  espaco %-6s modelo WAPE %.2f%% (vies %.1f%%) | T1 WAPE %.2f%% (vies %.1f%%) | fatores %s" % (
                nomes_faixa[k], esp[nomes_faixa[k]]["wape_modelo_pct"], esp[nomes_faixa[k]]["vies_modelo_pct"],
                esp[nomes_faixa[k]]["wape_t1_pct"], esp[nomes_faixa[k]]["vies_t1_pct"], nomes_k))
        saida["espaco"] = esp

        # ---- producao: refaz o ajuste com 2012-02 a 2021-12 (mesmos fatores) e converte 2003 a 2025
        idx_prod = idx_de(comum.lista_meses(comum.MESES_CALIB[0], MES_PROD_FIM), ok)
        fit_p = ajustar_variante(ctx, cells, idx_prod, nomes, usar_mes, ridge)
        assert fit_p["convergiu"]
        pred_p = modelo.total_previsto(fit_p["X"], fit_p["beta"])
        ix_p, r_p, p_p = modelo.loyo(fit_p["X"], ctx["V"], cells, idx_prod, ctx, ridge)
        le_p = np.log(r_p / p_p)
        ql_p, qh_p = np.percentile(le_p, [2.5, 97.5])
        betas_p, totais_p, ruim_p = modelo.bootstrap_anos(fit_p["X"], ctx["V"], cells, idx_prod, ctx, ridge, B_BOOT, SEMENTE + 2)
        ic_p = np.percentile(betas_p, [2.5, 97.5], axis=0)
        ep_p, _ = glm.erro_padrao_quasi(fit_p, fit_p["yl"])
        saida["producao"] = {"periodo_ajuste": [comum.MESES_CALIB[0], MES_PROD_FIM], "n_meses": len(idx_prod),
                             "pesos": tabela_pesos(ncol, fit_p["beta"], fit_p["padr"], ic_p, ep_p, usar_mes),
                             "quantis_log_erro_loyo": [float(ql_p), float(qh_p)], "wape_loyo_pct": float(np.abs(p_p - r_p).sum() / r_p.sum() * 100),
                             "bootstrap_nao_convergiu": int(ruim_p)}
        faixa_param_p = np.percentile(totais_p, [2.5, 97.5], axis=0)
        t1p_s = t1.calibrar([m for m in comum.lista_meses(comum.MESES_CALIB[0], MES_PROD_FIM) if ok[IDX[m]]], base_dict, real)
        t1_conv_s = np.array([t1.prever(t1p_s, m, base_dict[m]) for m in MESES])
        series_prod[sensor] = {"t1": t1_conv_s, "pred": pred_p, "lo": pred_p * math.exp(ql_p), "hi": pred_p * math.exp(qh_p),
                               "lo_param": faixa_param_p[0], "hi_param": faixa_param_p[1]}
        # parametros do modelo de validacao e de producao, em json proprio
        saida["_ncol"] = ncol
        saida["_nomes"] = nomes
        saida["_usar_mes"] = usar_mes
        saida["_ridge"] = ridge
        saida["_padr"] = fit["padr"]
        saida["_beta"] = fit["beta"]
        saida["_padr_prod"] = fit_p["padr"]
        saida["_beta_prod"] = fit_p["beta"]
        saida["_pred_validacao"] = pred_vec
        saida["_base_dict"] = base_dict
        saida["_t1_prev"] = t1_prev
        resultados["modelos"][sensor] = saida

    # ---------------------------------------------------------------- serie 2003-2025
    print("\nmontando a serie mensal...")
    aq, te = series_prod["aqua"], series_prod["terra"]
    n20_vec = N20.sum(axis=0).astype(float)
    sv = sn = 0.0
    for i, m in enumerate(MESES):
        if real_vec[i] > 0 and n20_vec[i] > 0 and (sem_snpp[m] or 0) == 0 and (sem_n20[m] or 0) == 0:
            sv += real_vec[i]
            sn += n20_vec[i]
    razao_n20 = sv / sn
    aqua_vec = A.sum(axis=0).astype(float)
    linhas = []
    for i, m in enumerate(MESES):
        com_viirs = m >= comum.PRIMEIRO_MES_VIIRS
        if com_viirs and (sem_snpp[m] or 0) < comum.LIMITE_DIAS_SEM_DADO:
            foco, lo, hi, origem = real_vec[i], real_vec[i], real_vec[i], "VIIRS"
        elif com_viirs and n20_vec[i] > 0 and (sem_n20[m] or 0) < comum.LIMITE_DIAS_SEM_DADO:
            foco = n20_vec[i] * razao_n20
            lo, hi, origem = foco, foco, "VIIRS NOAA-20 ajustado"
        else:
            foco, lo, hi = aq["pred"][i], aq["lo"][i], aq["hi"][i]
            origem = "MODIS Aqua convertido (modelo com fatores)" if not com_viirs else "MODIS Aqua convertido (VIIRS incompleto)"
            if sinal_av[m]:
                origem += ", Aqua incompleto"
        linhas.append({"mes": m, "focos_harmonizados": foco, "faixa_inferior": lo, "faixa_superior": hi, "origem": origem,
                       "aqua_bruto": aqua_vec[i], "viirs_real": real_vec[i] if com_viirs else None,
                       "convertido_aqua": aq["pred"][i], "convertido_terra": te["pred"][i],
                       "sinalizado_aqua_snpp": "sim" if sinal_av[m] else "nao",
                       "sinalizado_terra_snpp": "sim" if sinal_terra[m] else "nao"})
    assert len(linhas) == 276
    problemas = []
    for r in linhas:
        for k in ("focos_harmonizados", "faixa_inferior", "faixa_superior", "aqua_bruto", "convertido_aqua", "convertido_terra"):
            if r[k] is None or not math.isfinite(r[k]) or r[k] < 0:
                problemas.append((r["mes"], k))
        if not r["faixa_inferior"] <= r["focos_harmonizados"] * (1 + 1e-9) or not r["focos_harmonizados"] <= r["faixa_superior"] * (1 + 1e-9):
            problemas.append((r["mes"], "faixa"))
    print("problemas na serie:", problemas)
    with open(os.path.join(ARQ_SAIDA, "serie_bahia_mensal_fatores.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        cab = ["mes", "focos_harmonizados", "faixa_inferior", "faixa_superior", "origem", "aqua_bruto", "viirs_real",
               "convertido_aqua", "convertido_terra", "sinalizado_aqua_snpp", "sinalizado_terra_snpp"]
        w.writerow(cab)
        for r in linhas:
            w.writerow([r["mes"]] + ["" if r[k] is None else (r[k] if isinstance(r[k], str) else ("%d" % round(r[k]) if k in ("aqua_bruto", "viirs_real") else "%.1f" % r[k])) for k in cab[1:]])

    # ---------------------------------------------------------------- pre-2012, consistencia, recordes
    pre = [i for i, m in enumerate(MESES) if m < comum.PRIMEIRO_MES_VIIRS]
    pos = [i for i, m in enumerate(MESES) if m >= comum.PRIMEIRO_MES_VIIRS]
    anual = {}
    for ano in range(2003, 2012):
        ii = [i for i in pre if MESES[i].startswith(str(ano))]
        anual[str(ano)] = {"aqua_bruto": float(aqua_vec[ii].sum()), "convertido_aqua": float(aq["pred"][ii].sum()),
                           "convertido_terra": float(te["pred"][ii].sum()), "terra_bruto": float(T.sum(axis=0)[ii].sum()),
                           "dif_terra_vs_aqua_pct": float((te["pred"][ii].sum() / aq["pred"][ii].sum() - 1) * 100)}
    tot_a = sum(v["convertido_aqua"] for v in anual.values())
    tot_t = sum(v["convertido_terra"] for v in anual.values())
    # T1 na mesma base (producao 2012-02 a 2021-12) e serie harmonizada de cada versao
    ok = ok_av
    t1p = t1.calibrar([m for m in comum.lista_meses("2012-02", MES_PROD_FIM) if ok[IDX[m]]],
                      {m: float(aqua_vec[i]) for i, m in enumerate(MESES)}, real)
    t1_conv = np.array([t1.prever(t1p, m, aqua_vec[i]) for i, m in enumerate(MESES)])

    def top10(vec):
        ordem = np.argsort(-vec)[:10]
        return [(MESES[i], float(vec[i])) for i in ordem]
    harm_modelo = np.array([r["focos_harmonizados"] for r in linhas])
    harm_terra = np.array([real_vec[i] if i in pos else te["pred"][i] for i in range(NM)])
    harm_t1 = np.array([real_vec[i] if i in pos else t1_conv[i] for i in range(NM)])
    tops = {"serie_modelo_aqua": top10(harm_modelo), "serie_modelo_terra": top10(harm_terra), "serie_t1": top10(harm_t1),
            "aqua_bruto_2003_2025": top10(aqua_vec)}
    for k, v in tops.items():
        v_pre = sum(1 for m, _ in v if m < comum.PRIMEIRO_MES_VIIRS)
        print("  top 10 %-24s: %d de 10 antes de 2012: %s" % (k, v_pre, [m for m, _ in v]))
    media_pre_bruto = aqua_vec[pre].sum() / 9
    anos_ref = [i for i in pos if MESES[i] <= "2021-12" and ok[i]]
    media_pos_bruto = aqua_vec[anos_ref].sum() / (len(anos_ref) / 12)
    media_pos_viirs = real_vec[anos_ref].sum() / (len(anos_ref) / 12)
    pre_info = {"top10": {k: [{"mes": m, "focos": f} for m, f in v] for k, v in tops.items()},
                "antes_de_2012_no_top10": {k: sum(1 for m, _ in v if m < comum.PRIMEIRO_MES_VIIRS) for k, v in tops.items()},
                "total_anual_convertido_2003_2011": anual,
                "total_2003_2011": {"aqua": tot_a, "terra": tot_t, "dif_terra_vs_aqua_pct": (tot_t / tot_a - 1) * 100,
                                    "t1": float(t1_conv[pre].sum())},
                "media_anual_aqua_bruto_2003_2011": float(aqua_vec[pre].sum() / 9),
                "media_anual_t1_terra_2003_2011": float(te["t1"][pre].sum() / 9),
                "media_anual_t1_aqua_2003_2011_producao": float(aq["t1"][pre].sum() / 9),
                "razao_terra_sobre_aqua_por_ano": {str(a): float(T.sum(axis=0)[[i for i in range(NM) if MESES[i].startswith(str(a))]].sum() /
                                                                 aqua_vec[[i for i in range(NM) if MESES[i].startswith(str(a))]].sum()) for a in range(2003, 2026)},
                "razao_viirs_sobre_aqua_por_ano": {str(a): float(real_vec[[i for i in range(NM) if MESES[i].startswith(str(a))]].sum() /
                                                                 aqua_vec[[i for i in range(NM) if MESES[i].startswith(str(a))]].sum()) for a in range(2012, 2026)},
                "media_anual_aqua_bruto_2012_2021": float(media_pos_bruto),
                "media_anual_viirs_real_2012_2021": float(media_pos_viirs),
                "media_anual_convertida_aqua_2003_2011": tot_a / 9, "media_anual_convertida_terra_2003_2011": tot_t / 9,
                "media_anual_convertida_t1_2003_2011": float(t1_conv[pre].sum() / 9)}
    resultados["pre_2012"] = pre_info
    print("  T1 2003-2011 (media anual): via Aqua %.0f, via Terra %.0f" % (aq["t1"][pre].sum() / 9, te["t1"][pre].sum() / 9))
    print("  razao Terra/Aqua por ano:", {a: round(v, 2) for a, v in pre_info["razao_terra_sobre_aqua_por_ano"].items()})
    print("  media anual 2003-2011: Aqua bruto %.0f, conv Aqua %.0f, conv Terra %.0f, conv T1 %.0f | 2012-2021 VIIRS real %.0f, Aqua bruto %.0f" % (
        pre_info["media_anual_aqua_bruto_2003_2011"], tot_a / 9, tot_t / 9, t1_conv[pre].sum() / 9, media_pos_viirs, media_pos_bruto))
    print("  Terra x Aqua 2003-2011: %+.1f%% no total; por ano %s" % ((tot_t / tot_a - 1) * 100, {a: round(v["dif_terra_vs_aqua_pct"], 1) for a, v in anual.items()}))
    resultados["razao_snpp_noaa20"] = razao_n20

    # ---------------------------------------------------------------- json
    for sensor in ("aqua", "terra"):
        s = resultados["modelos"][sensor]
        mj = {"sensor": sensor, "versao": "fase A, 14/11/2026",
              "formula": ("log E[V] = b0 + b1*log(n+1) + b2*[n==0] + soma bk*zk" + (" + mes do ano" if s["_usar_mes"] else "") +
                          ", com n = focos MODIS %s na celula e mes e zk = (fator - media) / desvio. A razao VIIRS/MODIS e E[V]/n." % sensor.capitalize()),
              "como_replicar": ("1) pegue as celulas da grade NASA POWER (0,5 x 0,625 grau) da area; 2) conte os focos MODIS %s (type 0, confianca >= 30) por celula e mes; "
                                "3) calcule os fatores (chuva, vento, umidade, temperatura e altitude da NASA POWER; FRP, fracao noturna, scan e hora dos focos); "
                                "4) padronize com media e desvio abaixo; 5) aplique os pesos; 6) some E[V] das celulas da area." % sensor.capitalize()),
              "termos": s["_ncol"], "fatores_mantidos": s["_nomes"], "mes_do_ano_incluido": s["_usar_mes"], "ridge": s["_ridge"],
              "preenchimento": "fator do sensor sem foco no mes recebe a media do treino (z = 0); o indicador n == 0 marca esses casos",
              "periodo_ajuste_validacao": [comum.MESES_CALIB[0], comum.MESES_CALIB[-1]],
              "padronizacao_treino": {k: {"media": v[0], "desvio": v[1]} for k, v in s["_padr"].items()},
              "pesos": s["pesos"], "sobredispersao": s["sobredispersao"], "bootstrap": s["bootstrap"],
              "faixa_previsao": s["faixa_previsao"], "colinearidade": s["colinearidade"],
              "producao": {"padronizacao_treino": {k: {"media": v[0], "desvio": v[1]} for k, v in s["_padr_prod"].items()},
                           **s["producao"]},
              "triagem": s["triagem"], "pesos_sem_mes_do_ano": s.get("pesos_sem_mes_do_ano"),
              "ablacao": s["ablacao"], "extrapolacao_2003_2011": s["extrapolacao_2003_2011"]}
        with open(os.path.join(ARQ_SAIDA, "modelo_%s.json" % sensor), "w", encoding="utf-8") as f:
            json.dump(py(mj), f, ensure_ascii=False, indent=1)
        with open(os.path.join(ARQ_SAIDA, "triagem.json" if sensor == "aqua" else "triagem_terra.json"), "w", encoding="utf-8") as f:
            json.dump(py({"sensor": sensor, "metodo": "razao soma V / soma n no decimo mais alto e no mais baixo de cada fator (celulas-mes de calibracao com n > 0); bootstrap por ano com %d reamostragens" % B_BOOT,
                          "regra": "mantem se |efeito| >= %.0f%% e o IC 95%% nao cruza zero" % LIMITE_PCT, "periodo": [comum.MESES_CALIB[0], comum.MESES_CALIB[-1]],
                          "fatores": s["triagem"]}), f, ensure_ascii=False, indent=1)
        for k in [k for k in s if k.startswith("_")]:
            del s[k]
    resultados["serie"] = {"meses": len(linhas), "problemas": problemas, "origens": {o: sum(1 for r in linhas if r["origem"] == o) for o in sorted({r["origem"] for r in linhas})}}
    with open(os.path.join(ARQ_SAIDA, "resultados_fatores.json"), "w", encoding="utf-8") as f:
        json.dump(py(resultados), f, ensure_ascii=False, indent=1)
    print("\npronto em %.0f s" % (time.time() - t0))


if __name__ == "__main__":
    main()
