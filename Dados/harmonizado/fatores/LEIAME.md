# Modelo com fatores (fase A), MODIS x VIIRS na Bahia

Gerado em 14/11/2026 por `python3 -I Scripts/harmonizacao/fatores/avaliar_fatores.py` (a partir da pasta NasaSpaceApps, uns 4 minutos). O clima vem de `Dados/nasa_power/` (baixado por `baixar_power.py`, 1 chamada por parâmetro).

## O que tem aqui

- `tabela_celula_mes.csv`: 309 células da grade NASA POWER (0,5 x 0,625 grau) x 276 meses = 85.284 linhas. Contagens V (S-NPP), A (Aqua), T (Terra), N20 e os fatores. Campos de FRP, fração noturna, scan e hora vazios quando não houve foco do sensor no mês. O domínio são os pontos da grade que viram ao menos um foco MODIS em 2003-2025 (tira o mar). Nenhum foco VIIRS ficou de fora.
- `triagem.json` (Aqua) e `triagem_terra.json`: razão V/MODIS no décimo mais alto e no mais baixo de cada fator, efeito em %, intervalo por bootstrap de anos (500) e decisão. Descartados também estão lá.
- `modelo_aqua.json` e `modelo_terra.json`: fórmula, padronização (média e desvio do treino), pesos com intervalo de 95% e leitura em linguagem simples, sobredispersão, faixa de previsão, ablação, extrapolação e o ajuste de produção (2012-02 a 2021-12) usado na série.
- `resultados_fatores.json`: todas as métricas (teste, deriva, espaço, cobertura, T1 nos mesmos meses, pré-2012).
- `serie_bahia_mensal_fatores.csv`: 276 meses (2003-01 a 2025-12). `focos_harmonizados` é o VIIRS real a partir de 2012-02 (NOAA-20 ajustado em 5 meses com S-NPP incompleto) e o Aqua convertido antes. Faixa de 95% só nos meses convertidos (nos reais fica igual ao valor). `viirs_real` fica vazio antes de 2012-02 porque o S-NPP não existia. Unidade: focos equivalentes VIIRS S-NPP.

## Método em uma linha

Poisson com ligação log (IRLS em numpy): `log E[V] = b0 + b1 log(n+1) + b2 [n==0] + soma bk zk (+ mês do ano)`, n = focos do MODIS da célula e mês, zk = fator padronizado. Triagem por extremos (efeito de pelo menos 10% e intervalo sem zero) decide os fatores. Mês do ano entra só se reduzir o erro deixando um ano de fora na calibração. Sobredispersão grande (Pearson/gl 7,5 no Aqua, 16,4 no Terra): coeficientes do Poisson mantidos, intervalos por bootstrap de anos.

## Resultado, sem enfeite

Teste 2020-2023, soma da Bahia por mês, Aqua (44 meses válidos, a T1 foi recalculada com a mesma máscara):

| | WAPE | viés | acima/abaixo do normal | deriva 2024-2025 |
|---|---|---|---|---|
| T1 (taxa por mês do ano) | 7,2% | +0,2% | 90,9% | 13,5% |
| Modelo com fatores | 8,4% | -5,4% | 88,6% | 10,2% |

- **A meta de 5% não foi atingida.** O modelo não superou a T1 no teste principal. Nem a T1 calibrada nos próprios meses de teste chega a 5% (piso de 6,5%).
- O modelo ganha na deriva do Aqua (10,2% contra 13,5%) e no espaço: faixa leste 14,8% contra 29,5% da T1, oeste 13,1% contra 15,0%, centro empata (12,7% contra 12,2%).
- Quase toda a sazonalidade vem do mês do ano e do número de focos do Terra. Os fatores físicos acrescentam pouco ao erro mensal da Bahia (ver `ablacao` nos JSON), mas dão pesos interpretáveis.
- A faixa de 95% da previsão (erro deixando um ano de fora) cobriu 41 de 44 meses de teste. A faixa só dos parâmetros cobriu 24 de 44: sozinha é estreita demais.

## Antes de 2012

A razão de focos Terra/Aqua na Bahia foi de 0,38 a 0,57 em 2003-2011 e de 0,66 a 0,81 de 2012 em diante. Os dois sensores MODIS discordam entre si antes de 2012, e isso passa para qualquer conversão. Média anual 2003-2011: T1 via Aqua 204 mil, modelo via Aqua 168 mil, modelo via Terra 132 mil, contra 125 mil do VIIRS real em 2012-2021. Nada disso pode ser validado com VIIRS (ele não existe nessa época).

## Limites

- Só a Bahia foi testada. A fórmula usa células da grade NASA POWER, então vale para outra área com essa mesma grade, mas generalizar não foi provado.
- Fatores escolhidos pela triagem marginal podem trocar de sinal quando o mês entra (temperatura, umidade); ver `pesos_sem_mes_do_ano`.
- A hora de passagem dos dois satélites está mudando (Aqua 16,5 h UTC até 2021 e 17,8 h em 2025; Terra 13,0 h e 11,4 h). A calibração de produção para em 2021-12.
