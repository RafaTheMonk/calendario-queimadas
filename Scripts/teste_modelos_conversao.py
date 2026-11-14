#!/usr/bin/env python3
"""Teste de 3 jeitos de converter focos MODIS Aqua em focos VIIRS S-NPP (contagem mensal, retangulo da Bahia).
Treina em 2012-2019, testa em 2020-2025. Uso: python3 -I Scripts/teste_modelos_conversao.py Dados/firms_bahia
"""
import csv,glob,math,os,sys
from collections import defaultdict
P=sys.argv[1]
m=defaultdict(lambda: defaultdict(int))
for arq in glob.glob(os.path.join(P,'*_bahia.csv')):
    for r in csv.DictReader(open(arq,newline='')):
        if None in (r.get('satellite'),r.get('type'),r.get('confidence')) or r['type']!='0': continue
        c=r['confidence']
        if (c.isdigit() and int(c)<30) or c=='l': continue
        sat={'Aqua':'A','N':'S'}.get(r['satellite'])
        if sat: m[sat][r['acq_date'][:7]]+=1
meses=sorted(k for k in m['A'] if k in m['S'] and '2012-02'<=k<='2025-12')
tr=[k for k in meses if k<'2020']; te=[k for k in meses if k>='2020']
A=lambda k:m['A'][k]; V=lambda k:m['S'][k]
# 1 razao unica
R=sum(V(k) for k in tr)/sum(A(k) for k in tr)
p1=lambda k:R*A(k)
# 2 razao por mes do ano
rm={mm:sum(V(k) for k in tr if k[5:]==mm)/sum(A(k) for k in tr if k[5:]==mm) for mm in {k[5:] for k in tr}}
p2=lambda k:rm[k[5:]]*A(k)
# 3 regressao log-log
xs=[math.log(A(k)) for k in tr]; ys=[math.log(V(k)) for k in tr]
mx=sum(xs)/len(xs); my=sum(ys)/len(ys)
b=sum((x-mx)*(y-my) for x,y in zip(xs,ys))/sum((x-mx)**2 for x in xs); a=my-b*mx
p3=lambda k:math.exp(a)*A(k)**b
def wape(pred,ks): return 100*sum(abs(pred(k)-V(k)) for k in ks)/sum(V(k) for k in ks)
def corr(pred,ks):
    xs=[pred(k) for k in ks]; ys=[V(k) for k in ks]; mx=sum(xs)/len(xs); my=sum(ys)/len(ys)
    return sum((x-mx)*(y-my) for x,y in zip(xs,ys))/math.sqrt(sum((x-mx)**2 for x in xs)*sum((y-my)**2 for y in ys))
print(f"meses treino {len(tr)} (2012-2019), teste {len(te)} (2020-2025)")
print(f"razao unica R={R:.2f} | log-log: V = {math.exp(a):.2f} * A^{b:.3f}")
for nome,f in [('1 razao unica',p1),('2 razao por mes',p2),('3 regressao log-log',p3)]:
    print(f"{nome:22s} erro teste(WAPE) {wape(f,te):5.1f}%  correlacao {corr(f,te):.3f}")
    for ano in range(2020,2026):
        ks=[k for k in te if k.startswith(str(ano))]
        s=sum(f(k) for k in ks); v=sum(V(k) for k in ks)
        print(f"     {ano}: previsto {s:8.0f} real {v:8.0f}  erro anual {100*(s-v)/v:+.1f}%")
print("razao por mes do ano (treino):", ' '.join(f"{mm}:{rm[mm]:.1f}" for mm in sorted(rm)))
# pico
for ano in range(2012,2026):
    ka=[k for k in meses if k.startswith(str(ano))]
    if ka: print(ano,'pico Aqua',max(ka,key=A)[5:],'pico S-NPP',max(ka,key=V)[5:], end=' | ')
print()
