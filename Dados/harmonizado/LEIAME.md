# Dados harmonizados MODIS x VIIRS (Bahia)

Gerados por `python3 -I Scripts/harmonizacao/avaliar.py` (a partir da pasta NasaSpaceApps).

- `resultados.json`: métricas de B0 (taxa única), T1, T2 (g = 0,01, 0,05 e 0,1) e T3 nos períodos de teste (2020-2023) e deriva (2024-2025), mais os parâmetros calibrados (teste: 2012-02 a 2019-12; produção: 2012-02 a 2023-12).
- `t1_fator_sazonal_bahia_mensal.csv`, `t2_grade_celulas_bahia_mensal.csv`, `t3_quantile_mapping_bahia_mensal.csv`: série mensal 2003-01 a 2025-12 (276 linhas).
  - `aqua_bruto`: contagem do MODIS Aqua na unidade da técnica (focos ou células-dia com fogo, g = 0,05).
  - `viirs_real`: contagem do VIIRS S-NPP, vazia antes de 2012-02.
  - `modis_convertido`: Aqua convertido para a escala VIIRS com o ajuste de produção.
  - `harmonizado`: VIIRS real a partir de 2012-02, antes disso o MODIS convertido; `origem` diz qual.
  - `dias_sem_dado_*`: dias do mês sem dado do satélite na cobertura diária. `sinalizado` = sim com 3 ou mais dias sem dado no Aqua ou no S-NPP. Meses sinalizados ficam fora da calibração e das métricas, mas aparecem na série.
