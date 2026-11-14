#!/usr/bin/env python3
"""Versao 2 do modelo com fatores, com as correcoes dos revisores da fase A
(revisao independente da fase A):

1. Sem o termo do Terra na formula do Aqua (log(T+1) era instavel em 2012 e na deriva).
2. Triagem condicionada: o efeito de cada fator e medido sobre o residuo do modelo base
   (log(A+1), [A==0] e mes do ano), para nao confundir fator com tamanho do fogo.
   Grupos de 10% por posicao (desempate fixo), nao por limiar com empate.
3. Sinal de cada fator comparado com a hipotese fisica (esperado ou contrario).
4. Erro do teste com os meses validos e com todos os 48 meses.
5. Referencia de anomalia calculada so com os meses de calibracao (2012-02 a 2019-12).
6. Validacao espacial com a triagem refeita dentro de cada dobra.
7. Faixa para 2003-2011 entre tres leituras: T1 pelo Aqua, modelo com fatores pelo Aqua
   e T1 pelo Terra (os dois MODIS discordam antes de 2012).

Uso: python3 -I Scripts/harmonizacao/fatores/versao2.py   (uns 2 a 3 minutos)
Saida: Dados/harmonizado/fatores_v2/
"""
import csv
import json
import os
import sys

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
HARM = os.path.dirname(AQUI)
SCRIPTS = os.path.dirname(HARM)
for p in (AQUI, HARM, SCRIPTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import avaliar  # noqa: E402
import comum  # noqa: E402
import gerar_json_site  # noqa: E402
import glm  # noqa: E402
import modelo  # noqa: E402
import montar_tabela  # noqa: E402

MESES = comum.MESES_SERIE
NM = len(MESES)
IDX = {m: i for i, m in enumerate(MESES)}
SEMENTE = 20261114
B_TRIAGEM = 500
B_PESOS = 300
B_DOBRA = 200
LIMITE_PCT = 10.0
PROD_INI, PROD_FIM = "2012-02", "2021-12"
SAIDA = os.path.join(comum.DIR_SAIDA, "fatores_v2")

FATORES = ["frp_medio_log", "frac_noturna", "scan_medio", "hora_dia", "chuva", "vento", "umidade", "temperatura", "altitude"]
# sinal esperado do efeito na razao VIIRS/MODIS (hipotese fisica): +1 sobe, -1 cai, 0 sem efeito direto
HIPOTESE = {"frp_medio_log": -1, "frac_noturna": 1, "scan_medio": 1, "hora_dia": -1, "chuva": 1,
            "vento": -1, "umidade": 1, "temperatura": -1, "altitude": 0}
NOME = {"frp_medio_log": "intensidade do fogo (FRP médio, log)", "frac_noturna": "fração de focos noturnos",
        "scan_medio": "tamanho do pixel (scan)", "hora_dia": "hora de passagem diurna",
        "chuva": "chuva (mm/dia)", "vento": "vento a 10 m (m/s)", "umidade": "umidade relativa (%)",
        "temperatura": "temperatura (°C)", "altitude": "altitude (m)"}


def py(o):
    if isinstance(o, dict):
        return {str(k): py(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [py(v) for v in o]
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.ndarray):
        return py(o.tolist())
    return o


def ajustar(ctx, cells, idx, nomes, padr=None):
    padr = padr or modelo.padronizacao(ctx, nomes, cells, idx)
    X = modelo.matriz(ctx, nomes, padr, cells, True)
    Xl, yl = modelo.recortar(X, ctx["V"], cells, idx)
    vif, _ = modelo.vif_max(Xl[:, :3 + len(nomes)]) if nomes else (1.0, None)
    ridge = 0.0 if vif <= 10 else float(len(Xl)) * 1e-4
    r = glm.ajustar(Xl, yl, ridge=ridge)
    return {"X": X, "beta": r["beta"], "padr": padr, "ajuste": r, "Xl": Xl, "yl": yl, "vif": vif, "ridge": ridge}


def triagem_condicionada(ctx, cells, idx, n_boot, semente):
    """Efeito de cada fator sobre V / E[V | base], nos 10% mais altos contra os 10% mais baixos."""
    base = ajustar(ctx, cells, idx, [])
    E = modelo.total_previsto  # so para lembrar a forma; abaixo calculo por celula
    eta = np.clip(base["X"] @ base["beta"], glm.ETA_MIN, glm.ETA_MAX)
    Ebase = np.exp(eta)  # celulas x meses
    V = ctx["V"][cells].astype(float)
    A = ctx["n"][cells]
    anos = ctx["anos"]
    idx = np.array(idx)
    anos_unicos = sorted({anos[m] for m in idx})
    rng = np.random.default_rng(semente)
    sorteios = [rng.choice(len(anos_unicos), size=len(anos_unicos), replace=True) for _ in range(n_boot)]
    desempate = np.random.default_rng(semente + 1)
    out = []
    for f in FATORES:
        x = ctx["brutos"][f][cells][:, idx]
        ok = np.isfinite(x) & (A[:, idx] > 0)
        xv, vv, ev = x[ok], V[:, idx][ok], Ebase[:, idx][ok]
        av = np.broadcast_to(np.array([anos[m] for m in idx])[None, :], x.shape)[ok]
        ordem = np.lexsort((desempate.random(len(xv)), xv))
        k = max(1, len(xv) // 10)
        baixo, alto = ordem[:k], ordem[-k:]

        def efeito(sel_b, sel_a):
            rb = vv[sel_b].sum() / ev[sel_b].sum()
            ra = vv[sel_a].sum() / ev[sel_a].sum()
            return ra / rb - 1.0, rb, ra

        ef, rb, ra = efeito(baixo, alto)
        # bootstrap por ano: soma por ano dentro de cada grupo
        def por_ano(sel):
            s_v = {a: 0.0 for a in anos_unicos}
            s_e = {a: 0.0 for a in anos_unicos}
            for a, v, e in zip(av[sel], vv[sel], ev[sel]):
                s_v[a] += v
                s_e[a] += e
            return np.array([s_v[a] for a in anos_unicos]), np.array([s_e[a] for a in anos_unicos])
        bv, be = por_ano(baixo)
        avv, ave = por_ano(alto)
        boots = []
        for s in sorteios:
            rb_s = bv[s].sum() / be[s].sum()
            ra_s = avv[s].sum() / ave[s].sum()
            boots.append(ra_s / rb_s - 1.0)
        lo, hi = np.percentile(boots, [2.5, 97.5])
        mantido = abs(ef) * 100 >= LIMITE_PCT and (lo > 0 or hi < 0)
        sinal = int(np.sign(ef))
        h = HIPOTESE[f]
        leitura = ("esperado" if sinal == h else "contrário à hipótese") if h != 0 else "sem efeito direto esperado"
        out.append({"fator": f, "nome": NOME[f], "efeito_pct": ef * 100, "ic95_pct": [lo * 100, hi * 100],
                    "razao_rel_baixo": rb, "razao_rel_alto": ra, "n_por_grupo": int(k),
                    "mantido": bool(mantido), "sinal_vs_hipotese": leitura})
    return out


def t1_ratios(num, den, meses_validos):
    sv, sa = {}, {}
    for m in meses_validos:
        k = int(m[5:7])
        sv[k] = sv.get(k, 0.0) + num[m]
        sa[k] = sa.get(k, 0.0) + den[m]
    return {k: sv[k] / sa[k] for k in sv}


def main():
    print("montando a tabela (le os CSV do FIRMS e a NASA POWER)...")
    tab = montar_tabela.montar()
    nc = len(tab["celulas"])
    cells = np.arange(nc)
    V, A, T = tab["V"], tab["A"], tab["T"]

    degr = gerar_json_site.dias_degradados_aqua()
    sem_aqua = comum.dias_sem_dado("modis", "Aqua", MESES)
    sem_aqua_tot = {m: (sem_aqua[m] or 0) + degr.get(m, 0) for m in MESES}
    sem_snpp = comum.dias_sem_dado("viirs-snpp", "N", MESES)
    sem_terra = comum.dias_sem_dado("modis", "Terra", MESES)
    sinal_av = comum.sinalizar(sem_aqua_tot, sem_snpp, MESES)
    sinal_t = comum.sinalizar(sem_terra, sem_snpp, MESES)
    validos = lambda lista, s: [m for m in lista if not s[m]]

    real = {m: float(V[:, i].sum()) for i, m in enumerate(MESES)}
    aqua_tot = {m: float(A[:, i].sum()) for i, m in enumerate(MESES)}
    terra_tot = {m: float(T[:, i].sum()) for i, m in enumerate(MESES)}

    calib = validos(comum.MESES_CALIB, sinal_av)
    teste_ok = validos(comum.MESES_TESTE, sinal_av)
    teste_todos = list(comum.MESES_TESTE)
    deriva_ok = validos(comum.MESES_DERIVA, sinal_av)
    idx_calib = [IDX[m] for m in calib]
    ref_calib = avaliar.referencia_anomalia(real, calib)

    ctx = modelo.contexto(tab, "aqua", MESES)

    # ---- triagem condicionada
    print("triagem condicionada...")
    tri = triagem_condicionada(ctx, cells, idx_calib, B_TRIAGEM, SEMENTE)
    nomes = [r["fator"] for r in tri if r["mantido"]]
    for r in tri:
        print("  %-38s efeito %+6.1f%%  IC [%+6.1f; %+6.1f]  %s  (%s)" % (
            r["nome"], r["efeito_pct"], r["ic95_pct"][0], r["ic95_pct"][1],
            "MANTIDO" if r["mantido"] else "descartado", r["sinal_vs_hipotese"]))

    # ---- modelo v2 (validacao)
    m2 = ajustar(ctx, cells, idx_calib, nomes)
    tot2 = modelo.total_previsto(m2["X"], m2["beta"])
    prev2 = {m: float(tot2[i]) for i, m in enumerate(MESES)}
    r1 = t1_ratios(real, aqua_tot, calib)
    prev_t1 = {m: r1[int(m[5:7])] * aqua_tot[m] for m in MESES}

    # modelo base (so log(A+1), [A==0] e mes), para mostrar o quanto os fatores acrescentam
    m0 = ajustar(ctx, cells, idx_calib, [])
    tot0 = modelo.total_previsto(m0["X"], m0["beta"])
    prev0 = {m: float(tot0[i]) for i, m in enumerate(MESES)}

    met = {}
    for nome_m, prev in (("modelo_v2", prev2), ("base_sem_fatores", prev0), ("T1", prev_t1)):
        met[nome_m] = {"teste_validos": avaliar.metricas(teste_ok, prev, real, ref_calib),
                       "teste_48_meses": avaliar.metricas(teste_todos, prev, real, ref_calib),
                       "deriva": avaliar.metricas(deriva_ok, prev, real, ref_calib)}
        t = met[nome_m]
        print("  %-17s teste %5.2f%% (48 meses %5.2f%%) vies %+5.1f%% | deriva %5.2f%% | acima/abaixo %4.1f%%" % (
            nome_m, t["teste_validos"]["wape_pct"], t["teste_48_meses"]["wape_pct"], t["teste_validos"]["vies_pct"],
            t["deriva"]["wape_pct"], t["teste_validos"]["anomalia_2classes_pct"]))

    # ---- pesos com intervalo (bootstrap de anos)
    betas, _, ruim = modelo.bootstrap_anos(m2["X"], ctx["V"], cells, idx_calib, ctx, m2["ridge"], B_PESOS, SEMENTE)
    cols = modelo.nomes_colunas(nomes, True)
    pesos = []
    for j, c in enumerate(cols):
        lo, hi = np.percentile(betas[:, j], [2.5, 97.5])
        item = {"termo": c, "peso": float(m2["beta"][j]), "ic95": [float(lo), float(hi)]}
        if c in m2["padr"]:
            media, dp = m2["padr"][c]
            item["desvio_padrao_treino"] = dp
            item["multiplica_razao_por_1_desvio"] = float(np.exp(m2["beta"][j]))
            item["nome"] = NOME[c]
        pesos.append(item)

    # ---- faixa de previsao (deixa um ano de fora) e cobertura no teste
    idx_out, reais, previstos = modelo.loyo(m2["X"], ctx["V"], cells, idx_calib, ctx, m2["ridge"])
    res_log = np.log(reais / previstos)
    q_lo, q_hi = np.percentile(res_log, [2.5, 97.5])
    cobertura = sum(1 for m in teste_ok if prev2[m] * np.exp(q_lo) <= real[m] <= prev2[m] * np.exp(q_hi))
    loyo_wape = float(np.abs(previstos - reais).sum() / reais.sum() * 100)

    # ---- validacao espacial com triagem refeita na dobra
    col = tab["celulas"] % montar_tabela.NLON
    focos_col = {c: V[np.ix_(np.where(col == c)[0], idx_calib)].sum() for c in np.unique(col)}
    total_f = sum(focos_col.values())
    acum, faixa_col = 0.0, {}
    for c in sorted(focos_col):
        acum += focos_col[c]
        meio = acum - focos_col[c] / 2
        faixa_col[c] = 0 if meio < total_f / 3 else (1 if meio < 2 * total_f / 3 else 2)
    faixa = np.array([faixa_col[c] for c in col])
    espaco = {}
    for k, nome_f in enumerate(["oeste", "centro", "leste"]):
        treino = np.where(faixa != k)[0]
        fora = np.where(faixa == k)[0]
        tri_k = triagem_condicionada(ctx, treino, idx_calib, B_DOBRA, SEMENTE + k)
        nomes_k = [r["fator"] for r in tri_k if r["mantido"]]
        mk = ajustar(ctx, treino, idx_calib, nomes_k)
        Xf = modelo.matriz(ctx, nomes_k, mk["padr"], fora, True)
        totf = modelo.total_previsto(Xf, mk["beta"])
        real_f = V[fora].sum(axis=0).astype(float)
        a_tr = {m: float(A[treino, IDX[m]].sum()) for m in MESES}
        v_tr = {m: float(V[treino, IDX[m]].sum()) for m in MESES}
        rk = t1_ratios(v_tr, a_tr, calib)
        a_f = A[fora].sum(axis=0)
        ii = [IDX[m] for m in teste_ok]
        w_mod = float(np.abs(totf[ii] - real_f[ii]).sum() / real_f[ii].sum() * 100)
        t1_f = np.array([rk[int(MESES[i][5:7])] * a_f[i] for i in ii])
        w_t1 = float(np.abs(t1_f - real_f[ii]).sum() / real_f[ii].sum() * 100)
        espaco[nome_f] = {"celulas": int(len(fora)), "fatores_da_dobra": nomes_k, "wape_modelo_v2": w_mod, "wape_T1": w_t1}
        print("  espaco %-6s modelo %5.1f%%  T1 %5.1f%%  fatores %s" % (nome_f, w_mod, w_t1, nomes_k))

    # ---- producao e leituras de 2003-2011
    prod = validos(comum.lista_meses(PROD_INI, PROD_FIM), sinal_av)
    prod_t = validos(comum.lista_meses(PROD_INI, PROD_FIM), sinal_t)
    mp = ajustar(ctx, cells, [IDX[m] for m in prod], nomes)
    totp = modelo.total_previsto(mp["X"], mp["beta"])
    r1p = t1_ratios(real, aqua_tot, prod)
    r1t = t1_ratios(real, terra_tot, prod_t)
    pre = [m for m in MESES if m < comum.PRIMEIRO_MES_VIIRS]
    linhas = []
    for m in pre:
        i = IDX[m]
        k = int(m[5:7])
        leit = {"t1_aqua": r1p[k] * aqua_tot[m], "fatores_aqua": float(totp[i]), "t1_terra": r1t[k] * terra_tot[m]}
        linhas.append({"mes": m, **{a: round(b) for a, b in leit.items()},
                       "faixa_inferior": round(min(leit.values())), "faixa_superior": round(max(leit.values())),
                       "banda95_fatores_inf": round(float(totp[i]) * float(np.exp(q_lo))),
                       "banda95_fatores_sup": round(float(totp[i]) * float(np.exp(q_hi)))})
    anos_pre = sorted({m[:4] for m in pre if "2003" <= m[:4] <= "2011"})
    media_anual = {}
    for chave in ("t1_aqua", "fatores_aqua", "t1_terra"):
        media_anual[chave] = float(np.mean([sum(l[chave] for l in linhas if l["mes"][:4] == a) for a in anos_pre]))
    viirs_2012_2021 = float(np.mean([sum(real[m] for m in MESES if m[:4] == str(a)) for a in range(2012, 2022)]))
    print("  media anual 2003-2011: %s | VIIRS real 2012-2021: %.0f" % ({k: round(v) for k, v in media_anual.items()}, viirs_2012_2021))

    os.makedirs(SAIDA, exist_ok=True)
    with open(os.path.join(SAIDA, "serie_pre2012_leituras.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(linhas[0].keys()))
        w.writeheader()
        w.writerows(linhas)
    resultado = {
        "versao": 2,
        "correcoes": ["sem log(T+1) do Terra na formula do Aqua", "triagem condicionada ao modelo base (log(A+1), [A==0], mes)",
                      "sinal comparado com a hipotese", "erro com 48 meses", "referencia de anomalia so com a calibracao",
                      "triagem refeita em cada dobra espacial", "faixa de 2003-2011 entre tres leituras"],
        "periodos": {"calibracao": [calib[0], calib[-1]], "teste": [teste_todos[0], teste_todos[-1]],
                     "producao": [PROD_INI, PROD_FIM]},
        "meses_validos": {"calibracao": len(calib), "teste": len(teste_ok), "deriva": len(deriva_ok)},
        "triagem": tri, "fatores_mantidos": nomes, "pesos": pesos, "bootstrap_nao_convergiu": ruim,
        "colinearidade": {"vif_maximo": m2["vif"], "ridge": m2["ridge"]},
        "sobredispersao_pearson_gl": glm.pearson_dispersao(m2["yl"], m2["ajuste"]["mu"], m2["ajuste"]["p"])[1],
        "metricas": met,
        "faixa_previsao": {"metodo": "quantis 2,5% e 97,5% de log(real/previsto) deixando um ano de fora",
                           "fator_inferior": float(np.exp(q_lo)), "fator_superior": float(np.exp(q_hi)),
                           "cobertura_teste": "%d de %d" % (cobertura, len(teste_ok)), "wape_loyo": loyo_wape},
        "espaco": espaco,
        "pre_2012": {"media_anual_2003_2011": media_anual, "viirs_real_media_anual_2012_2021": viirs_2012_2021,
                     "razoes_producao_t1_aqua": r1p, "razoes_producao_t1_terra": r1t},
    }
    with open(os.path.join(SAIDA, "resultados_v2.json"), "w", encoding="utf-8") as f:
        json.dump(py(resultado), f, ensure_ascii=False, indent=1)
    print("pronto:", SAIDA)


if __name__ == "__main__":
    main()
