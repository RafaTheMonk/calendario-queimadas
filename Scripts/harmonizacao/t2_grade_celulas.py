"""T2: grade de celulas-dia. Cada foco vai para a celula (floor(lat/g),
floor(lon/g)). Unidade = numero de pares unicos (celula, data) com pelo menos
um foco no mes, por sensor (a contagem esta em comum.carregar). A calibracao e
a mesma razao sazonal do T1, mas aplicada a celulas-dia."""
import t1_fator_sazonal as t1
from comum import G_PRINCIPAL


def series(dados_aqua, dados_snpp, g=G_PRINCIPAL):
    """Devolve (aqua, viirs) em celulas-dia para o tamanho de celula g."""
    return dados_aqua["celulas"][g], dados_snpp["celulas"][g]


def calibrar(meses, aqua, viirs):
    return t1.calibrar(meses, aqua, viirs)


def prever(params, mes, x):
    return t1.prever(params, mes, x)
