"""Regressao de Poisson com ligacao log, por IRLS, so com numpy.

ajustar(X, y, ridge=0): minimiza a deviance de Poisson com penalizacao ridge
opcional (lambda * soma dos quadrados dos coeficientes, sem penalizar a
primeira coluna, que deve ser o intercepto). O IRLS usa meio passo
(step halving) se a deviance piorar e para quando a variacao relativa da
deviance fica abaixo de tol.
"""
import numpy as np

ETA_MIN, ETA_MAX = -30.0, 30.0


def deviance(y, mu):
    """Deviance de Poisson: 2 * soma(y log(y/mu) - (y - mu))."""
    with np.errstate(divide="ignore", invalid="ignore"):
        termo = np.where(y > 0, y * np.log(y / mu), 0.0)
    return float(2.0 * np.sum(termo - (y - mu)))


def _objetivo(y, mu, beta, ridge):
    return deviance(y, mu) + ridge * float(np.sum(beta[1:] ** 2))


def ajustar(X, y, ridge=0.0, tol=1e-10, max_iter=100):
    """Devolve dict com beta, convergiu, iteracoes, deviance, mu, cov_modelo (inversa de X'WX)."""
    X = np.asarray(X, float)
    y = np.asarray(y, float)
    n, p = X.shape
    pen = np.full(p, float(ridge))
    pen[0] = 0.0
    # partida: intercepto = log(media de y), demais zero
    beta = np.zeros(p)
    beta[0] = np.log(max(y.mean(), 1e-8))
    eta = np.clip(X @ beta, ETA_MIN, ETA_MAX)
    mu = np.exp(eta)
    obj = _objetivo(y, mu, beta, ridge)
    convergiu, it = False, 0
    for it in range(1, max_iter + 1):
        z = eta + (y - mu) / mu
        XtW = X.T * mu
        H = XtW @ X + np.diag(pen)
        g = XtW @ z
        beta_novo = np.linalg.solve(H, g)
        passo = 1.0
        while True:
            b = beta + passo * (beta_novo - beta)
            e = np.clip(X @ b, ETA_MIN, ETA_MAX)
            m = np.exp(e)
            obj_novo = _objetivo(y, m, b, ridge)
            if np.isfinite(obj_novo) and obj_novo <= obj + 1e-12 * abs(obj):
                break
            passo /= 2
            if passo < 1e-10:
                break
        variacao = abs(obj - obj_novo) / (abs(obj_novo) + 0.1)
        beta, eta, mu, obj = b, e, m, obj_novo
        if variacao < tol:
            convergiu = True
            break
    XtW = X.T * mu
    H = XtW @ X + np.diag(pen)
    cov = np.linalg.inv(H)
    return {"beta": beta, "convergiu": bool(convergiu), "iteracoes": it,
            "deviance": deviance(y, mu), "mu": mu, "cov_modelo": cov,
            "ridge": float(ridge), "n": int(n), "p": int(p)}


def prever(X, beta):
    return np.exp(np.clip(np.asarray(X, float) @ beta, ETA_MIN, ETA_MAX))


def pearson_dispersao(y, mu, p):
    """Qui-quadrado de Pearson / graus de liberdade (n - p). Perto de 1 = Poisson puro."""
    chi2 = float(np.sum((y - mu) ** 2 / mu))
    return chi2, chi2 / (len(y) - p)


def erro_padrao_quasi(ajuste, y):
    """Erro padrao com escala quasi-Poisson: sqrt(phi) * sqrt(diag((X'WX)^-1))."""
    _, phi = pearson_dispersao(y, ajuste["mu"], ajuste["p"])
    return np.sqrt(max(phi, 1.0) * np.diag(ajuste["cov_modelo"])), phi


def autoteste():
    """Testes de convergencia e de recuperacao de coeficientes (levanta AssertionError se falhar)."""
    rng = np.random.default_rng(12345)
    # 1. so intercepto: beta0 = log(media)
    y = rng.poisson(7.0, 5000).astype(float)
    r = ajustar(np.ones((5000, 1)), y)
    assert r["convergiu"] and abs(r["beta"][0] - np.log(y.mean())) < 1e-8
    # 2. recupera coeficientes conhecidos e zera o score X'(y - mu)
    n = 40000
    X = np.column_stack([np.ones(n), rng.normal(size=n), rng.normal(size=n), (rng.random(n) < 0.3).astype(float)])
    verdadeiro = np.array([1.2, 0.5, -0.3, 0.8])
    y = rng.poisson(np.exp(X @ verdadeiro)).astype(float)
    r = ajustar(X, y)
    assert r["convergiu"], "nao convergiu"
    assert np.max(np.abs(r["beta"] - verdadeiro)) < 0.03, r["beta"]
    assert np.max(np.abs(X.T @ (y - r["mu"]))) < 1e-4 * n
    _, phi = pearson_dispersao(y, r["mu"], 4)
    assert abs(phi - 1.0) < 0.05
    # 3. contagens grandes e zeros em excesso nao quebram
    y2 = np.where(rng.random(n) < 0.5, 0.0, rng.poisson(np.exp(X @ verdadeiro) * 20)).astype(float)
    r2 = ajustar(X, y2)
    assert r2["convergiu"] and np.all(np.isfinite(r2["beta"]))
    # 4. ridge encolhe os coeficientes
    r3 = ajustar(X, y, ridge=5000.0)
    assert np.sum(r3["beta"][1:] ** 2) < np.sum(r["beta"][1:] ** 2)
    return {"it_teste2": r["iteracoes"], "max_erro_beta": float(np.max(np.abs(r["beta"] - verdadeiro))),
            "phi_poisson_puro": phi}


if __name__ == "__main__":
    print(autoteste())
