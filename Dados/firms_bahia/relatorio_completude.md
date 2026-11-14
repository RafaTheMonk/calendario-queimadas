# Completude dos dados FIRMS baixados

Pasta: `Dados/firms_bahia`

## A. Cobertura diária (Brasil inteiro)

Um dia sem nenhum foco no Brasil inteiro é quase certamente falta de dado do satélite, não ausência de fogo.

| Satélite | Primeiro dia | Último dia | Dias com dado | Dias no intervalo | Cobertura |
|---|---|---|---|---|---|
| MODIS Aqua | 2002-07-04 | 2025-12-31 | 8551 | 8582 | 99.6% |
| MODIS Terra | 2000-11-01 | 2025-12-31 | 9127 | 9192 | 99.3% |
| VIIRS NOAA-20 | 2018-04-01 | 2025-12-31 | 2826 | 2832 | 99.8% |
| VIIRS S-NPP | 2012-01-20 | 2025-12-31 | 5057 | 5095 | 99.3% |

### Buracos (dias seguidos sem nenhum foco no Brasil)

- **MODIS Aqua:** 31 dias faltando no total, 8 buracos, 2 com 2 dias ou mais.
  - 2022-04-01 a 2022-04-16 (16 dias)
  - 2002-07-30 a 2002-08-07 (9 dias)
- **MODIS Terra:** 65 dias faltando no total, 12 buracos, 6 com 2 dias ou mais.
  - 2001-06-16 a 2001-07-03 (18 dias)
  - 2022-10-11 a 2022-10-22 (12 dias)
  - 2002-03-20 a 2002-03-28 (9 dias)
  - 2016-02-19 a 2016-02-27 (9 dias)
  - 2003-12-17 a 2003-12-24 (8 dias)
  - 2008-12-21 a 2008-12-23 (3 dias)
- **VIIRS NOAA-20:** 6 dias faltando no total, 3 buracos, 1 com 2 dias ou mais.
  - 2023-07-19 a 2023-07-22 (4 dias)
- **VIIRS S-NPP:** 38 dias faltando no total, 9 buracos, 6 com 2 dias ou mais.
  - 2022-07-27 a 2022-08-10 (15 dias)
  - 2024-07-10 a 2024-07-15 (6 dias)
  - 2024-05-30 a 2024-06-03 (5 dias)
  - 2024-07-25 a 2024-07-28 (4 dias)
  - 2024-11-03 a 2024-11-05 (3 dias)
  - 2023-07-26 a 2023-07-27 (2 dias)

### Dias com dado por ano

| Ano | MODIS Aqua | MODIS Terra | VIIRS NOAA-20 | VIIRS S-NPP |
|---|---|---|---|---|
| 2000 |  | 61 |  |  |
| 2001 |  | 347 |  |  |
| 2002 | 170 | 355 |  |  |
| 2003 | 365 | 357 |  |  |
| 2004 | 366 | 365 |  |  |
| 2005 | 365 | 365 |  |  |
| 2006 | 365 | 363 |  |  |
| 2007 | 365 | 365 |  |  |
| 2008 | 366 | 363 |  |  |
| 2009 | 365 | 365 |  |  |
| 2010 | 365 | 365 |  |  |
| 2011 | 365 | 365 |  |  |
| 2012 | 366 | 366 |  | 346 |
| 2013 | 365 | 365 |  | 365 |
| 2014 | 365 | 364 |  | 365 |
| 2015 | 365 | 365 |  | 365 |
| 2016 | 364 | 357 |  | 366 |
| 2017 | 365 | 365 |  | 365 |
| 2018 | 365 | 365 | 275 | 365 |
| 2019 | 365 | 365 | 365 | 365 |
| 2020 | 365 | 366 | 366 | 366 |
| 2021 | 364 | 365 | 365 | 365 |
| 2022 | 349 | 353 | 365 | 349 |
| 2023 | 365 | 365 | 360 | 363 |
| 2024 | 366 | 365 | 365 | 347 |
| 2025 | 365 | 365 | 365 | 365 |

## B. Retângulo da Bahia, com filtros

Filtros: só `type = 0` (vegetação), MODIS com confiança 30 ou mais, VIIRS sem os de confiança `l`. Retângulo com folga, ainda inclui pedaços dos estados vizinhos. Primeira olhada, não é o resultado final.

### Focos removidos pelos filtros

- **MODIS Aqua:** confiança baixa: 20531, type 2: 706
- **MODIS Terra:** confiança baixa: 16543, type 2: 590
- **VIIRS NOAA-20:** confiança baixa: 145393, type 2: 7966, type 3: 855
- **VIIRS S-NPP:** confiança baixa: 262986, type 2: 12868, type 3: 2070

### Focos por ano

| Ano | MODIS Aqua | MODIS Terra | VIIRS NOAA-20 | VIIRS S-NPP | NOAA-20 / Aqua | S-NPP / Aqua |
|---|---|---|---|---|---|---|
| 2000 |  | 544 |  |  |  |  |
| 2001 |  | 14798 |  |  |  |  |
| 2002 | 31784 | 15997 |  |  |  |  |
| 2003 | 38259 | 14919 |  |  |  |  |
| 2004 | 34184 | 14026 |  |  |  |  |
| 2005 | 35933 | 16048 |  |  |  |  |
| 2006 | 19240 | 8350 |  |  |  |  |
| 2007 | 57923 | 28968 |  |  |  |  |
| 2008 | 34968 | 16724 |  |  |  |  |
| 2009 | 15717 | 8164 |  |  |  |  |
| 2010 | 38493 | 20484 |  |  |  |  |
| 2011 | 27470 | 15680 |  |  |  |  |
| 2012 | 35164 | 25528 |  | 220567 |  | 6.27 |
| 2013 | 15058 | 11266 |  | 95259 |  | 6.33 |
| 2014 | 17867 | 13213 |  | 111289 |  | 6.23 |
| 2015 | 35349 | 23607 |  | 209540 |  | 5.93 |
| 2016 | 13435 | 9895 |  | 87137 |  | 6.49 |
| 2017 | 14022 | 10551 |  | 89384 |  | 6.37 |
| 2018 | 11706 | 9299 | 71109 | 78823 | 6.07 | 6.73 |
| 2019 | 17466 | 13688 | 110572 | 114675 | 6.33 | 6.57 |
| 2020 | 16152 | 12052 | 95721 | 102387 | 5.93 | 6.34 |
| 2021 | 28862 | 21306 | 173981 | 185469 | 6.03 | 6.43 |
| 2022 | 21649 | 14735 | 134921 | 132803 | 6.23 | 6.13 |
| 2023 | 23447 | 19297 | 133841 | 144767 | 5.71 | 6.17 |
| 2024 | 18882 | 13428 | 100642 | 99749 | 5.33 | 5.28 |
| 2025 | 22800 | 15606 | 127736 | 132205 | 5.60 | 5.80 |

### Meses sem nenhum foco na Bahia (depois dos filtros)

- **MODIS Aqua:** 0 de 282 meses
- **MODIS Terra:** 0 de 302 meses
- **VIIRS NOAA-20:** 0 de 93 meses
- **VIIRS S-NPP:** 0 de 168 meses
