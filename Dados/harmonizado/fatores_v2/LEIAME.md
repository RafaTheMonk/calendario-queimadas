# Modelo com fatores, versão 2

Gerado em 14/11/2026 por `python3 -I Scripts/harmonizacao/fatores/versao2.py` (uns 45 segundos), com as correções apontadas na revisão independente da fase A.

- `resultados_v2.json`: triagem condicionada (com sinal comparado à hipótese), fatores mantidos, pesos com intervalo de 95% por bootstrap de anos, métricas no teste (meses válidos e 48 meses), deriva, faixa de previsão e cobertura, validação espacial com triagem por dobra, médias anuais de 2003 a 2011 pelas três leituras.
- `serie_pre2012_leituras.csv`: 2003-01 a 2012-01, com as leituras T1 pelo Aqua, modelo v2 pelo Aqua e T1 pelo Terra, a faixa (mínimo e máximo das três) e a banda de 95% do modelo v2.

O site lê esses arquivos em `Scripts/gerar_json_site.py`.
