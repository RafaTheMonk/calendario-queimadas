#!/usr/bin/env python3
"""Acrescenta os meses completos de 2026 a serie do site (rodar depois de gerar_json_site.py).

De 2012 em diante a serie e o VIIRS medido, sem conversao, entao 2026 so precisa da contagem:
- S-NPP com os mesmos filtros (retangulo estrito, sem confianca baixa, so vegetacao quando o arquivo
  traz o tipo do foco);
- mes com 3 dias ou mais sem S-NPP (dia em que o NOAA-20 viu fogo e o S-NPP nao viu nada) usa o
  NOAA-20 vezes a razao S-NPP/NOAA-20 da serie, como de 2012 a 2025;
- so meses completos: o mes corrente fica para o painel dos ultimos dias;
- meses vindos do quase tempo real (NRT) ficam marcados como provisorios: nao tem o tipo do foco e
  mudam quando sair o processamento padrao.
O normal de cada mes continua com os anos de 2012 a 2025.

Entrada: Dados/firms_2026/*.csv (Scripts/baixar_firms_2026.py), Dados/site/calendario_bahia.json,
         Dados/site/celulas_bahia.json e Dados/site/calendario_bahia.csv
Saida: os mesmos tres arquivos, regravados com 2026, e copia em site/data/

Uso: python3 -I Scripts/estender_2026.py
"""
import calendar
import csv
import glob
import json
import os
import shutil
from collections import Counter, defaultdict
from datetime import date

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR_2026 = os.path.join(RAIZ, "Dados", "firms_2026")
DIR_SITE = os.path.join(RAIZ, "Dados", "site")
DIR_PUB = os.path.join(RAIZ, "site", "data")
LON_MIN, LON_MAX, LAT_MIN, LAT_MAX = -46.62, -37.34, -18.35, -8.53
LON0, DLON, NLON = -46.875, 0.625, 16
LAT0, DLAT, NLAT = -18.5, 0.5, 21
LIMITE_DIAS_SEM_DADO = 3
MIN_FOCOS_DIA_N20 = 5


def celula(lat, lon):
    i = min(max(int(round((lat - LAT0) / DLAT)), 0), NLAT - 1)
    j = min(max(int(round((lon - LON0) / DLON)), 0), NLON - 1)
    return "L%02dC%02d" % (i, j)


def ler(prefixo):
    """{(mes): n}, {(mes, celula): n}, {dia: n}, {mes: veio do NRT} de um satelite."""
    por_mes, por_cel, por_dia, nrt = Counter(), Counter(), Counter(), defaultdict(bool)
    vistos = set()
    for arq in sorted(glob.glob(os.path.join(DIR_2026, prefixo + "_*.csv"))):
        eh_nrt = "_NRT_" in os.path.basename(arq)
        with open(arq, newline="", encoding="utf-8", errors="replace") as f:
            for r in csv.DictReader(f):
                try:
                    lat, lon = float(r["latitude"]), float(r["longitude"])
                except (KeyError, ValueError):
                    continue
                if not (LON_MIN < lon < LON_MAX and LAT_MIN < lat < LAT_MAX):
                    continue
                if (r.get("confidence") or "").strip().lower() in ("l", "low"):
                    continue
                if "type" in r and (r["type"] or "").strip() not in ("", "0"):
                    continue
                chave = (r["latitude"], r["longitude"], r["acq_date"], r["acq_time"])
                if chave in vistos:
                    continue
                vistos.add(chave)
                mes = r["acq_date"][:7]
                por_mes[mes] += 1
                por_cel[(mes, celula(lat, lon))] += 1
                por_dia[r["acq_date"]] += 1
                nrt[mes] |= eh_nrt
    return por_mes, por_cel, por_dia, nrt


def quantis_classe(v, normal, mes_num):
    c = "%02d" % mes_num
    med, p25, p75 = normal["mediana"][c], normal["p25"][c], normal["p75"][c]
    anom = round(1000 * (v - med) / med) / 10
    classe = "acima do normal" if v > p75 else ("abaixo do normal" if v < p25 else "normal")
    return anom, classe


def main():
    cal = json.load(open(os.path.join(DIR_SITE, "calendario_bahia.json"), encoding="utf-8"))
    cel = json.load(open(os.path.join(DIR_SITE, "celulas_bahia.json"), encoding="utf-8"))
    razao = cal["metodo"]["razao_snpp_noaa20"]

    # base sempre ate 2025-12 (deixa o script idempotente)
    n_base = sum(1 for m in cal["meses"] if m["mes"] < "2026-01")
    cal["meses"] = cal["meses"][:n_base]
    cel["meses"] = cel["meses"][:n_base]
    for c in cel["celulas"]:
        c["f"] = c["f"][:n_base]

    snpp, snpp_cel, snpp_dia, snpp_nrt = ler("VIIRS_SNPP")
    n20, n20_cel, n20_dia, n20_nrt = ler("VIIRS_NOAA20")
    hoje = date.today()
    meses = ["2026-%02d" % k for k in range(1, 13) if date(2026, k, calendar.monthrange(2026, k)[1]) < hoje]
    normal = cal["normal_por_mes"]

    novos = []
    for m in meses:
        k = int(m[5:7])
        dias = ["%s-%02d" % (m, d) for d in range(1, calendar.monthrange(2026, k)[1] + 1)]
        sem_snpp = sum(1 for d in dias if snpp_dia[d] == 0 and n20_dia[d] >= MIN_FOCOS_DIA_N20)
        usa_n20 = sem_snpp >= LIMITE_DIAS_SEM_DADO
        focos = round(n20[m] * razao) if usa_n20 else snpp[m]
        provisorio = n20_nrt[m] if usa_n20 else snpp_nrt[m]
        anom, classe = quantis_classe(focos, normal, k)
        novos.append({
            "mes": m, "ano": 2026, "mes_num": k, "focos": focos,
            "origem": "VIIRS NOAA-20 ajustado" if usa_n20 else "VIIRS",
            "qualidade": "provisorio" if provisorio else ("corrigido" if usa_n20 else "completo"),
            "modis_bruto": None, "viirs_real": focos, "modis_convertido": None,
            "dias_sem_dado_aqua": None, "dias_degradados_aqua": None, "dias_sem_dado_viirs": sem_snpp,
            "anomalia_pct": anom, "classe": classe, "faixa_inferior": None, "faixa_superior": None,
        })
        print("%s  S-NPP %6d  NOAA-20 %6d  razao %.3f  dias sem S-NPP %2d  -> %6d %s%s" % (
            m, snpp[m], n20[m], snpp[m] / n20[m] if n20[m] else 0, sem_snpp, focos,
            "NOAA-20 ajustado" if usa_n20 else "S-NPP", " (provisorio)" if provisorio else ""))

    cal["meses"] += novos
    todos = defaultdict(list)
    for s in cal["meses"]:
        todos[s["mes_num"]].append(s["focos"])
    for s in cal["meses"]:
        s["posicao_no_mes"] = 1 + sum(1 for x in todos[s["mes_num"]] if x > s["focos"])

    cal["totais_por_ano"] = [t for t in cal["totais_por_ano"] if t["ano"] < 2026]
    if novos:
        pico = max(novos, key=lambda s: s["focos"])
        cal["totais_por_ano"].append({"ano": 2026, "focos": sum(s["focos"] for s in novos), "meses": len(novos),
                                      "mes_pico": pico["mes"], "faixa_inferior": None, "faixa_superior": None})
    cal["top10_meses"] = [{"mes": s["mes"], "focos": s["focos"], "origem": s["origem"]}
                          for s in sorted(cal["meses"], key=lambda s: -s["focos"])[:10]]
    fim = cal["meses"][-1]["mes"]
    cal["periodo"]["fim"] = fim
    cal["periodo"]["observacao"] = ("2026 vai de janeiro a %s, pela API do FIRMS (VIIRS). Meses do quase tempo real ficam como "
                                    "provisórios. O mês corrente aparece só no painel dos últimos dias." % fim[5:7])
    cal["metodo"]["limitacoes"] = [x for x in cal["metodo"]["limitacoes"] if "fecha em dezembro de 2025" not in x and not x.startswith("2026 vai")]
    cal["metodo"]["limitacoes"].append(
        "2026 vai de janeiro a %s. Os meses que vêm do quase tempo real do FIRMS são provisórios: não trazem o tipo do foco "
        "(podem incluir fontes industriais, menos de 1%% na Bahia) e mudam quando sair o processamento padrão." % fim)

    # celulas: mesma regra mes a mes
    cel["meses"] += [s["mes"] for s in novos]
    for c in cel["celulas"]:
        for s in novos:
            if s["origem"] == "VIIRS NOAA-20 ajustado":
                c["f"].append(round(n20_cel[(s["mes"], c["id"])] * razao))
            else:
                c["f"].append(snpp_cel[(s["mes"], c["id"])])

    with open(os.path.join(DIR_SITE, "calendario_bahia.json"), "w", encoding="utf-8") as f:
        json.dump(cal, f, ensure_ascii=False, indent=1)
    with open(os.path.join(DIR_SITE, "celulas_bahia.json"), "w", encoding="utf-8") as f:
        json.dump(cel, f, ensure_ascii=False, separators=(",", ":"))

    arq_csv = os.path.join(DIR_SITE, "calendario_bahia.csv")
    with open(arq_csv, newline="", encoding="utf-8") as f:
        linhas = list(csv.reader(f))
    cab = linhas[0]
    linhas = [cab] + [l for l in linhas[1:] if l[0] < "2026-01"]
    pos = {s["mes"]: s["posicao_no_mes"] for s in cal["meses"]}
    i_pos = cab.index("posicao_no_mes")
    for l in linhas[1:]:
        l[i_pos] = str(pos[l[0]])
    for s in novos:
        linhas.append(["" if s.get(c) is None else str(s.get(c)) for c in cab])
    with open(arq_csv, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(linhas)

    for nome in ("calendario_bahia.json", "celulas_bahia.json", "calendario_bahia.csv"):
        shutil.copy(os.path.join(DIR_SITE, nome), os.path.join(DIR_PUB, nome))
    print("serie ate", fim, "| 2026 até agora:", sum(s["focos"] for s in novos), "focos")


if __name__ == "__main__":
    main()
