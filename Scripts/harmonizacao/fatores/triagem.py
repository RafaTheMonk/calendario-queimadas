"""Triagem de fatores por extremos (metodo pedido pela mentoria).

Para cada fator, nas celulas-mes de calibracao com A > 0:
  razao_baixo = soma V / soma A nas celulas-mes do decimo mais baixo do fator
  razao_alto  = soma V / soma A nas celulas-mes do decimo mais alto
  efeito (%)  = (razao_alto / razao_baixo - 1) * 100
Bootstrap por ano (reamostra anos inteiros, recalcula os decis a cada vez) da o
intervalo. Mantem o fator se |efeito| >= limite e o intervalo de 95% nao cruza zero.
"""
import numpy as np


def _efeito(x, v, a, mascara_ok=None):
    """(razao_baixo, razao_alto) com decis recalculados em x."""
    p10, p90 = np.percentile(x, [10, 90])
    baixo, alto = x <= p10, x >= p90
    sa_b, sa_a = a[baixo].sum(), a[alto].sum()
    if sa_b <= 0 or sa_a <= 0:
        return np.nan, np.nan
    return v[baixo].sum() / sa_b, v[alto].sum() / sa_a


def triar(fatores, v, a, anos, n_boot=500, limite_pct=10.0, semente=2026, sempre_mantidos=()):
    """fatores: {nome: array}. v, a, anos: arrays alinhados (so linhas de calibracao com A > 0).

    Devolve lista de dicts, um por fator, na ordem recebida.
    """
    rng = np.random.default_rng(semente)
    anos_unicos = np.unique(anos)
    idx_ano = {y: np.where(anos == y)[0] for y in anos_unicos}
    sorteios = [rng.choice(anos_unicos, size=len(anos_unicos), replace=True) for _ in range(n_boot)]
    saida = []
    for nome, x in fatores.items():
        rb, ra = _efeito(x, v, a)
        efeito = (ra / rb - 1.0) * 100.0
        boot = []
        for s in sorteios:
            ix = np.concatenate([idx_ano[y] for y in s])
            b, h = _efeito(x[ix], v[ix], a[ix])
            if np.isfinite(b) and np.isfinite(h) and b > 0:
                boot.append((h / b - 1.0) * 100.0)
        boot = np.array(boot)
        lo, hi = np.percentile(boot, [2.5, 97.5])
        cruza = lo <= 0.0 <= hi
        mantido = (abs(efeito) >= limite_pct) and not cruza
        item = {"fator": nome, "efeito_pct": float(efeito), "ic95_pct": [float(lo), float(hi)],
                "razao_decil_baixo": float(rb), "razao_decil_alto": float(ra),
                "ic_cruza_zero": bool(cruza), "n_boot": int(len(boot)), "mantido": bool(mantido)}
        if nome in sempre_mantidos:
            item["mantido"] = True
            item["nota"] = "termo base do modelo, entra sempre; efeito mostrado so como informacao"
        elif not mantido:
            motivo = []
            if abs(efeito) < limite_pct:
                motivo.append("efeito de %.1f%%, abaixo de %.0f%%" % (efeito, limite_pct))
            if cruza:
                motivo.append("intervalo de 95%% [%.1f; %.1f] cruza zero" % (lo, hi))
            item["nota"] = "descartado: " + "; ".join(motivo)
        else:
            item["nota"] = "mantido: efeito de %.1f%% com intervalo [%.1f; %.1f]" % (efeito, lo, hi)
        saida.append(item)
    return saida
