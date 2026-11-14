"""Pecas do modelo com fatores: contexto por sensor, matriz de desenho, ajuste,
bootstrap por ano e validacao deixando um ano de fora (LOYO).

Modelo (por celula e mes):
  log E[V] = b0 + b1 * log(n+1) + b2 * [n == 0] + soma bk * zk  (+ meses do ano, opcional)
onde n e a contagem do MODIS (Aqua ou Terra) e zk = (fator - media do treino) / desvio do treino.
Fator do sensor (FRP, fracao noturna, scan, hora) sem foco no mes: zk = 0 (media do treino).
"""
import numpy as np

import glm

CLIMA = ["chuva", "vento", "umidade", "temperatura"]
DO_SENSOR = ["frp_medio_log", "frac_noturna", "scan_medio", "hora_dia"]


def contexto(tab, sensor, meses):
    """Prepara as matrizes celula x mes de um sensor ('aqua' ou 'terra')."""
    n = tab["A"] if sensor == "aqua" else tab["T"]
    nc, nm = n.shape
    b = {}
    with np.errstate(invalid="ignore"):
        b["frp_medio_log"] = np.log(np.maximum(tab[sensor + "_frp_medio"], 0.1))
    b["frac_noturna"] = tab[sensor + "_frac_noturna"]
    b["scan_medio"] = tab[sensor + "_scan_medio"]
    b["hora_dia"] = tab[sensor + "_hora_dia"]
    if sensor == "aqua":
        b["log_terra_mais_1"] = np.log(tab["T"] + 1.0)
    for k in CLIMA:
        b[k] = tab[k]
    b["altitude"] = np.repeat(tab["altitude"][:, None], nm, axis=1)
    mes_ano = np.array([int(m[5:7]) for m in meses])
    return {"sensor": sensor, "n": n, "V": tab["V"], "logn": np.log(n + 1.0), "zero": (n == 0).astype(float),
            "brutos": b, "mes_ano": mes_ano, "anos": np.array([m[:4] for m in meses]), "nc": nc, "nm": nm,
            "celulas": tab["celulas"]}


def padronizacao(ctx, nomes, cells, idx_meses):
    """Media e desvio do treino (celulas x meses de treino). Fator do sensor: so onde existe."""
    out = {}
    for nome in nomes:
        x = ctx["brutos"][nome][np.ix_(cells, idx_meses)]
        x = x[np.isfinite(x)]
        sd = x.std()
        out[nome] = (float(x.mean()), float(sd if sd > 0 else 1.0))
    return out


def matriz(ctx, nomes, padr, cells, com_mes=False):
    """X (celulas, meses, p): intercepto, log(n+1), [n==0], fatores padronizados, dummies de mes."""
    cols = [np.ones((len(cells), ctx["nm"])), ctx["logn"][cells], ctx["zero"][cells]]
    for nome in nomes:
        m, s = padr[nome]
        z = (ctx["brutos"][nome][cells] - m) / s
        cols.append(np.where(np.isfinite(z), z, 0.0))
    if com_mes:
        for k in range(2, 13):
            cols.append(np.repeat((ctx["mes_ano"] == k).astype(float)[None, :], len(cells), axis=0))
    return np.stack(cols, axis=2)


def nomes_colunas(nomes, com_mes):
    base = ["intercepto", "log_n_mais_1", "indicador_n_zero"] + list(nomes)
    if com_mes:
        base += ["mes_%02d" % k for k in range(2, 13)]
    return base


def recortar(X, V, cells, idx_meses):
    """Linhas (celula, mes) dos meses pedidos, em ordem C: devolve (Xl, yl)."""
    Xl = X[:, idx_meses, :].reshape(-1, X.shape[2])
    yl = V[np.ix_(cells, idx_meses)].ravel().astype(float)
    return Xl, yl


def total_previsto(X, beta):
    """Soma sobre as celulas da previsao, por mes (vetor de nm)."""
    eta = np.clip(X @ beta, glm.ETA_MIN, glm.ETA_MAX)
    return np.exp(eta).sum(axis=0)


def vif_max(X, n_base=3):
    """Maior fator de inflacao da variancia entre as colunas dos fatores (sem base e sem mes)."""
    Z = X[:, n_base:]
    if Z.shape[1] < 2:
        return 1.0, None
    R = np.corrcoef(Z, rowvar=False)
    v = np.diag(np.linalg.inv(R))
    return float(v.max()), [float(x) for x in v]


def bootstrap_anos(X, V, cells, idx_calib, ctx, ridge, B, semente):
    """Reamostra anos inteiros da calibracao B vezes. Devolve (betas B x p, totais B x nm, n_nao_convergiu)."""
    rng = np.random.default_rng(semente)
    anos = sorted({ctx["anos"][m] for m in idx_calib})
    por_ano = {a: [m for m in idx_calib if ctx["anos"][m] == a] for a in anos}
    betas, totais, ruim = [], [], 0
    for _ in range(B):
        sorteio = rng.choice(len(anos), size=len(anos), replace=True)
        idx = [m for s in sorteio for m in por_ano[anos[s]]]
        Xl, yl = recortar(X, V, cells, idx)
        r = glm.ajustar(Xl, yl, ridge=ridge)
        ruim += 0 if r["convergiu"] else 1
        betas.append(r["beta"])
        totais.append(total_previsto(X, r["beta"]))
    return np.array(betas), np.array(totais), ruim


def loyo(X, V, cells, idx_calib, ctx, ridge):
    """Deixa um ano da calibracao de fora, ajusta nos outros e preve o ano. Devolve (idx, real, previsto)."""
    anos = sorted({ctx["anos"][m] for m in idx_calib})
    idx_out, reais, previstos = [], [], []
    real_total = V[cells].sum(axis=0)
    for a in anos:
        treino = [m for m in idx_calib if ctx["anos"][m] != a]
        fora = [m for m in idx_calib if ctx["anos"][m] == a]
        Xl, yl = recortar(X, V, cells, treino)
        r = glm.ajustar(Xl, yl, ridge=ridge)
        tp = total_previsto(X, r["beta"])
        for m in fora:
            idx_out.append(m)
            reais.append(real_total[m])
            previstos.append(tp[m])
    return np.array(idx_out), np.array(reais), np.array(previstos)
