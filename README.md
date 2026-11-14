# Régua de Fogo

Focos de calor por satélite numa régua só: calendário harmonizado para a Bahia, de 2003 a 2025, feito para o desafio **Harmonization of MODIS and VIIRS Hot Spots** do NASA Space Apps Challenge 2026 (equipe Timeout Zero, Salvador).

Site: https://calendario-queimadas.vercel.app

## O problema

Os satélites registram focos de calor há mais de 20 anos, mas o registro está dividido entre dois sensores que não se comparam direto:

- **MODIS** (satélites Terra e Aqua, desde 2000): pixel de 1 km, perde fogo pequeno. Está sendo desligado.
- **VIIRS** (Suomi NPP, NOAA-20 e NOAA-21, desde 2012): pixel de 375 m, enxerga fogo menor e conta cerca de 6 vezes mais focos na Bahia.

Juntando os dois sem ajuste, a série dá um salto falso em 2012: 27.470 focos do MODIS Aqua em 2011 contra 220.567 do VIIRS em 2012. Não houve mais fogo, o que mudou foi o sensor.

## A solução

1. **Harmonizar:** converter os anos que só têm MODIS (2003 a 2011) para a escala do VIIRS, calibrando nos anos em que os dois funcionaram juntos.
2. **Mostrar:** um calendário de meses por anos, com o mês atual comparado com o normal daquele mês, anomalias, ranking e download dos dados.

## Dados (todos da NASA)

- **NASA FIRMS:** focos MODIS C6.1 (Terra e Aqua) e VIIRS 375 m (Suomi NPP e NOAA-20), arquivos anuais por país, processamento padrão. 48 arquivos, 40 milhões de focos no Brasil, 3,6 milhões na área de estudo depois dos filtros. Cobertura de dias acima de 99% em todos os satélites.
- **NASA POWER:** chuva, vento, umidade, temperatura e altitude em grade mensal (0,5 x 0,625 grau), de 2003 a 2025.

Área: retângulo envolvente da Bahia (longitude -46,62 a -37,34, latitude -18,35 a -8,53). Filtros: só focos de vegetação (`type = 0`) e sem confiança baixa.

## Método e resultados

- **Conversão principal (taxa por mês do ano):** para cada mês do ano, total de focos VIIRS dividido pelo do MODIS Aqua, que passa no mesmo horário. Calibrada com 2012 a 2019 e testada em 2020 a 2023, anos que o modelo não viu: **erro de 7,2% por mês** e **93% de acerto** em dizer se o mês ficou acima ou abaixo do normal.
- **Comparação de técnicas:** taxa única, taxa por mês, contagem por células de grade e quantile mapping. A taxa por mês teve o menor erro.
- **Modelo com fatores (regressão de Poisson por célula e mês):** explica por que a relação entre os sensores muda, usando só dados que existiam antes de 2012. Fatores que mais pesam: fração de focos noturnos (à noite o VIIRS é muito mais sensível) e umidade. Testados e descartados: tamanho do pixel, hora de passagem e vento. A faixa de 95% acertou 42 de 44 meses de teste.
- **Correções de dado:** meses com falha do Suomi NPP completados com o NOAA-20, dias com dado degradado do Aqua excluídos, calibração antes da mudança de órbita do Aqua (que passou a cruzar a área mais tarde a partir de 2022).
- **Descoberta:** antes de 2012, os dois MODIS discordam entre si. O Terra via 0,47 foco por foco do Aqua em 2003-2011 e 0,72 de 2012 em diante, só de dia. Por isso 2003-2011 aparece com faixa: de 132 mil (leitura do Terra) a 204 mil (leitura do Aqua) focos por ano, contra 124 mil do VIIRS real em 2012-2021. Em todas as leituras, 2007 foi o ano com mais fogo.

## Estrutura

```
site/                         aplicação web estática (HTML, CSS, JavaScript; ECharts e Leaflet)
  data/                       calendario_bahia.json e .csv lidos pelo site
Scripts/
  baixar_firms_bahia.sh       baixa os arquivos anuais do FIRMS e recorta a área
  completude_firms.py         relatório de completude dos dados
  harmonizacao/               técnicas de harmonização e avaliação
    fatores/                  modelo com fatores (NASA POWER, regressão de Poisson)
  gerar_json_site.py          gera os dados do site
Dados/
  firms_bahia/                relatório de completude, log e contagem diária (os CSV brutos não vão para o repositório)
  harmonizado/                resultados das técnicas e do modelo com fatores
  nasa_power/                 clima da NASA POWER
  site/                       dados do site e guia dos campos (LEIAME.md)
```

## Como rodar

Requisitos: Python 3 com numpy, curl e bash.

```bash
Scripts/baixar_firms_bahia.sh                              # baixa o FIRMS (uns 3,5 GB lidos, guarda só a área)
python3 -I Scripts/completude_firms.py                     # completude
python3 -I Scripts/harmonizacao/avaliar.py                 # técnicas de harmonização
python3 -I Scripts/harmonizacao/fatores/baixar_power.py    # clima da NASA POWER
python3 -I Scripts/harmonizacao/fatores/versao2.py         # modelo com fatores
python3 -I Scripts/gerar_json_site.py                      # dados do site
cd site && python3 -m http.server 8000                     # abrir http://localhost:8000
```

O site é estático: não precisa de servidor nem de banco. Para publicar, basta servir a pasta `site/`.

## Limitações

- Área piloto: a Bahia. O método vale para qualquer área, mas só a Bahia foi processada e validada.
- Os anos de 2003 a 2011 não podem ser conferidos com VIIRS (ele não existia), por isso vêm com faixa.
- 2026 e o NOAA-21 ainda não entraram: dependem da chave da API do FIRMS.
- Focos de calor são detecções de satélite, não incêndios confirmados.

## Citação dos dados

We acknowledge the use of imagery from the NASA LANCE FIRMS (https://earthdata.nasa.gov/firms), part of the NASA Earth Science Data and Information System (ESDIS).

These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program (https://power.larc.nasa.gov).
