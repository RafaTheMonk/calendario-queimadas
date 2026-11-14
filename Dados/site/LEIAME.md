# Dados do site: calendário de queimadas da Bahia

Versão 2, gerada em 14/11/2026 por `Scripts/gerar_json_site.py` (a versão 2 acrescenta a faixa de 2003 a 2011 e o resumo do modelo com fatores; os campos da versão 1 continuam iguais) (rodar de novo: `python3 -I Scripts/gerar_json_site.py`, uns 10 segundos).

- `calendario_bahia.json` (110 KB): tudo o que o site precisa
- `calendario_bahia.csv`: a mesma série mês a mês, para o botão "Baixar CSV"

## O que tem no JSON

| Campo | O que é | Uso no site |
|---|---|---|
| `area` | nome e retângulo (lon/lat) | título, destacar no mapa |
| `unidade` | "focos equivalentes VIIRS Suomi NPP 375 m" | legenda |
| `fonte`, `citacao` | NASA FIRMS e a frase oficial de citação | rodapé e página "como funciona" |
| `periodo` | 2003-01 a 2025-12 e por que 2026 não entrou | aviso na tela |
| `meses` | 276 meses, um objeto por mês (ver abaixo) | calendário, gráfico, CSV |
| `normal_por_mes` | mediana, média, p25 e p75 de cada mês do ano (chaves "01" a "12") | cartão "mês x normal", legenda |
| `totais_por_ano` | total de focos, meses, mês de pico e, de 2003 a 2012, a faixa do ano | coluna de totais ao lado da grade |
| `top10_meses` | os 10 meses com mais fogo | destaque |
| `metodo` | técnica, taxas por mês, período de calibração, filtros, validação (erro de 7,9% por mês, 91% de acerto acima ou abaixo do normal) e limitações | página "como funciona" |
| `metodo.fatores` | pesos dos fatores, triagem, comparação com a T1 no teste, cobertura da faixa e a descoberta dos dois MODIS | página "como funciona" |

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
- **Cartão do mês:** para o último mês disponível (2025-12), mostrar `focos`, `anomalia_pct` e `posicao_no_mes`. Avisar que 2026 ainda não está na base.
- **Gráfico antes e depois:** `modis_bruto` e `viirs_real` em linhas separadas mostram o salto de 2012. A linha de `focos` mostra a série harmonizada, sem o salto.
- **Filtro de datas:** recortar `meses` por ano e mês no próprio navegador.
- **CSV:** baixar `calendario_bahia.csv`, ou gerar do recorte filtrado.

## O que esta versão faz e não faz

- Faz: técnica T1 (uma taxa por mês do ano), calibrada com 2012-02 a 2021-12 (antes da mudança de órbita do Aqua), com três correções de dado:
  - meses em que o Suomi NPP ficou 3 ou mais dias sem dado completados com o NOAA-20 x 1,0547 (2022-07, 2022-08, 2024-06, 2024-07, 2024-11)
  - dias degradados do Aqua contados como falha (agosto de 2020 saiu da calibração)
  - meses incompletos fora do "normal" de cada mês
- Não faz ainda: o modelo com fatores e pesos pedido pela mentoria, o contorno oficial da Bahia (é um retângulo), 2026, outras áreas.
- Quando o modelo melhorar, só a conversão muda. Os campos do JSON continuam os mesmos, então o site não precisa ser refeito.

## Para o pitch

O número central (`focos`) continua sendo a T1, que teve o menor erro no teste. A faixa de 2003 a 2011 vem da discordância entre os dois MODIS. 2007 é o ano mais forte em todas as leituras.
