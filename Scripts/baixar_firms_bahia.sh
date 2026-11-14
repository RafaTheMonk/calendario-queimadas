#!/usr/bin/env bash
# Baixa os focos anuais do Brasil no NASA FIRMS (MODIS C6.1 e VIIRS 375 m),
# guarda so as linhas dentro do retangulo da Bahia e, para medir a completude,
# conta os focos por dia e por satelite no Brasil inteiro.
#
# Uso: Scripts/baixar_firms_bahia.sh [pasta_de_saida]
# Saida padrao: Dados/firms_bahia/
#   <sensor>_<ano>_bahia.csv          linhas dentro do retangulo da Bahia
#   cobertura/<sensor>_<ano>.csv      data,satelite,focos_brasil,focos_bahia
#   log.tsv                           sensor, ano, status http, linhas Brasil, linhas Bahia

set -u
SAIDA="${1:-$(dirname "$0")/../Dados/firms_bahia}"
mkdir -p "$SAIDA/cobertura"
BASE="https://firms.modaps.eosdis.nasa.gov/data/country"

# Retangulo da Bahia com folga de 0,1 grau. O recorte fino (estado e biomas) vem depois.
OESTE=-46.72; LESTE=-37.24; SUL=-18.45; NORTE=-8.43

baixar() {
  local sensor="$1" ano="$2"
  local url="$BASE/$sensor/$ano/${sensor}_${ano}_Brazil.csv"
  local out="$SAIDA/${sensor}_${ano}_bahia.csv"
  local cob="$SAIDA/cobertura/${sensor}_${ano}.csv"
  local status
  status=$(curl -sIL -m 60 -o /dev/null -w '%{http_code}' "$url")
  if [ "$status" != "200" ]; then
    printf '%s\t%s\t%s\t0\t0\n' "$sensor" "$ano" "$status" >> "$SAIDA/log.tsv"
    return
  fi
  curl -sL --fail --retry 3 --retry-delay 5 -m 1800 "$url" | awk -F, \
    -v o="$OESTE" -v l="$LESTE" -v s="$SUL" -v n="$NORTE" -v out="$out" -v cob="$cob" '
    NR == 1 { print > out; next }
    {
      total++
      chave = $6 "," $8
      br[chave]++
      if ($1 >= s && $1 <= n && $2 >= o && $2 <= l) { print > out; ba[chave]++; nba++ }
    }
    END {
      print "data,satelite,focos_brasil,focos_bahia" > cob
      for (k in br) print k "," br[k] "," (k in ba ? ba[k] : 0) > cob
      printf "%d\t%d\n", total, nba
    }' > "$SAIDA/.contagem_${sensor}_${ano}"
  local rc=("${PIPESTATUS[@]}")
  local contagem
  contagem=$(cat "$SAIDA/.contagem_${sensor}_${ano}" 2>/dev/null || printf '0\t0')
  rm -f "$SAIDA/.contagem_${sensor}_${ano}"
  if [ "${rc[0]}" != "0" ]; then status="curl_erro_${rc[0]}"; fi
  printf '%s\t%s\t%s\t%s\n' "$sensor" "$ano" "$status" "$contagem" >> "$SAIDA/log.tsv"
}
export -f baixar
export SAIDA BASE OESTE LESTE SUL NORTE

: > "$SAIDA/log.tsv"
{
  for a in $(seq 2000 2025); do echo "modis $a"; done
  for a in $(seq 2012 2025); do echo "viirs-snpp $a"; done
  for a in $(seq 2018 2025); do echo "viirs-jpss1 $a"; done
} | xargs -P 3 -L 1 bash -c 'baixar "$0" "$1"'

sort -o "$SAIDA/log.tsv" "$SAIDA/log.tsv"
echo "Pronto. Resumo em $SAIDA/log.tsv"
