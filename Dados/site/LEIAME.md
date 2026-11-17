# Dados do site: calendário de queimadas da Bahia

Versão 2, gerada por `Scripts/gerar_json_site.py` e completada com 2026 por `Scripts/estender_2026.py` (a versão 2 acrescenta a faixa de 2003 a 2011 e o resumo do modelo com fatores; os campos da versão 1 continuam iguais). Para refazer: `python3 -I Scripts/harmonizacao/erro_por_area.py`, `python3 -I Scripts/gerar_json_site.py` e `python3 -I Scripts/estender_2026.py` (este último lê os CSV de 2026 já baixados, não chama a API).

- `calendario_bahia.json` (cerca de 150 KB): tudo o que o site precisa
- `calendario_bahia.csv`: a mesma série mês a mês, para o botão "Baixar CSV"
- `celulas_bahia.json`: a série de cada uma das 309 células da grade NASA POWER, para o site somar uma área. `f` = focos harmonizados por mês (antes de 2012-02, a leitura do Aqua), `t` = leitura do Terra de 2003-01 a 2012-01, `a` = Aqua sem harmonizar. A faixa de uma área sai de somar cada leitura nas células e só depois tirar o mínimo e o máximo.

## O que tem no JSON

| Campo | O que é | Uso no site |
|---|---|---|
| `area` | nome e retângulo (lon/lat) | título, destacar no mapa |
| `unidade` | "focos equivalentes VIIRS Suomi NPP 375 m" | legenda |
| `fonte`, `citacao` | NASA FIRMS e a frase oficial de citação | rodapé e página "como funciona" |
| `periodo` | 2003-01 a 2026-10; 2026 vem da API do FIRMS e os meses do quase tempo real são provisórios | aviso na tela |
| `meses` | 286 meses, um objeto por mês (ver abaixo) | calendário, gráfico, CSV |
| `normal_por_mes` | mediana, média, p25 e p75 de cada mês do ano (chaves "01" a "12") | cartão "mês x normal", legenda |
| `totais_por_ano` | total de focos, meses, mês de pico e, de 2003 a 2012, a faixa do ano | coluna de totais ao lado da grade |
| `top10_meses` | os 10 meses com mais fogo | destaque |
| `metodo` | técnica, taxas por mês (calibradas com 2012-02 a 2021-12), filtros, validação (erro de 7,2% por mês nos 44 meses válidos de 2020-2023 com taxas de 2012-2019, viés de +0,3%, 97,7% de acerto acima ou abaixo da mediana) e limitações | página "como funciona" |
| `metodo.validacao.erro_por_area` | erro no mesmo teste por tamanho de área (célula, 2 x 2, 4 x 4, Bahia) | cartão de precisão de uma área |
| `metodo.meses_fora_da_calibracao` | meses de 2003-2011 em que o Aqua passou do maior mês igual da calibração (a taxa é extrapolada) | limitações |
| `metodo.dias_fracos_snpp_na_calibracao`, `metodo.meses_fora_da_calibracao_por_dias_fracos_snpp` | dias em que o S-NPP veio muito abaixo do Aqua (contam como falha, como os degradados do Aqua) e os meses que saíram da calibração por causa deles | limitações |
| `metodo.fatores` | pesos dos fatores, triagem, comparação com a T1 no teste, cobertura da faixa, a descoberta dos dois MODIS e a razão Terra/Aqua por ano | página "como funciona" |

Cada item de `meses`:

| Campo | Exemplo | O que é |
|---|---|---|
| `mes`, `ano`, `mes_num` | "2024-09", 2024, 9 | posição na grade |
| `focos` | 30307 | **o valor para colorir o calendário** (série harmonizada) |
| `origem` | "VIIRS", "MODIS convertido", "VIIRS NOAA-20 ajustado" | tooltip: de onde veio o número |
| `qualidade` | "completo" ou "corrigido" | borda ou ícone nos meses corrigidos |
| `anomalia_pct` | -13.7 | quanto ficou acima (+) ou abaixo (-) da mediana daquele mês |
| `classe` | "acima do normal", "normal", "abaixo do normal" | cor ou marcador de anomalia (acima do p75, entre p25 e p75, abaixo do p25) |
| `posicao_no_mes` | 17 | ranking: "17º setembro com mais fogo desde 2003" |
| `modis_bruto`, `viirs_real` | 6274, 30307 | gráfico "antes e depois" (o salto entre sensores) |
| `modis_convertido` | 36632 | o que a conversão daria, inclusive nos anos com VIIRS |
| `dias_sem_dado_aqua`, `dias_degradados_aqua`, `dias_sem_dado_viirs` | 0, 0, 1 | detalhe técnico no tooltip |
| `faixa_inferior`, `faixa_superior` | 75255, 110619 (2007-09) | **só de 2003-01 a 2012-01**: faixa entre as leituras. Nos meses do VIIRS fica `null` |
| `leituras` | `{"t1_aqua": 110619, "fatores_aqua": 100408, "t1_terra": 75255}` | as três estimativas de onde sai a faixa (só antes de 2012) |

## Sugestões para a tela

- **Faixa de 2003 a 2011:** no calendário, um marcador discreto (hachura ou ícone) nesses meses, e no tooltip "entre X e Y focos". No gráfico anual, uma área sombreada entre `faixa_inferior` e `faixa_superior`. É a forma honesta de mostrar que, antes de 2012, os dois satélites MODIS discordam.

- **Calendário:** linhas = anos (2003 a 2025), colunas = meses. Cor por `focos` numa escala acessível (viridis ou similar) com legenda em números. Meses de setembro e outubro passam de 30 mil, janeiro fica perto de 3 mil: escala logarítmica ou por quantis deixa a grade mais legível.
- **Cartão do mês:** para o último mês disponível, mostrar `focos`, `anomalia_pct` e `posicao_no_mes`.
- **Gráfico antes e depois:** `modis_bruto` e `viirs_real` em linhas separadas mostram o salto de 2012. A linha de `focos` mostra a série harmonizada, sem o salto.
- **Filtro de datas:** recortar `meses` por ano e mês no próprio navegador.
- **CSV:** baixar `calendario_bahia.csv`, ou gerar do recorte filtrado.

## O que esta versão faz e não faz

- Faz: técnica T1 (uma taxa por mês do ano), calibrada com 2012-02 a 2021-12 (antes da mudança de órbita do Aqua), com três correções de dado:
  - meses em que o Suomi NPP ficou 3 ou mais dias sem dado completados com o NOAA-20 x 1,0547 (2022-07, 2022-08, 2024-06, 2024-07, 2024-11)
  - dias degradados do Aqua e dias fracos do S-NPP contados como falha (agosto de 2020 e março de 2012 saíram da calibração)
  - meses incompletos fora do "normal" de cada mês
- Também faz: a faixa de 2003-2011 com o modelo com fatores (versão 2), 2026 até o último mês completo e qualquer área pela grade de células.
- Não faz: o contorno oficial da Bahia (é um retângulo) nem o NOAA-21.
- Quando o modelo melhorar, só a conversão muda. Os campos do JSON continuam os mesmos, então o site não precisa ser refeito.

## Resumo

O número central (`focos`) é a T1, que teve o menor erro entre os métodos simples no teste (a mistura com o modelo com fatores errou um pouco menos, mas a diferença pode ser acaso). Antes de 2012 esse número é a leitura do Aqua, quase sempre no teto da faixa. A faixa de 2003 a 2011 vem da discordância entre os dois MODIS. 2007 é o ano mais forte em todas as leituras.
