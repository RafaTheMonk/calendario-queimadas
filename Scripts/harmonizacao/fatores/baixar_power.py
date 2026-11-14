"""Baixa o clima mensal da NASA POWER para o retangulo da Bahia (2003 a 2025).

Uma chamada por parametro (a API aceita so um por vez). As respostas brutas
ficam em Dados/nasa_power/ e nao sao baixadas de novo. Nenhum dado pessoal
vai na requisicao: so parametro, retangulo e anos.

Uso: python3 -I Scripts/harmonizacao/fatores/baixar_power.py
"""
import os
import sys
import time
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(AQUI)))
DESTINO = os.path.join(RAIZ, "Dados", "nasa_power")
PARAMETROS = ["PRECTOTCORR", "WS10M", "RH2M", "T2M"]
URL = ("https://power.larc.nasa.gov/api/temporal/monthly/regional?parameters=%s&community=AG"
       "&longitude-min=-46.875&longitude-max=-37.5&latitude-min=-18.5&latitude-max=-8.5"
       "&start=2003&end=2025&format=JSON")


def baixar(parametro, tentativas=5):
    caminho = os.path.join(DESTINO, "power_%s_2003_2025.json" % parametro)
    if os.path.exists(caminho) and os.path.getsize(caminho) > 100000:
        print("ja existe:", caminho)
        return caminho
    for t in range(1, tentativas + 1):
        try:
            req = urllib.request.Request(URL % parametro, headers={"User-Agent": "pesquisa-focos-calor"})
            with urllib.request.urlopen(req, timeout=300) as r:
                corpo = r.read()
            if b'"features"' not in corpo[:200]:
                raise ValueError("resposta sem features: %r" % corpo[:200])
            with open(caminho, "wb") as f:
                f.write(corpo)
            print("baixado:", parametro, len(corpo), "bytes")
            return caminho
        except Exception as e:  # rede, 5xx, resposta inesperada
            print("tentativa %d falhou para %s: %s" % (t, parametro, e))
            time.sleep(5 * t)
    raise SystemExit("nao consegui baixar " + parametro)


if __name__ == "__main__":
    os.makedirs(DESTINO, exist_ok=True)
    for p in PARAMETROS:
        baixar(p)
