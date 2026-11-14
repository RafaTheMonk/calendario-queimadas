"""T3: quantile mapping. Para cada mes do ano m, junta os pares de calibracao
dos meses m-1, m, m+1 (circular). O valor Aqua x vai ao percentil na
distribuicao empirica Aqua desse conjunto e devolve o valor S-NPP no mesmo
percentil (interpolacao linear entre quantis empiricos). Fora da faixa, extrapola
com a razao dos extremos (S-NPP extremo / Aqua extremo)."""
import numpy as np
from comum import mes_do_ano


def calibrar(meses, aqua, viirs):
    params = {}
    for m in range(1, 13):
        vizinhos = {(m - 2) % 12 + 1, m, m % 12 + 1}
        va = sorted(aqua[mes] for mes in meses if mes_do_ano(mes) in vizinhos)
        vv = sorted(viirs[mes] for mes in meses if mes_do_ano(mes) in vizinhos)
        params[str(m)] = {"quantis_aqua": va, "quantis_viirs": vv, "n": len(va)}
    return {"por_mes": params}


def prever(params, mes, x):
    p = params["por_mes"][str(mes_do_ano(mes))]
    qa, qv = p["quantis_aqua"], p["quantis_viirs"]
    if x < qa[0]:
        # abaixo do minimo observado: razao dos minimos (se o minimo Aqua for 0, razao das somas)
        r = qv[0] / qa[0] if qa[0] > 0 else sum(qv) / max(sum(qa), 1e-12)
        return r * x
    if x > qa[-1]:
        r = qv[-1] / qa[-1]
        return r * x
    # Os n valores ordenados ocupam os percentis k/(n-1); interpolar x em qa
    # e ler o mesmo percentil em qv equivale a np.interp(x, qa, qv).
    return float(np.interp(x, qa, qv))
