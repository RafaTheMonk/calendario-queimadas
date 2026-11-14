"""T1: fator sazonal. r_m = soma S-NPP / soma Aqua nos meses de calibracao
do mes do ano m. Previsao = r_m x Aqua. Unidade: focos (ou outra contagem,
quando reaproveitado pelo T2)."""
from comum import mes_do_ano


def calibrar(meses, aqua, viirs):
    """Razao por mes do ano (1 a 12) usando so os meses dados."""
    soma_a = {m: 0.0 for m in range(1, 13)}
    soma_v = {m: 0.0 for m in range(1, 13)}
    n = {m: 0 for m in range(1, 13)}
    for mes in meses:
        m = mes_do_ano(mes)
        soma_a[m] += aqua[mes]
        soma_v[m] += viirs[mes]
        n[m] += 1
    razao = {m: soma_v[m] / soma_a[m] for m in range(1, 13)}
    return {"razao_por_mes": {str(m): razao[m] for m in razao},
            "meses_usados_por_mes": {str(m): n[m] for m in n}}


def prever(params, mes, x):
    return params["razao_por_mes"][str(mes_do_ano(mes))] * x
