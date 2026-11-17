# Dados harmonizados MODIS x VIIRS (Bahia)

Gerados por `python3 -I Scripts/harmonizacao/avaliar.py` (a partir da pasta NasaSpaceApps).

**Qual número vale:** `resultados.json` é a primeira avaliação (14/11/2026), com 45 meses de teste e sem a regra de dias degradados do Aqua; nela a T1 dá 7,9%. O número publicado (7,2% em 44 meses, viés de +0,3%) vem de `fatores_v2/resultados_v2.json` (`Scripts/harmonizacao/fatores/versao2.py`), que também tira agosto de 2020 (Aqua com 5 dias degradados) e março de 2012 (S-NPP com 1 dia sem dado e 2 dias fracos). As taxas do site são recalculadas por `Scripts/gerar_json_site.py` com 2012-02 a 2021-12, não com o período de produção deste arquivo (2012-02 a 2023-12).

Outros arquivos desta pasta:

- `erro_por_area.json` (`Scripts/harmonizacao/erro_por_area.py`): erro da conversão em áreas menores, no mesmo teste (taxas da Bahia de 2012-2019, VIIRS real de 2020-2023): 37,2% numa célula, 26,0% em blocos de 2 x 2 células, 19,1% em 4 x 4 e 7,2% na Bahia.
- `replicacao_regioes.json` (`Scripts/resumo_regioes.py`): o mesmo teste em 10 países e na Bahia.
- `conferencia_api.json` (`Scripts/conferir_com_api.py`): arquivos anuais contra a API do FIRMS, 98 de 120 janelas iguais.

- `resultados.json`: métricas de B0 (taxa única), T1, T2 (g = 0,01, 0,05 e 0,1) e T3 nos períodos de teste (2020-2023) e deriva (2024-2025), mais os parâmetros calibrados (teste: 2012-02 a 2019-12; produção: 2012-02 a 2023-12).
- `t1_fator_sazonal_bahia_mensal.csv`, `t2_grade_celulas_bahia_mensal.csv`, `t3_quantile_mapping_bahia_mensal.csv`: série mensal 2003-01 a 2025-12 (276 linhas).
  - `aqua_bruto`: contagem do MODIS Aqua na unidade da técnica (focos ou células-dia com fogo, g = 0,05).
  - `viirs_real`: contagem do VIIRS S-NPP, vazia antes de 2012-02.
  - `modis_convertido`: Aqua convertido para a escala VIIRS com o ajuste de produção.
  - `harmonizado`: VIIRS real a partir de 2012-02, antes disso o MODIS convertido; `origem` diz qual.
  - `dias_sem_dado_*`: dias do mês sem dado do satélite na cobertura diária. `sinalizado` = sim com 3 ou mais dias sem dado no Aqua ou no S-NPP. Meses sinalizados ficam fora da calibração e das métricas, mas aparecem na série.
