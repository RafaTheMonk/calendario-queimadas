#!/usr/bin/env python3
"""Gera o JSON (e o CSV) do calendario de queimadas da Bahia para o site.

Versao 2, de 14/11/2026 (a versao 1 nao tinha a faixa de 2003-2011). Usa a tecnica T1 (fator sazonal) com tres correcoes de
dado apontadas na revisao independente da harmonizacao:

1. Meses em que o VIIRS Suomi NPP ficou 3 ou mais dias sem dado sao completados
   com o VIIRS NOAA-20 multiplicado pela razao S-NPP/NOAA-20 calibrada.
2. Dias em que o Aqua mandou dado degradado (contagem no Brasil muito abaixo do
   normal em relacao ao S-NPP, como em agosto de 2020) contam como dia sem dado.
3. A conversao do MODIS e calibrada so com 2012-02 a 2021-12, antes da deriva
   da orbita do Aqua, e sem os meses incompletos.

O numero central e a T1. O modelo com fatores (Scripts/harmonizacao/fatores,
versao 2) entra como faixa de 2003-2011 e como explicacao na pagina do metodo.

Uso: python3 -I Scripts/gerar_json_site.py
Saida: Dados/site/calendario_bahia.json e .csv, copiados tambem para site/data/
"""
import csv
import json
import os
import statistics
import sys
from collections import defaultdict

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, "harmonizacao"))
import comum  # noqa: E402

RAIZ = comum.RAIZ
SAIDA = os.path.join(RAIZ, "Dados", "site")
ARQ_T1 = os.path.join(RAIZ, "Dados", "harmonizado", "t1_fator_sazonal_bahia_mensal.csv")
ARQ_RESULTADOS = os.path.join(RAIZ, "Dados", "harmonizado", "resultados.json")

CALIB_INI, CALIB_FIM = "2012-02", "2021-12"   # antes da deriva do Aqua
LIMITE = comum.LIMITE_DIAS_SEM_DADO             # 3 dias
FATOR_DEGRADADO = 0.25                          # dia com razao Aqua/S-NPP abaixo de 1/4 da mediana do mes


# ---------------------------------------------------------------- leitura

def ler_t1():
    linhas = {}
    with open(ARQ_T1, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            linhas[r["mes"]] = r
    return linhas


def focos_noaa20_por_mes():
    """Contagem mensal filtrada do NOAA-20, com os mesmos filtros do par principal."""
    focos = defaultdict(int)
    for caminho in sorted(comum._arquivos("viirs-jpss1")):
        with open(caminho, newline="", encoding="utf-8", errors="replace") as f:
            leitor = csv.reader(f)
            cab = next(leitor)
            ix = {c: i for i, c in enumerate(cab)}
            n = len(cab)
            for linha in leitor:
                if len(linha) != n:
                    continue
                try:
                    lat, lon = float(linha[ix["latitude"]]), float(linha[ix["longitude"]])
                except ValueError:
                    continue
                if linha[ix["satellite"]] != "N20" or linha[ix["type"]] != "0" or linha[ix["confidence"]] == "l":
                    continue
                if not (comum.LON_MIN < lon < comum.LON_MAX and comum.LAT_MIN < lat < comum.LAT_MAX):
                    continue
                focos[linha[ix["acq_date"]][:7]] += 1
    return dict(focos)


def contagem_diaria_brasil(prefixo, satelite):
    dia = {}
    for caminho in sorted(comum.glob.glob(os.path.join(comum.DIR_COBERTURA, prefixo + "_*.csv"))):
        with open(caminho, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["satelite"] == satelite:
                    dia[r["data"]] = dia.get(r["data"], 0) + int(r["focos_brasil"])
    return dia


def dias_degradados_aqua():
    """{mes: dias degradados do Aqua}, comparando com o S-NPP no Brasil inteiro (2012-02 em diante)."""
    aqua = contagem_diaria_brasil("modis", "Aqua")
    snpp = contagem_diaria_brasil("viirs-snpp", "N")
    razoes = defaultdict(dict)
    for d, v in snpp.items():
        if d in aqua and v > 0:
            razoes[d[:7]][d] = aqua[d] / v
    saida = {}
    for mes, rs in razoes.items():
        med = statistics.median(rs.values())
        saida[mes] = sum(1 for r in rs.values() if r < FATOR_DEGRADADO * med)
    return saida


def dias_fracos_snpp():
    """{mes: dias em que o S-NPP veio muito abaixo do Aqua no Brasil inteiro}: a regra dos dias degradados
    do Aqua, invertida. So informativo: hoje esses dias nao tiram o mes da calibracao."""
    aqua = contagem_diaria_brasil("modis", "Aqua")
    snpp = contagem_diaria_brasil("viirs-snpp", "N")
    razoes = defaultdict(dict)
    for d, v in aqua.items():
        if d in snpp and v > 0:
            razoes[d[:7]][d] = snpp[d] / v
    saida = {}
    for mes, rs in razoes.items():
        med = statistics.median(rs.values())
        n = sum(1 for r in rs.values() if r < FATOR_DEGRADADO * med)
        if n:
            saida[mes] = n
    return saida


def razao_terra_aqua_por_ano():
    """Focos Terra / focos Aqua por ano (dia e noite), pela tabela por celula do modelo com fatores."""
    arq = os.path.join(RAIZ, "Dados", "harmonizado", "fatores", "tabela_celula_mes.csv")
    if not os.path.exists(arq):
        return None
    t, a = defaultdict(float), defaultdict(float)
    with open(arq, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            ano = int(r["mes"][:4])
            t[ano] += float(r["T_terra"] or 0)
            a[ano] += float(r["A_aqua"] or 0)
    return {str(ano): round(t[ano] / a[ano], 3) for ano in sorted(a) if a[ano]}


# ---------------------------------------------------------------- calculo

def fmt_pct(x):
    return ("%.1f" % x).replace(".", ",")


MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro",
            "novembro", "dezembro"]


def nome_mes(m):
    return "%s de %s" % (MESES_PT[int(m[5:7]) - 1], m[:4])


def fmt_num(x, casas=0):
    return ("{:,.%df}" % casas).format(x).replace(",", "X").replace(".", ",").replace("X", ".")


def percentil(valores, p):
    v = sorted(valores)
    if not v:
        return None
    k = (len(v) - 1) * p / 100
    i = int(k)
    return v[i] if i + 1 >= len(v) else v[i] + (v[i + 1] - v[i]) * (k - i)


def main():
    t1 = ler_t1()
    meses = comum.MESES_SERIE
    n20 = focos_noaa20_por_mes()
    sem_n20 = comum.dias_sem_dado("viirs-jpss1", "N20", meses)
    degr = dias_degradados_aqua()

    def num(x):
        return float(x) if x not in ("", None) else None

    dados = {}
    for m in meses:
        r = t1[m]
        sem_a = int(r["dias_sem_dado_aqua"] or 0) + degr.get(m, 0)
        sem_v = int(r["dias_sem_dado_viirs"]) if r["dias_sem_dado_viirs"] not in ("", None) else None
        dados[m] = {
            "aqua": num(r["aqua_bruto"]), "snpp": num(r["viirs_real"]),
            "sem_aqua": sem_a, "degradados_aqua": degr.get(m, 0), "sem_snpp": sem_v,
            "n20": n20.get(m), "sem_n20": sem_n20.get(m),
        }

    # razao S-NPP / NOAA-20 nos meses em que os dois estao completos
    sv = sn = 0
    for m, d in dados.items():
        if d["snpp"] and d["n20"] and d["sem_snpp"] == 0 and d["sem_n20"] == 0:
            sv += d["snpp"]
            sn += d["n20"]
    razao_snpp_n20 = sv / sn

    # calibracao da conversao MODIS -> VIIRS, por mes do ano
    soma_v, soma_a, usados = defaultdict(float), defaultdict(float), defaultdict(int)
    excluidos = []
    for m in comum.lista_meses(CALIB_INI, CALIB_FIM):
        d = dados[m]
        if d["sem_aqua"] >= LIMITE or (d["sem_snpp"] or 0) >= LIMITE:
            excluidos.append(m)
            continue
        k = int(m[5:7])
        soma_v[k] += d["snpp"]
        soma_a[k] += d["aqua"]
        usados[k] += 1
    razao = {k: soma_v[k] / soma_a[k] for k in range(1, 13)}

    # serie harmonizada
    serie = []
    for m in meses:
        d = dados[m]
        k = int(m[5:7])
        convertido = razao[k] * d["aqua"]
        if m < comum.PRIMEIRO_MES_VIIRS or d["snpp"] is None:
            focos, origem = convertido, "MODIS convertido"
            qualidade = "incompleto" if d["sem_aqua"] >= LIMITE else "completo"
        elif (d["sem_snpp"] or 0) < LIMITE:
            focos, origem, qualidade = d["snpp"], "VIIRS", "completo"
        elif d["n20"] is not None and (d["sem_n20"] or 0) < LIMITE:
            focos, origem, qualidade = d["n20"] * razao_snpp_n20, "VIIRS NOAA-20 ajustado", "corrigido"
        else:
            focos, origem = convertido, "MODIS convertido (VIIRS incompleto)"
            qualidade = "incompleto" if d["sem_aqua"] >= LIMITE else "corrigido"
        serie.append({
            "mes": m, "ano": int(m[:4]), "mes_num": k,
            "focos": round(focos), "origem": origem, "qualidade": qualidade,
            "modis_bruto": None if d["aqua"] is None else int(d["aqua"]),
            "viirs_real": None if d["snpp"] is None else int(d["snpp"]),
            "modis_convertido": round(convertido),
            "dias_sem_dado_aqua": d["sem_aqua"], "dias_degradados_aqua": d["degradados_aqua"],
            "dias_sem_dado_viirs": d["sem_snpp"],
        })

    # normal de cada mes: so os anos medidos pelo VIIRS (2012-02 em diante). Os anos convertidos do
    # MODIS (2003 a 2011) sao estimativa com faixa larga e puxariam o normal para cima.
    por_mes = defaultdict(list)
    todos_mes = defaultdict(list)
    for s in serie:
        todos_mes[s["mes_num"]].append(s["focos"])
        if s["qualidade"] != "incompleto" and not s["origem"].startswith("MODIS convertido"):
            por_mes[s["mes_num"]].append(s["focos"])
    chave = lambda k: "%02d" % k
    mediana = {chave(k): round(statistics.median(v)) for k, v in por_mes.items()}
    media = {chave(k): round(statistics.mean(v)) for k, v in por_mes.items()}
    p25 = {chave(k): round(percentil(v, 25)) for k, v in por_mes.items()}
    p75 = {chave(k): round(percentil(v, 75)) for k, v in por_mes.items()}

    for s in serie:
        c = chave(s["mes_num"])
        s["anomalia_pct"] = round(100 * (s["focos"] - mediana[c]) / mediana[c], 1)
        s["classe"] = "acima do normal" if s["focos"] > p75[c] else ("abaixo do normal" if s["focos"] < p25[c] else "normal")
        s["posicao_no_mes"] = 1 + sum(1 for x in todos_mes[s["mes_num"]] if x > s["focos"])

    # faixa de 2003 a 2011 (versao 2 do modelo com fatores): T1 pelo Aqua, fatores pelo Aqua e T1 pelo Terra
    arq_leit = os.path.join(RAIZ, "Dados", "harmonizado", "fatores_v2", "serie_pre2012_leituras.csv")
    arq_v2 = os.path.join(RAIZ, "Dados", "harmonizado", "fatores_v2", "resultados_v2.json")
    leituras = {}
    if os.path.exists(arq_leit):
        with open(arq_leit, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                leituras[r["mes"]] = r
    for s in serie:
        r = leituras.get(s["mes"])
        if r:
            s["faixa_inferior"] = int(r["faixa_inferior"])
            s["faixa_superior"] = int(r["faixa_superior"])
            s["leituras"] = {"t1_aqua": int(r["t1_aqua"]), "fatores_aqua": int(r["fatores_aqua"]), "t1_terra": int(r["t1_terra"])}
        else:
            s["faixa_inferior"] = s["faixa_superior"] = None

    totais = defaultdict(lambda: {"focos": 0, "meses": 0})
    pico = {}
    for s in serie:
        t = totais[s["ano"]]
        t["focos"] += s["focos"]
        t["meses"] += 1
        if s["ano"] not in pico or s["focos"] > pico[s["ano"]]["focos"]:
            pico[s["ano"]] = {"mes": s["mes"], "focos": s["focos"]}
    # faixa anual: nos meses com faixa entra a faixa; nos outros, o proprio valor (ex.: 2012 so tem faixa em janeiro)
    anos_com_faixa = {s["ano"] for s in serie if s["faixa_inferior"] is not None}
    faixa_ano = defaultdict(lambda: [0, 0])
    for s in serie:
        if s["ano"] in anos_com_faixa:
            faixa_ano[s["ano"]][0] += s["faixa_inferior"] if s["faixa_inferior"] is not None else s["focos"]
            faixa_ano[s["ano"]][1] += s["faixa_superior"] if s["faixa_superior"] is not None else s["focos"]
    totais_ano = [{"ano": a, "focos": v["focos"], "meses": v["meses"], "mes_pico": pico[a]["mes"],
                   "faixa_inferior": faixa_ano[a][0] if a in faixa_ano else None,
                   "faixa_superior": faixa_ano[a][1] if a in faixa_ano else None} for a, v in sorted(totais.items())]
    ranking = sorted(serie, key=lambda s: s["focos"], reverse=True)[:10]

    # meses de 2003 a 2012-01 em que o Aqua contou mais focos que em qualquer mes igual da calibracao:
    # ali a taxa e usada fora da faixa que foi vista
    max_calib = defaultdict(float)
    for m in comum.lista_meses(CALIB_INI, CALIB_FIM):
        if m not in excluidos:
            max_calib[int(m[5:7])] = max(max_calib[int(m[5:7])], dados[m]["aqua"])
    fora_calib = [{"mes": s["mes"], "aqua": s["modis_bruto"], "maximo_na_calibracao": int(max_calib[s["mes_num"]])}
                  for s in serie if s["mes"] < comum.PRIMEIRO_MES_VIIRS and s["modis_bruto"] and s["modis_bruto"] > max_calib[s["mes_num"]]]
    meses_fora = {x["mes"] for x in fora_calib}
    recordes_fora = sum(1 for s in ranking if s["mes"] in meses_fora)
    maior_fora = max(fora_calib, key=lambda x: x["aqua"] / x["maximo_na_calibracao"]) if fora_calib else None

    # dias fracos do S-NPP: quanto mudaria a taxa se a regra do Aqua valesse tambem para ele
    fracos = dias_fracos_snpp()
    calib_ok = [m for m in comum.lista_meses(CALIB_INI, CALIB_FIM) if m not in excluidos]
    sairiam = [m for m in calib_ok if (dados[m]["sem_snpp"] or 0) + fracos.get(m, 0) >= LIMITE]
    efeito_snpp = []
    for k in sorted({int(m[5:7]) for m in sairiam}):
        ms = [m for m in calib_ok if int(m[5:7]) == k and m not in sairiam]
        nova = sum(dados[m]["snpp"] for m in ms) / sum(dados[m]["aqua"] for m in ms)
        efeito_snpp.append({"mes_do_ano": chave(k), "taxa_publicada": round(razao[k], 3), "taxa_com_a_regra": round(nova, 3)})
    meses_fracos_calib = {m: n for m, n in sorted(fracos.items()) if m in calib_ok}

    res = json.load(open(ARQ_RESULTADOS, encoding="utf-8"))
    t1r = res["tecnicas"]["T1_fator_sazonal"]
    teste = t1r["teste"]

    fatores_resumo = None
    if os.path.exists(arq_v2):
        v2 = json.load(open(arq_v2, encoding="utf-8"))
        mt = v2["metricas"]
        fatores_resumo = {
            "o_que_e": "Modelo de Poisson por célula da grade NASA POWER (cerca de 55 x 68 km) e mês, com pesos para fatores que só usam dados existentes antes de 2012 (MODIS e clima da NASA POWER). Serve para explicar por que a razão VIIRS/MODIS muda e para dar a faixa de 2003 a 2011.",
            "pesos": [{"fator": p["nome"], "multiplica_razao_por_1_desvio": round(p["multiplica_razao_por_1_desvio"], 3),
                       "desvio": round(p["desvio_padrao_treino"], 3), "ic95_peso": [round(x, 3) for x in p["ic95"]]}
                      for p in v2["pesos"] if "nome" in p],
            "triagem": [{"fator": r["nome"], "efeito_pct": round(r["efeito_pct"], 1), "mantido": r["mantido"],
                         "sinal": r["sinal_vs_hipotese"]} for r in v2["triagem"]],
            "comparacao_teste_2020_2023": {k: {"erro_mensal_pct": round(mt[k]["teste_validos"]["wape_pct"], 1),
                                               "erro_48_meses_pct": round(mt[k]["teste_48_meses"]["wape_pct"], 1),
                                               "erro_deriva_2024_2025_pct": round(mt[k]["deriva"]["wape_pct"], 1)}
                                           for k in ("T1", "modelo_v2")},
            "cobertura_faixa_95": v2["faixa_previsao"]["cobertura_teste"],
            "media_anual_2003_2011": {k: round(v) for k, v in v2["pre_2012"]["media_anual_2003_2011"].items()},
            "viirs_real_media_anual_2012_2021": round(v2["pre_2012"]["viirs_real_media_anual_2012_2021"]),
            "descoberta": "Antes de 2012 os dois MODIS discordam: o Terra via 0,47 foco por foco do Aqua em 2003-2011 e 0,72 de 2012 em diante (dia e noite juntos). Pelo Aqua, o passado teve mais fogo; pelo Terra, o nível foi parecido com o de hoje. Por isso 2003-2011 aparece como faixa.",
        }
        rta = razao_terra_aqua_por_ano()
        if rta:
            fatores_resumo["razao_terra_aqua_por_ano"] = rta
            fatores_resumo["descoberta"] += (" A razão também sobe aos poucos dentro do período (%s em 2003, %s em 2011), então não dá para "
                                             "garantir que a relação entre os sensores ficou parada de 2003 a 2011." % (
                                                 fmt_num(rta["2003"], 2), fmt_num(rta["2011"], 2)))

    # validacao da T1: usa a avaliacao mais recente (versao 2), que tira tambem os meses com Aqua degradado
    # e calcula a referencia de anomalia so com a calibracao; sem ela, usa resultados.json
    validacao = {
        "desenho": "Taxas aprendidas com 2012-02 a 2019-12 e testadas em 2020 a 2023, anos que o modelo não viu (%d meses válidos)" % teste["n_meses"],
        "erro_mensal_wape_pct": round(teste["wape_pct"], 1),
        "vies_pct": round(teste["vies_pct"], 1),
        "spearman": round(teste["spearman"], 3),
        "acerto_acima_abaixo_da_mediana_pct": round(teste["anomalia_2classes_pct"], 1),
        "erro_total_anual_pct": {a: round(v["erro_pct"], 1) for a, v in teste["erro_anual"].items()},
    }
    if os.path.exists(arq_v2):
        tv = json.load(open(arq_v2, encoding="utf-8"))["metricas"]["T1"]
        t1t, t48 = tv["teste_validos"], tv["teste_48_meses"]
        validacao = {
            "desenho": "Taxas aprendidas com 2012-02 a 2019-12 e testadas em 2020 a 2023, anos que o modelo não viu (%d meses válidos, sem os meses com falha de satélite)" % t1t["n_meses"],
            "erro_mensal_wape_pct": round(t1t["wape_pct"], 1),
            "erro_mensal_48_meses_pct": round(t48["wape_pct"], 1),
            "vies_pct": round(t1t["vies_pct"], 1),
            "spearman": round(t1t["spearman"], 3),
            "acerto_acima_abaixo_da_mediana_pct": round(t1t["anomalia_2classes_pct"], 1),
            "acerto_tres_faixas_pct": round(t1t["anomalia_3classes_pct"], 1),
            "erro_total_anual_pct": {a: round(v["erro_pct"], 1) for a, v in t1t["erro_anual"].items()},
        }
    validacao["taxas_publicadas"] = ("As taxas do teste foram aprendidas só com 2012-2019. As taxas publicadas foram refeitas depois, "
                                     "com o mesmo método, usando %s a %s." % (CALIB_INI, CALIB_FIM))
    # erro em areas menores que a Bahia (Scripts/harmonizacao/erro_por_area.py)
    arq_area = os.path.join(RAIZ, "Dados", "harmonizado", "erro_por_area.json")
    erro_area = None
    if os.path.exists(arq_area):
        ea = json.load(open(arq_area, encoding="utf-8"))
        erro_area = {e["escala"]: e for e in ea["escalas"]}
        validacao["erro_por_area"] = [{k: e[k] for k in ("escala", "descricao", "celulas_por_area", "erro_mensal_wape_pct")}
                                      for e in ea["escalas"]]
    if erro_area:
        lim_area = ("Os %s%% de erro valem para a Bahia inteira. Em áreas menores o erro cresce: no teste de 2020-2023 foi de "
                    "%s%% em blocos de cerca de 110 x 135 km e de %s%% numa célula de cerca de 55 x 68 km. Antes de 2012 não há VIIRS "
                    "para medir; o erro de 2020-2023 é a melhor referência." % (
                        fmt_pct(validacao["erro_mensal_wape_pct"]), fmt_pct(erro_area["bloco_2x2"]["erro_mensal_wape_pct"]),
                        fmt_pct(erro_area["celula"]["erro_mensal_wape_pct"])))
    else:
        lim_area = "Os %s%% de erro valem para a Bahia inteira; em áreas menores o erro é maior." % fmt_pct(validacao["erro_mensal_wape_pct"])

    saida = {
        "versao": 2,
        "gerado_em": "2026-11-14",
        "area": {
            "nome": "Bahia",
            "descricao": "Retângulo envolvente da Bahia (inclui partes de estados vizinhos)",
            "lon_min": comum.LON_MIN, "lon_max": comum.LON_MAX,
            "lat_min": comum.LAT_MIN, "lat_max": comum.LAT_MAX,
        },
        "unidade": "focos equivalentes VIIRS Suomi NPP 375 m",
        "fonte": "NASA FIRMS (MODIS C6.1 Aqua; VIIRS 375 m Suomi NPP e NOAA-20), arquivos anuais por país, processamento padrão",
        "citacao": "We acknowledge the use of imagery from the NASA LANCE FIRMS (https://earthdata.nasa.gov/firms), part of the NASA Earth Science Data and Information System (ESDIS).",
        "periodo": {"inicio": meses[0], "fim": meses[-1],
                    "observacao": "2026 ainda não incluído: os arquivos anuais de 2026 não existem e a API do FIRMS pede chave (MAP_KEY)."},
        "meses": serie,
        "normal_por_mes": {"mediana": mediana, "media": media, "p25": p25, "p75": p75,
                           "anos_usados": "2012 a 2025, anos medidos pelo VIIRS (os anos convertidos do MODIS ficam fora do normal)"},
        "totais_por_ano": totais_ano,
        "top10_meses": [{"mes": s["mes"], "focos": s["focos"], "origem": s["origem"]} for s in ranking],
        "metodo": {
            "tecnica": "T1, fator sazonal: uma taxa VIIRS/MODIS para cada mês do ano",
            "como_funciona": "Nos anos em que os dois sensores funcionaram juntos, divide-se o total de focos do VIIRS pelo do MODIS Aqua em cada mês do ano. Os meses que só têm MODIS (2003 a 2012-01) são multiplicados por essa taxa. De 2012-02 em diante a série usa o VIIRS real.",
            "taxa_por_mes": {chave(k): round(v, 3) for k, v in razao.items()},
            "meses_usados_por_mes": {chave(k): usados[k] for k in range(1, 13)},
            "periodo_calibracao": [CALIB_INI, CALIB_FIM],
            "meses_excluidos_da_calibracao": excluidos,
            "meses_fora_da_calibracao": fora_calib,
            "dias_fracos_snpp_na_calibracao": meses_fracos_calib,
            "efeito_regra_dias_fracos_snpp": {"meses_que_sairiam": sairiam, "taxas": efeito_snpp},
            "razao_snpp_noaa20": round(razao_snpp_n20, 4),
            "filtros": ["type = 0 (fogo em vegetação)", "MODIS com confiança 30 ou mais", "VIIRS sem confiança baixa", "par MODIS Aqua x VIIRS Suomi NPP (mesmo horário de passagem)"],
            "validacao": validacao,
            "fatores": fatores_resumo,
            "limitacoes": [
                "O número central é a taxa por mês, que teve o menor erro entre os métodos simples no teste. A mistura com o modelo de fatores errou um pouco menos, mas a diferença pode ser acaso. O modelo de fatores explica a variação e ajuda a dar a faixa de 2003-2011.",
                "De 2003 a 2011 o número central é a leitura do Aqua, que fica quase sempre no teto da faixa; a leitura do Terra dá menos fogo. Recordes e posições desse período dependem dessa escolha.",
                validacao["taxas_publicadas"],
                "De 2003 a 2011 não há VIIRS para conferir: os valores desse período são estimativas, por isso vêm com faixa.",
                "O normal de cada mês (mediana e faixa entre os percentis 25 e 75) usa os anos medidos pelo VIIRS, de 2012 a 2025.",
                lim_area,
                ("Em %d meses de 2003 a 2011 o Aqua contou mais focos que em qualquer mês igual da calibração (o caso mais longe: %s, "
                 "%s focos contra no máximo %s). Nesses meses, que incluem %d dos 10 recordes, a taxa é usada fora da faixa que foi vista." % (
                     len(fora_calib), nome_mes(maior_fora["mes"]), fmt_num(maior_fora["aqua"]), fmt_num(maior_fora["maximo_na_calibracao"]), recordes_fora))
                if fora_calib else "Nenhum mês de 2003 a 2011 passa do maior mês igual da calibração.",
                ("A regra de dias degradados do Aqua foi criada depois que agosto de 2020, um mês do teste, mostrou o problema. "
                 "Contando os 48 meses do teste, o erro é de %s%%." % fmt_pct(validacao.get("erro_mensal_48_meses_pct", validacao["erro_mensal_wape_pct"]))),
                ("Os dias fracos do S-NPP não passam pela mesma checagem: %d meses da calibração têm 1 ou 2 dias assim. Aplicar a mesma regra "
                 "tiraria %s da calibração e mudaria a taxa desse mês do ano de %s para %s." % (
                     len(meses_fracos_calib), ", ".join(nome_mes(m) for m in sairiam), ", ".join(fmt_num(e["taxa_publicada"], 2) for e in efeito_snpp),
                     ", ".join(fmt_num(e["taxa_com_a_regra"], 2) for e in efeito_snpp)))
                if sairiam else "Os dias fracos do S-NPP não passam pela mesma checagem, mas aplicar a regra não tiraria nenhum mês da calibração.",
                "A série fecha em dezembro de 2025; 2026 aparece só no painel dos últimos dias.",
                "A partir de 2022 a órbita do satélite Aqua mudou (passa mais tarde), por isso a calibração vai só até 2021.",
                "Área é um retângulo, não o contorno oficial da Bahia.",
                "Dias degradados só são detectados de 2012 em diante, quando há o VIIRS para comparar.",
            ],
        },
    }

    os.makedirs(SAIDA, exist_ok=True)
    with open(os.path.join(SAIDA, "calendario_bahia.json"), "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)
    campos = ["mes", "ano", "mes_num", "focos", "faixa_inferior", "faixa_superior", "origem", "qualidade", "anomalia_pct", "classe", "posicao_no_mes",
              "modis_bruto", "viirs_real", "modis_convertido", "dias_sem_dado_aqua", "dias_degradados_aqua", "dias_sem_dado_viirs"]
    with open(os.path.join(SAIDA, "calendario_bahia.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=campos, extrasaction="ignore")
        w.writeheader()
        w.writerows(serie)

    # copia para a pasta do site, que le data/calendario_bahia.json
    import shutil
    pasta_site = os.path.join(RAIZ, "site", "data")
    if os.path.isdir(os.path.dirname(pasta_site)):
        os.makedirs(pasta_site, exist_ok=True)
        for nome in ("calendario_bahia.json", "calendario_bahia.csv"):
            shutil.copy(os.path.join(SAIDA, nome), os.path.join(pasta_site, nome))

    gerar_celulas(serie, razao, razao_snpp_n20)
    print("razao S-NPP/NOAA-20:", round(razao_snpp_n20, 4))
    print("taxa por mes:", {k: round(v, 2) for k, v in razao.items()})
    print("meses excluidos da calibracao:", excluidos)
    print("corrigidos:", [(s["mes"], s["origem"], s["focos"]) for s in serie if s["qualidade"] != "completo"])
    print("meses com dia degradado do Aqua:", {m: v for m, v in degr.items() if v})
    print("meses:", len(serie), "| arquivos em", SAIDA)


def gerar_celulas(serie, razao, razao_snpp_n20):
    """Serie harmonizada por celula da grade NASA POWER (0,5 x 0,625 grau), para o site somar
    so as celulas perto do usuario. Mesmas regras da serie da Bahia: VIIRS real a partir de 2012-02,
    NOAA-20 ajustado nos meses de falha do S-NPP e, antes, Aqua x taxa do mes (faixa ate a leitura do Terra)."""
    arq_tab = os.path.join(RAIZ, "Dados", "harmonizado", "fatores", "tabela_celula_mes.csv")
    arq_v2 = os.path.join(RAIZ, "Dados", "harmonizado", "fatores_v2", "resultados_v2.json")
    if not (os.path.exists(arq_tab) and os.path.exists(arq_v2)):
        print("sem tabela por celula: celulas_bahia.json nao foi gerado")
        return
    r_terra = {int(k): v for k, v in json.load(open(arq_v2, encoding="utf-8"))["pre_2012"]["razoes_producao_t1_terra"].items()}
    meses = [s["mes"] for s in serie]
    idx = {m: i for i, m in enumerate(meses)}
    ajustados = {s["mes"] for s in serie if s["origem"] == "VIIRS NOAA-20 ajustado"}
    pre = [m for m in meses if m < comum.PRIMEIRO_MES_VIIRS]
    cel = {}
    with open(arq_tab, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            c = cel.setdefault(r["celula"], {"lon": float(r["lon"]), "lat": float(r["lat"]),
                                             "V": [0.0] * len(meses), "A": [0.0] * len(meses),
                                             "T": [0.0] * len(meses), "N": [0.0] * len(meses)})
            i = idx.get(r["mes"])
            if i is None:
                continue
            c["V"][i] = float(r["V_snpp"] or 0)
            c["A"][i] = float(r["A_aqua"] or 0)
            c["T"][i] = float(r["T_terra"] or 0)
            c["N"][i] = float(r["N20"] or 0)
    saida = []
    for nome, c in sorted(cel.items()):
        f, ii, ss, aa = [], [], [], []
        for i, m in enumerate(meses):
            k = int(m[5:7])
            if m < comum.PRIMEIRO_MES_VIIRS:
                ca, ct = razao[k] * c["A"][i], r_terra[k] * c["T"][i]
                f.append(round(ca))
                ii.append(round(min(ca, ct)))
                ss.append(round(max(ca, ct)))
                aa.append(round(c["A"][i]))
            elif m in ajustados:
                f.append(round(c["N"][i] * razao_snpp_n20))
            else:
                f.append(round(c["V"][i]))
        saida.append({"id": nome, "lon": c["lon"], "lat": c["lat"], "f": f, "i": ii, "s": ss, "a": aa})
    corpo = {"meses": meses, "n_pre": len(pre), "grade": "NASA POWER 0,5 x 0,625 grau",
             "nota": "f = focos harmonizados por mes; i e s = faixa de 2003-01 a 2012-01 (leituras do Aqua e do Terra); a = focos MODIS Aqua sem harmonizar no mesmo periodo",
             "celulas": saida}
    texto = json.dumps(corpo, ensure_ascii=False, separators=(",", ":"))
    for pasta in (SAIDA, os.path.join(RAIZ, "site", "data")):
        if os.path.isdir(os.path.dirname(pasta)):
            os.makedirs(pasta, exist_ok=True)
            with open(os.path.join(pasta, "celulas_bahia.json"), "w", encoding="utf-8") as fo:
                fo.write(texto)
    soma = [sum(c["f"][i] for c in saida) for i in range(len(meses))]
    dif = max(abs(soma[i] - s["focos"]) / max(s["focos"], 1) for i, s in enumerate(serie))
    print("celulas:", len(saida), "| tamanho %.0f KB" % (len(texto) / 1024), "| maior diferenca da soma contra a Bahia: %.2f%%" % (dif * 100))


if __name__ == "__main__":
    main()
