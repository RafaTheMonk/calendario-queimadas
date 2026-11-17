# Régua de Fogo (Fire Ruler)

Satellite fire hotspots on one consistent ruler: a harmonized burning activity calendar for Bahia, Brazil, from 2003 to 2026, built for the **Harmonization of MODIS and VIIRS Hot Spots** challenge of the NASA Space Apps Challenge 2026 (team Timeout Zero, Salvador, Brazil).

- Web app: https://regua-queimadas.vercel.app (Portuguese version: https://regua-queimadas.vercel.app/pt/)
- Data: NASA FIRMS and NASA POWER

## The problem

Satellites have recorded fire hotspots for more than 20 years, but the record is split between two sensors that cannot be compared directly:

- **MODIS** (Terra and Aqua satellites, since 2000): 1 km pixel, misses small fires. It is being retired.
- **VIIRS** (Suomi NPP since 2012 and NOAA-20 since 2018; NOAA-21, since 2023, is not used here): 375 m pixel, sees smaller fires and counts about 6 times more hotspots in Bahia.

Joining both records without adjustment creates a false jump in 2012: 26,477 MODIS Aqua hotspots in 2011 against 210,941 in 2012 (VIIRS from February on). Raw Aqua grew only 28% that year (26,477 to 33,865), so almost all of the jump is the sensor change, not more fire.

## The solution

1. **Harmonize:** convert the years that only have MODIS (2003 to 2011) to the VIIRS scale, calibrating on the years both sensors flew together.
2. **Show:** a calendar of months by years with accessible color ramps, the current month against the normal for that month (years measured by VIIRS, 2012 to 2025), anomalies against the multi-year median and mean, rankings, a date range filter, any area of interest (point and radius, latitude and longitude, or a polygon drawn on the map), hotspots of the last 7 days or of any chosen day on the map, CSV and JSON downloads.

## Data (NASA; INPE and IBAMA only for checking)

- **NASA FIRMS:** MODIS C6.1 (Terra and Aqua) and VIIRS 375 m (Suomi NPP and NOAA-20) active fire hotspots, annual country files, standard processing. 48 files, 40 million hotspots in Brazil, 3.6 million in the study area after filters. Day coverage above 99% for every satellite. 2026 comes from the FIRMS area API. A sample check against the FIRMS API: 98 of 120 windows identical and 0.054% total difference; VIIRS matched exactly in 28 of 28 windows and MODIS within 0.15% (the MODIS annual files mix processing versions: 6.2 up to 2017, 6.03 from 2018 to 2022 and 61.03 from 2023). NOAA-20 and 2026 are not part of this check.
- **NASA POWER:** rain, wind, humidity, temperature and elevation on a monthly grid (0.5 x 0.625 degree), 2003 to 2025.
- **INPE, Programa Queimadas** (Brazil's National Institute for Space Research): reference satellite hotspots, annual files 2003 to 2025 (https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/anual/Brasil_sat_ref/). Used only to check the harmonized series.
- **IBAMA, Sisfogo (ROI):** Fire Occurrence Records of the Prevfogo federal brigades (https://dadosabertos.ibama.gov.br/dados/SISFOGO/ROI.csv). Fires reported on the ground in Bahia, 399 records (397 from 2015 to 2021 and 2 outside that period), compared with the detected hotspots. Not used in the calculation.

Area: bounding rectangle of Bahia (longitude -46.62 to -37.34, latitude -18.35 to -8.53). Filters: vegetation fires only (`type = 0`), MODIS confidence 30 or more, VIIRS without low confidence.

## Method and results

- **Main conversion (one ratio per calendar month):** for each month of the year, total VIIRS hotspots divided by total MODIS Aqua hotspots (Aqua flies in the afternoon, close to the VIIRS overpass). The ratio goes from 5.7 in August (dry season) to 9.6 in January (rainy season, small fires). Calibrated on 2012 to 2019 and tested on 2020 to 2023, years the model never saw: **7.2% monthly error** (8.7% counting the months with satellite failures) and **+0.2% total bias**. Leaving one year out at a time, from 2013 to 2023: 7.1%. After the test, the published rates were refit with the same method on February 2012 to December 2021. This error is for the whole of Bahia; in smaller areas it grows (same test, `Scripts/harmonizacao/erro_por_area.py`): 19.1% for blocks of about 220 x 270 km, 26.0% for about 110 x 135 km and 37.2% for one grid cell of about 55 x 68 km. Before 2012 there is no VIIRS to measure it, so the 2020-2023 error is the best reference.
- **7 methods compared on the same test** ("Methods" window of the app): single ratio 9.2%, monthly ratio 7.2%, grid cells with fire per day 9.8%, quantile mapping 8.1% (2.7% on the calibration years, a sign that it memorizes), factor model 7.9%, Terra-based monthly ratio 11.8% and a 70% ratio + 30% factor model blend 6.6%. The blend beat the monthly ratio in 8 of 11 years, but the difference may still be chance, so the main number keeps the monthly ratio.
- **Check against INPE** ("Check against INPE" window): INPE's reference satellite is MODIS Aqua itself (another processing of the same sensor), so this checks the shape of the series, not the conversion rate before 2012. The evidence is the 2012 jump: without harmonization, the ratio against INPE jumps 6.2 times in 2012; harmonized, the difference between 2003-2011 and 2012-2021 is 11%. The year-to-year correlation is 0.985 (0.992 month to month, same peak month in 21 of 23 years), but raw Aqua with no conversion already reaches 0.984, so the correlation alone proves little; the -0.13 is for MODIS and VIIRS joined without harmonization.
- **Factor model (Poisson regression per grid cell and month):** explains why the relation between the sensors changes, using only data that existed before 2012. Strongest factors: share of night-time hotspots (VIIRS is much more sensitive at night) and humidity. Tested and discarded: pixel size, overpass time and wind. The 95% band covered 42 of 44 test months.
- **Data corrections:** months with Suomi NPP failures filled with adjusted NOAA-20, days with degraded Aqua data excluded (a rule added after August 2020, a test month, showed the problem; counting all 48 test months the error is 8.7%), calibration before the Aqua orbit change (it started crossing the area later from 2022 on; in INPE's data the most common overpass hour moves from 16 to 17 UTC in 2024).
- **Finding:** before 2012 the two MODIS satellites disagree. Terra saw 0.47 hotspots for each Aqua hotspot in 2003-2011 and 0.72 from 2012 on (day and night together). So 2003-2011 is shown as a band: from 132 thousand (Terra reading) to 204 thousand (Aqua reading) hotspots per year, against 124 thousand from real VIIRS in 2012-2021. The Terra/Aqua ratio also rises slowly inside 2003-2011 (0.38 in 2003, 0.57 in 2011), so the relation between the sensors was not stable before 2012 either. In every reading, 2007 was the year with the most fire. The central number shown for 2003-2011 is the Aqua reading, almost always at the top of the band, so records and rankings from that period depend on that choice.
- **Detected and reported:** for each fire registered by the federal brigades in Bahia, the satellite detected about 2,085 hotspots; only 12 of the 399 records were found by satellite.
- **The method works elsewhere:** `Scripts/replicar_regiao.py` recalibrates the rates for any country in the FIRMS archive, with the same global satellite outage flags used for Bahia. Same test (calibrate 2012-2019, predict 2020-2023) in 10 countries; summary in `Dados/harmonizado/replicacao_regioes.json`. The satellite outage flags (days without data and degraded Aqua days) come from the daily counts for Brazil and are reused for every country:

  | Region | Monthly ratio | Single ratio | Leave-one-year-out (monthly / single) | Record year |
  |---|---|---|---|---|
  | Bahia (Brazil) | 7.2% | 9.2% | 7.1% / 10.2% | 2007 |
  | Mexico | 6.6% | 11.7% | 6.7% / 13.5% | 2011 |
  | South Africa | 6.7% | 9.9% | 7.4% / 10.4% | 2023 |
  | Australia | 7.3% | 13.0% | 6.6% / 11.7% | 2012 |
  | Argentina | 8.7% | 17.8% | 8.3% / 18.3% | 2020 |
  | Bolivia | 10.4% | 11.9% | 10.8% / 13.5% | 2024 |
  | United States | 10.6% | 28.2% | 9.5% / 28.7% | 2020 |
  | Indonesia | 11.6% | 12.2% | 13.8% / 14.6% | 2015 |
  | Chile | 12.9% | 28.3% | 13.0% / 25.6% | 2017 |
  | Canada | 15.9% | 12.2% | 15.9% / 20.7% | 2023 |
  | Portugal | 26.1% | 18.6% | 20.0% / 18.5% | 2005 |

  The monthly ratio beats a single ratio in 8 of the 10 countries on the test (plus Bahia) and in 9 of 10 leaving one year out. It struggles with little fire (Portugal, a median of 99 VIIRS hotspots per month) and with record years outside the calibration (Canada 2023). Rates change a lot between regions (July: 4.0 in Argentina, 14.5 in Canada), so they must be recalculated per region, never copied. The record years match known events (Indonesia 2015, Chile 2017, Canada 2023, Bolivia 2024).

## Structure

```
site/                         static web app (HTML, CSS, JavaScript; ECharts and Leaflet), English
  pt/                         Portuguese version
  data/                       JSON and CSV files read by the app
api/                          Vercel functions: recentes (last 7 days) and pontos (hotspots on the map)
Scripts/
  baixar_firms_bahia.sh       downloads the FIRMS annual files and clips the area
  completude_firms.py         data completeness report
  harmonizacao/               harmonization techniques, evaluation and the 7-method comparison
    fatores/                  factor model (NASA POWER, Poisson regression)
  gerar_json_site.py          builds the app data
  baixar_firms_2026.py        2026 from the FIRMS area API
  estender_2026.py            adds the complete months of 2026
  conferir_com_api.py         checks the downloaded files against the FIRMS API
  comparar_inpe.py            check against INPE
  processar_roi_ibama.py      detected and reported fires (IBAMA)
  replicar_regiao.py          runs the method for another country
  resumo_regioes.py           summary of all regions
Dados/
  firms_bahia/                completeness report, log and daily counts (raw CSV files are not in the repository)
  harmonizado/                results of the techniques, the factor model and the API check
  nasa_power/                 NASA POWER weather
  site/                       app data and field guide (LEIAME.md)
```

Code comments and variable names are in Portuguese, the team's language.

## How to run

Requirements: Python 3 with numpy, curl and bash. The 2026 scripts, the API check and the map day lookup need a free FIRMS MAP_KEY in `FIRMS_MAP_KEY` (local `.env` file, never committed; Vercel environment variable for the deployed app).

```bash
Scripts/baixar_firms_bahia.sh                              # downloads FIRMS (about 3.5 GB read, keeps only the area)
python3 -I Scripts/completude_firms.py                     # completeness
python3 -I Scripts/harmonizacao/avaliar.py                 # harmonization techniques
python3 -I Scripts/harmonizacao/fatores/baixar_power.py    # NASA POWER weather
python3 -I Scripts/harmonizacao/fatores/versao2.py         # factor model
python3 -I Scripts/harmonizacao/erro_por_area.py          # error by area size (read by the next step)
python3 -I Scripts/gerar_json_site.py                      # app data
python3 -I Scripts/baixar_firms_2026.py                    # 2026 from the FIRMS API
python3 -I Scripts/estender_2026.py                        # adds the complete months of 2026
python3 -I Scripts/harmonizacao/comparar_metodos.py        # 7-method comparison ("Methods" window)
python3 -I Scripts/comparar_inpe.py                        # check against INPE (INPE zip files in Dados/inpe_ref/)
python3 -I Scripts/processar_roi_ibama.py                  # detected and reported (IBAMA ROI.csv in Dados/ibama_roi/)
python3 -I Scripts/conferir_com_api.py                     # sample check of the files against the FIRMS API
python3 -I Scripts/replicar_regiao.py Argentina            # the method for another country
cd site && python3 -m http.server 8000                     # open http://localhost:8000
```

The app is static, with two small Vercel functions (`api/recentes` and `api/pontos`) that read FIRMS on the server side, so the API key never reaches the browser.

## Limitations

- Pilot area: Bahia. The method works for any area (see the Argentina run), but only Bahia is processed in the app.
- The years 2003 to 2011 cannot be checked against VIIRS (it did not exist), so they come with a band.
- The 7.2% error is for the whole of Bahia; smaller areas have larger errors (37.2% for one grid cell in the 2020-2023 test).
- In 22 months of 2003-2011, Aqua counted more hotspots than in any matching calibration month (5 of the 10 record months among them), so the rate is extrapolated there.
- Weak Suomi NPP days are not checked like degraded Aqua days. Applying the same rule would only drop March 2012 from the calibration and move the March rate from 7.48 to 7.66.
- 2026 only includes complete months, from the FIRMS API (VIIRS Suomi NPP, with adjusted NOAA-20 where Suomi NPP is missing). Months from near real time data are provisional: they do not carry the hotspot type and will change when the standard processing is released. NOAA-21 is not included yet.
- Fire hotspots are satellite detections, not confirmed fires.

## Data citation

We acknowledge the use of imagery from the NASA LANCE FIRMS (https://earthdata.nasa.gov/firms), part of the NASA Earth Science Data and Information System (ESDIS).

These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program (https://power.larc.nasa.gov).

INPE, Programa Queimadas: reference satellite fire hotspots, annual files for Brazil (https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/anual/Brasil_sat_ref/), used only to check the series.

IBAMA, Sisfogo, Registros de Ocorrência de Incêndio (ROI), open data (https://dadosabertos.ibama.gov.br/dados/SISFOGO/ROI.csv), used only to compare detected and reported fires.

Map tiles: © OpenStreetMap contributors (https://www.openstreetmap.org/copyright).
