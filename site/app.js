/* Calendário de Queimadas: lê data/calendario_bahia.json e desenha a página.
   Sem build: HTML, CSS e este arquivo. Bibliotecas: ECharts (gráficos) e Leaflet (mapa). */

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// paleta "inferno": lembra fogo, é perceptualmente uniforme e funciona para daltônicos
const INFERNO = ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4'];
// divergente azul e laranja (PuOr), seguro para daltônicos
const DIVERGENTE = ['#2d6fae', '#6fa3d2', '#b9d3ea', '#f2f0ee', '#f6c68f', '#e08a2c', '#b35806'];

const fmt = (n) => (n === null || n === undefined) ? 'sem dado' : Math.round(n).toLocaleString('pt-BR');
const pct = (n) => (n > 0 ? '+' : '') + n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
const css = (nome) => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();

let DADOS = null;
const graficos = {};
const HOJE = new Date();
const MES_ATUAL = HOJE.getMonth() + 1;
const ANO_ATUAL = HOJE.getFullYear();
const estado = { modo: 'focos', brutos: false, mes: MES_ATUAL };

function aplicarTemaSalvo() {
  try {
    const t = localStorage.getItem('tema');
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* sem armazenamento: segue o tema do sistema */ }
}

function temaAtual() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function corInferno(t) {
  const x = Math.max(0, Math.min(1, t)) * (INFERNO.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = INFERNO[i];
  const b = INFERNO[Math.min(i + 1, INFERNO.length - 1)];
  const c = (h, k) => parseInt(h.slice(k, k + 2), 16);
  const mix = (k) => Math.round(c(a, k) + (c(b, k) - c(a, k)) * f).toString(16).padStart(2, '0');
  return '#' + mix(1) + mix(3) + mix(5);
}

function desenharTudo() {
  heroGrafico();
  calendario(estado.modo);
  serie(estado.brutos);
  mesAoLongoDosAnos(estado.mes);
}

async function iniciar() {
  aplicarTemaSalvo();
  const resp = await fetch('data/calendario_bahia.json');
  DADOS = await resp.json();
  document.getElementById('periodo-ini').textContent = DADOS.periodo.inicio.slice(0, 4);
  document.getElementById('periodo-fim').textContent = DADOS.periodo.fim.slice(0, 4);
  agora();
  cartoes();
  montarSeletorMes();
  desenharTudo();
  mapa();
  topDez();
  metodo();
  rodape();
  ligarControles();
  window.addEventListener('resize', () => Object.values(graficos).forEach((g) => g.resize()));
}

function heroGrafico() {
  const el = document.getElementById('graf-hero');
  const g = graficos.hero || echarts.init(el);
  graficos.hero = g;
  const med = DADOS.normal_por_mes.mediana;
  const vals = MESES.map((_, i) => med[String(i + 1).padStart(2, '0')]);
  const lmin = Math.log10(Math.min(...vals));
  const lmax = Math.log10(Math.max(...vals));
  const total = vals.reduce((s, v) => s + v, 0);
  const ordem = vals.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const top2 = ordem.slice(0, 2).map((x) => x[1]).sort((a, b) => a - b);
  const nome = (i) => MESES_LONGO[i].charAt(0).toUpperCase() + MESES_LONGO[i].slice(1);
  document.getElementById('hero-meses').textContent = nome(top2[0]) + ' e ' + MESES_LONGO[top2[1]];
  document.getElementById('hero-pct').textContent = Math.round((vals[top2[0]] + vals[top2[1]]) / total * 100) + '%';
  g.setOption({
    animationDuration: 900,
    animationEasing: 'cubicOut',
    grid: { left: 8, right: 8, top: 18, bottom: 22, containLabel: false },
    tooltip: { trigger: 'item', confine: true, formatter: (p) => `<strong>${MESES_LONGO[p.dataIndex]}</strong><br>mediana de ${fmt(p.value)} focos<br><span style="opacity:.75">clique para ver o mês ao longo dos anos</span>` },
    xAxis: { type: 'category', data: MESES.map((m) => m.charAt(0).toUpperCase()), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: css('--texto-suave'), fontSize: 11 } },
    yAxis: { type: 'value', show: false },
    series: [{
      type: 'bar', barWidth: '62%',
      data: vals.map((v, i) => ({ value: v, itemStyle: { color: corInferno(0.18 + 0.8 * (Math.log10(v) - lmin) / (lmax - lmin)), borderRadius: [6, 6, 2, 2], borderColor: i + 1 === MES_ATUAL ? css('--texto') : 'transparent', borderWidth: i + 1 === MES_ATUAL ? 2 : 0 } })),
      emphasis: { itemStyle: { shadowBlur: 12, shadowColor: 'rgba(255,140,40,.6)' } },
      label: { show: true, position: 'top', fontSize: 10, color: css('--texto-suave'), formatter: (p) => (p.dataIndex + 1 === MES_ATUAL ? 'agora' : (p.value >= 10000 ? Math.round(p.value / 1000) + ' mil' : '')) },
    }],
  }, true);
  g.off('click');
  g.on('click', (p) => {
    estado.mes = p.dataIndex + 1;
    document.getElementById('sel-mes').value = String(estado.mes);
    mesAoLongoDosAnos(estado.mes);
    document.getElementById('por-mes').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

async function agora() {
  const chave = String(MES_ATUAL).padStart(2, '0');
  const nm = DADOS.normal_por_mes;
  const diasNoMes = new Date(ANO_ATUAL, MES_ATUAL, 0).getDate();
  const porDia = (v) => v / diasNoMes;
  const nomeMes = MESES_LONGO[MES_ATUAL - 1];
  document.getElementById('agora-titulo').textContent = `Agora: ${nomeMes} de ${ANO_ATUAL}`;
  document.getElementById('agora-normal').textContent =
    `Normal de ${nomeMes}: ${fmt(porDia(nm.mediana[chave]))} focos por dia (mediana de 2003 a 2025; faixa normal de ${fmt(porDia(nm.p25[chave]))} a ${fmt(porDia(nm.p75[chave]))}). Esperado para o mês inteiro: cerca de ${fmt(nm.mediana[chave])} focos.`;
  const tag = document.getElementById('agora-tag');
  try {
    const r = await fetch('api/recentes');
    if (!r.ok) throw new Error('sem dados');
    const j = await r.json();
    const dias = j.dias;
    const media = dias.reduce((s, d) => s + d.focos_equivalentes, 0) / dias.length;
    const lo = porDia(nm.p25[chave]);
    const hi = porDia(nm.p75[chave]);
    const med = porDia(nm.mediana[chave]);
    const classe = media > hi ? 'acima do normal' : (media < lo ? 'abaixo do normal' : 'normal');
    document.getElementById('agora-valor').textContent = fmt(media);
    tag.textContent = classe;
    tag.className = 'tag ' + classeTag(classe);
    document.getElementById('agora-comparacao').textContent = `${pct(Math.round((media - med) / med * 1000) / 10)} em relação à mediana de ${nomeMes}`;
    const dm = (d) => d.data.slice(8, 10) + '/' + d.data.slice(5, 7);
    document.getElementById('agora-fonte').textContent = `Média de ${dias.length} dias (${dm(dias[0])} a ${dm(dias[dias.length - 1])}). Fonte: NASA FIRMS, VIIRS NOAA-20 em quase tempo real, convertido para a régua do histórico. Dado provisório.`;
  } catch (e) {
    document.getElementById('agora-valor').textContent = fmt(porDia(nm.mediana[chave]));
    document.getElementById('agora-unidade').textContent = 'focos por dia num ' + nomeMes + ' típico';
    tag.textContent = 'esperado';
    tag.className = 'tag normal';
    document.getElementById('agora-comparacao').textContent = 'Os dados dos últimos dias não carregaram agora.';
    document.getElementById('agora-fonte').textContent = '';
  }
}

function porMes() {
  return DADOS.meses;
}

function classeTag(classe) {
  if (classe === 'acima do normal') return 'acima';
  if (classe === 'abaixo do normal') return 'abaixo';
  return 'normal';
}

function cartoes() {
  const meses = porMes();
  const ultimo = meses[meses.length - 1];
  const nMesmoMes = meses.filter((m) => m.mes_num === ultimo.mes_num).length;
  const anos = DADOS.totais_por_ano;
  const pico = anos.reduce((a, b) => (b.focos > a.focos ? b : a));
  const ultimoAno = anos[anos.length - 1];
  const anosViirs = anos.filter((a) => a.ano >= 2013 && a.ano < ultimoAno.ano);
  const mediaViirs = anosViirs.reduce((s, a) => s + a.focos, 0) / anosViirs.length;
  const difAno = (ultimoAno.focos - mediaViirs) / mediaViirs * 100;
  const val = DADOS.metodo.validacao;

  const html = [
    `<article class="cartao principal">
      <p class="rotulo">Último mês com dado: ${MESES_LONGO[ultimo.mes_num - 1]} de ${ultimo.ano}</p>
      <p class="valor">${fmt(ultimo.focos)} focos</p>
      <p class="detalhe"><span class="tag ${classeTag(ultimo.classe)}">${ultimo.classe}</span> ${pct(ultimo.anomalia_pct)} em relação à mediana de ${MESES_LONGO[ultimo.mes_num - 1]}. É o ${ultimo.posicao_no_mes}º de ${nMesmoMes} desde 2003.</p>
    </article>`,
    `<article class="cartao">
      <p class="rotulo">Ano com mais fogo da série</p>
      <p class="valor">${pico.ano}</p>
      <p class="detalhe">${fmt(pico.focos)} focos${pico.faixa_inferior ? ` (estimativa, entre ${fmt(pico.faixa_inferior)} e ${fmt(pico.faixa_superior)})` : ''}. Pico em ${MESES_LONGO[Number(pico.mes_pico.slice(5, 7)) - 1]}.</p>
    </article>`,
    `<article class="cartao">
      <p class="rotulo">${ultimoAno.ano} contra a média de 2013 a ${ultimoAno.ano - 1}</p>
      <p class="valor">${pct(Math.round(difAno * 10) / 10)}</p>
      <p class="detalhe">${fmt(ultimoAno.focos)} focos no ano, contra média de ${fmt(mediaViirs)} nos anos com VIIRS.</p>
    </article>`,
    `<article class="cartao">
      <p class="rotulo">Precisão da conversão MODIS para VIIRS</p>
      <p class="valor">${val.erro_mensal_wape_pct.toLocaleString('pt-BR')}%</p>
      <p class="detalhe">de erro por mês nos anos de teste (2020 a 2023), que o modelo não viu. Acerta ${val.acerto_acima_abaixo_do_normal_pct.toLocaleString('pt-BR')}% dos meses acima ou abaixo do normal.</p>
    </article>`,
  ];
  document.getElementById('cartoes').innerHTML = html.join('');
}

function tooltipMes(m) {
  let t = `<strong>${MESES_LONGO[m.mes_num - 1]} de ${m.ano}</strong><br>`;
  if (m.faixa_inferior !== null && m.faixa_inferior !== undefined) {
    t += `${fmt(m.focos)} focos (estimativa)<br>faixa: ${fmt(m.faixa_inferior)} a ${fmt(m.faixa_superior)}<br>`;
  } else {
    t += `${fmt(m.focos)} focos<br>`;
  }
  t += `${pct(m.anomalia_pct)} da mediana do mês (${m.classe})<br>`;
  t += `${m.posicao_no_mes}º ${MESES_LONGO[m.mes_num - 1]} com mais fogo desde 2003<br>`;
  t += `<span style="opacity:.75">origem: ${m.origem}${m.qualidade === 'corrigido' ? ', mês corrigido' : ''}</span>`;
  return t;
}

function calendario(modo) {
  const el = document.getElementById('graf-calendario');
  const g = graficos.cal || echarts.init(el);
  graficos.cal = g;
  const meses = porMes();
  const anos = [...new Set(meses.map((m) => m.ano))];
  const dados = meses.map((m) => {
    let v;
    if (modo === 'focos') {
      v = Math.log10(Math.max(m.focos, 1));
    } else {
      const med = DADOS.normal_por_mes.mediana[String(m.mes_num).padStart(2, '0')];
      v = Math.max(-2, Math.min(2, Math.log2(Math.max(m.focos, 1) / med)));
    }
    const estimado = m.faixa_inferior !== null && m.faixa_inferior !== undefined;
    return {
      value: [m.mes_num - 1, anos.indexOf(m.ano), v],
      mes: m,
      itemStyle: estimado ? { borderColor: 'rgba(56,189,248,.55)', borderWidth: 1, borderType: 'dashed' } : { borderColor: css('--superficie'), borderWidth: 1 },
    };
  });
  const vals = meses.map((m) => Math.log10(Math.max(m.focos, 1)));
  const visual = modo === 'focos'
    ? {
      min: Math.floor(Math.min(...vals) * 10) / 10, max: Math.ceil(Math.max(...vals) * 10) / 10,
      inRange: { color: INFERNO },
      formatter: (v) => fmt(Math.pow(10, v)),
      text: ['mais focos', 'menos focos'],
    }
    : {
      min: -2, max: 2, inRange: { color: DIVERGENTE },
      formatter: (v) => (v >= 0 ? '+' : '') + Math.round((Math.pow(2, v) - 1) * 100) + '%',
      text: ['acima do normal', 'abaixo do normal'],
    };
  g.setOption({
    animation: false,
    grid: { left: 52, right: 16, top: 8, bottom: 72 },
    tooltip: { formatter: (p) => tooltipMes(p.data.mes), confine: true },
    xAxis: { type: 'category', data: MESES, splitArea: { show: false }, axisLabel: { color: css('--texto-suave') }, axisLine: { show: false }, axisTick: { show: false }, position: 'top' },
    yAxis: { type: 'category', data: anos, inverse: true, axisLabel: { color: css('--texto-suave') }, axisLine: { show: false }, axisTick: { show: false } },
    visualMap: {
      type: 'continuous', dimension: 2, orient: 'horizontal', left: 'center', bottom: 6, itemWidth: 14, itemHeight: 220,
      calculable: false, textStyle: { color: css('--texto-suave') }, ...visual,
    },
    series: [{ type: 'heatmap', data: dados, emphasis: { itemStyle: { borderColor: css('--texto'), borderWidth: 2 } } }],
  }, true);
  el.setAttribute('aria-label', modo === 'focos'
    ? 'Calendário de meses por anos colorido pela quantidade de focos, de 2003 a 2025'
    : 'Calendário de meses por anos colorido por quanto cada mês ficou acima ou abaixo da mediana daquele mês');
}

function serie(brutos) {
  const el = document.getElementById('graf-serie');
  const g = graficos.serie || echarts.init(el);
  graficos.serie = g;
  const anos = DADOS.totais_por_ano;
  const xs = anos.map((a) => String(a.ano));
  const inf = anos.map((a) => (a.faixa_inferior ? a.faixa_inferior : null));
  const dif = anos.map((a) => (a.faixa_inferior ? a.faixa_superior - a.faixa_inferior : null));
  const series = [
    { name: 'faixa_base', type: 'line', data: inf, stack: 'faixa', symbol: 'none', lineStyle: { opacity: 0 }, tooltip: { show: false }, silent: true },
    { name: 'Faixa (2003 a 2011)', type: 'line', data: dif, stack: 'faixa', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(56,189,248,.25)' }, tooltip: { show: false }, silent: true },
    { name: 'Focos harmonizados', type: 'line', data: anos.map((a) => a.focos), symbolSize: 6, lineStyle: { width: 3, color: css('--destaque') }, itemStyle: { color: css('--destaque') } },
  ];
  if (brutos) {
    // serie "ingenua": o que se ve juntando os dados sem harmonizar (MODIS ate 2011, VIIRS de 2012 em diante)
    const ingenua = anos.map((a) => {
      const ms = DADOS.meses.filter((m) => m.ano === a.ano);
      return ms.reduce((s, m) => s + (m.viirs_real !== null && m.viirs_real !== undefined ? m.viirs_real : (m.modis_bruto || 0)), 0);
    });
    series.push({ name: 'Sem harmonizar (MODIS até 2011, VIIRS depois)', type: 'line', data: ingenua, symbolSize: 5, lineStyle: { type: 'dashed', width: 2, color: '#94a3b8' }, itemStyle: { color: '#94a3b8' } });
  }
  g.setOption({
    animation: false,
    grid: { left: 64, right: 16, top: 36, bottom: 32 },
    legend: { top: 0, data: series.filter((s) => !s.silent).map((s) => s.name), textStyle: { color: css('--texto-suave') } },
    tooltip: {
      trigger: 'axis', confine: true,
      formatter: (ps) => {
        const ano = anos[ps[0].dataIndex];
        let t = `<strong>${ano.ano}</strong><br>`;
        ps.filter((p) => p.seriesName !== 'faixa_base' && p.seriesName !== 'Faixa (2003 a 2011)' && p.value !== null && p.value !== undefined)
          .forEach((p) => { t += `${p.marker}${p.seriesName}: ${fmt(p.value)}<br>`; });
        if (ano.faixa_inferior) t += `faixa: ${fmt(ano.faixa_inferior)} a ${fmt(ano.faixa_superior)}`;
        return t;
      },
    },
    xAxis: { type: 'category', data: xs, axisLabel: { color: css('--texto-suave') } },
    yAxis: { type: 'value', axisLabel: { color: css('--texto-suave'), formatter: (v) => (v >= 1000 ? Math.round(v / 1000) + ' mil' : v) }, splitLine: { lineStyle: { color: css('--borda') } } },
    series,
  }, true);
  document.getElementById('nota-brutos').hidden = !brutos;
}

function montarSeletorMes() {
  const sel = document.getElementById('sel-mes');
  sel.innerHTML = MESES_LONGO.map((m, i) => `<option value="${i + 1}" ${i + 1 === estado.mes ? 'selected' : ''}>${m}</option>`).join('');
}

function mesAoLongoDosAnos(numMes) {
  const el = document.getElementById('graf-mes');
  const g = graficos.mes || echarts.init(el);
  graficos.mes = g;
  const chave = String(numMes).padStart(2, '0');
  const normal = DADOS.normal_por_mes;
  const ms = DADOS.meses.filter((m) => m.mes_num === numMes);
  const cor = (m) => (m.classe === 'acima do normal' ? css('--acima') : m.classe === 'abaixo do normal' ? css('--abaixo') : '#9ca3af');
  g.setOption({
    animation: false,
    grid: { left: 64, right: 16, top: 16, bottom: 32 },
    tooltip: { confine: true, formatter: (p) => tooltipMes(ms[p.dataIndex]) },
    xAxis: { type: 'category', data: ms.map((m) => String(m.ano)), axisLabel: { color: css('--texto-suave') } },
    yAxis: { type: 'value', axisLabel: { color: css('--texto-suave'), formatter: (v) => (v >= 1000 ? Math.round(v / 1000) + ' mil' : v) }, splitLine: { lineStyle: { color: css('--borda') } } },
    series: [{
      type: 'bar',
      data: ms.map((m) => ({ value: m.focos, itemStyle: { color: cor(m), decal: m.faixa_inferior ? { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: Math.PI / 4, color: 'rgba(255,255,255,.35)' } : undefined } })),
      markArea: { silent: true, itemStyle: { color: 'rgba(148,163,184,.18)' }, data: [[{ yAxis: normal.p25[chave] }, { yAxis: normal.p75[chave] }]] },
      markLine: { silent: true, symbol: 'none', lineStyle: { color: css('--texto'), type: 'dashed' }, label: { position: 'insideEndTop', formatter: 'mediana ' + fmt(normal.mediana[chave]), color: css('--texto-suave') }, data: [{ yAxis: normal.mediana[chave] }] },
    }],
    aria: { enabled: true, decal: { show: false } },
  }, true);
  el.setAttribute('aria-label', `Focos de ${MESES_LONGO[numMes - 1]} em cada ano, com a mediana do mês`);
}

function mapa() {
  const a = DADOS.area;
  document.getElementById('lat-min').value = a.lat_min;
  document.getElementById('lat-max').value = a.lat_max;
  document.getElementById('lon-min').value = a.lon_min;
  document.getElementById('lon-max').value = a.lon_max;
  const m = L.map('mapa', { scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 12, attribution: '&copy; colaboradores do OpenStreetMap',
  }).addTo(m);
  const bahia = L.rectangle([[a.lat_min, a.lon_min], [a.lat_max, a.lon_max]], { color: '#c2410c', weight: 2, fillOpacity: 0.08 }).addTo(m);
  bahia.bindTooltip('Área processada: ' + a.descricao);
  m.fitBounds(bahia.getBounds(), { padding: [12, 12] });
  let outro = null;
  document.getElementById('form-area').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = ['lat-min', 'lat-max', 'lon-min', 'lon-max'].map((id) => parseFloat(document.getElementById(id).value));
    const msg = document.getElementById('msg-area');
    if (v.some(Number.isNaN) || v[0] >= v[1] || v[2] >= v[3]) {
      msg.textContent = 'Confira os valores: a latitude sul tem que ser menor que a norte, e a longitude oeste menor que a leste.';
      return;
    }
    if (outro) m.removeLayer(outro);
    outro = L.rectangle([[v[0], v[2]], [v[1], v[3]]], { color: '#38bdf8', weight: 2, dashArray: '6 4', fillOpacity: 0.05 }).addTo(m);
    m.fitBounds(L.latLngBounds([[v[0], v[2]], [v[1], v[3]]]).extend(bahia.getBounds()), { padding: [12, 12] });
    const igual = Math.abs(v[0] - a.lat_min) < 0.01 && Math.abs(v[1] - a.lat_max) < 0.01 && Math.abs(v[2] - a.lon_min) < 0.01 && Math.abs(v[3] - a.lon_max) < 0.01;
    msg.textContent = igual
      ? 'Esta é a área processada nesta versão.'
      : 'Área marcada no mapa. Nesta primeira versão, o calendário mostra a Bahia; processar uma nova área usa os mesmos scripts e os mesmos dados da NASA.';
  });
}

function topDez() {
  const el = document.getElementById('lista-top');
  el.innerHTML = DADOS.top10_meses.map((t) => {
    const m = DADOS.meses.find((x) => x.mes === t.mes);
    const est = m.faixa_inferior ? ` <span class="est">(estimativa: ${fmt(m.faixa_inferior)} a ${fmt(m.faixa_superior)})</span>` : '';
    return `<li><strong>${MESES_LONGO[m.mes_num - 1]} de ${m.ano}</strong>: ${fmt(m.focos)} focos${est}</li>`;
  }).join('');
}

function metodo() {
  const me = DADOS.metodo;
  const f = me.fatores;
  const v = me.validacao;
  const comp = f ? f.comparacao_teste_2020_2023 : null;
  const anual = Object.entries(v.erro_total_anual_pct).map(([a, e]) => `${a}: ${pct(e)}`).join(' · ');
  const pesos = f ? f.pesos.map((p) => {
    const efeito = Math.round((p.multiplica_razao_por_1_desvio - 1) * 1000) / 10;
    const firme = !(p.ic95_peso && p.ic95_peso[0] < 0 && p.ic95_peso[1] > 0);
    return `<li><strong>${p.fator}</strong>: ${firme ? `${efeito > 0 ? '+' : ''}${efeito.toLocaleString('pt-BR')}% na razão VIIRS/MODIS a cada variação típica` : 'sem efeito firme depois dos outros fatores (intervalo de confiança cruza zero)'}</li>`;
  }).join('') : '';
  const descartados = f ? f.triagem.filter((t) => !t.mantido).map((t) => t.fator).join(', ') : '';
  document.getElementById('metodo-conteudo').innerHTML = `
    <p>Os satélites MODIS (2000 em diante) e VIIRS (2012 em diante) não se comparam direto: o VIIRS tem pixel de 375 m, contra 1 km do MODIS, e enxerga fogo menor. Na Bahia ele conta cerca de 6 vezes mais focos. Sem harmonizar, a série dá um salto falso em 2012.</p>
    <h3>O que fazemos</h3>
    <p>${me.como_funciona}</p>
    <ul>${me.filtros.map((x) => `<li>${x}</li>`).join('')}</ul>
    <h3>Quão bem funciona</h3>
    <p>${v.desenho}.</p>
    <div class="metricas">
      <div><strong>${v.erro_mensal_wape_pct.toLocaleString('pt-BR')}%</strong><span>erro por mês (WAPE)</span></div>
      <div><strong>${v.acerto_acima_abaixo_do_normal_pct.toLocaleString('pt-BR')}%</strong><span>meses certos acima ou abaixo do normal</span></div>
      <div><strong>${pct(v.vies_pct)}</strong><span>viés no total</span></div>
      ${f ? `<div><strong>${f.cobertura_faixa_95}</strong><span>meses de teste dentro da faixa de 95%</span></div>` : ''}
    </div>
    <p class="nota">Erro no total de cada ano de teste: ${anual}.</p>
    ${f ? `
    <h3>Por que a relação entre os satélites muda</h3>
    <p>${f.o_que_e}</p>
    <ul>${pesos}</ul>
    <p class="nota">Testados e descartados por não mudarem a relação: ${descartados}. Comparação no teste: taxa por mês ${comp.T1.erro_mensal_pct.toLocaleString('pt-BR')}% de erro, modelo com fatores ${comp.modelo_v2.erro_mensal_pct.toLocaleString('pt-BR')}%. O número principal usa a taxa por mês, que errou menos.</p>
    <h3>O que descobrimos antes de 2012</h3>
    <p>${f.descoberta}</p>
    <p class="nota">Média anual de 2003 a 2011, em focos equivalentes VIIRS: ${fmt(f.media_anual_2003_2011.t1_terra)} pelo Terra, ${fmt(f.media_anual_2003_2011.fatores_aqua)} pelo modelo com fatores e ${fmt(f.media_anual_2003_2011.t1_aqua)} pela taxa por mês do Aqua. VIIRS real de 2012 a 2021: ${fmt(f.viirs_real_media_anual_2012_2021)} por ano.</p>` : ''}
    <h3>Limitações</h3>
    <ul>${me.limitacoes.map((x) => `<li>${x}</li>`).join('')}</ul>`;
}

function rodape() {
  document.getElementById('fonte').textContent = 'Fonte: ' + DADOS.fonte + '. Clima e altitude: NASA POWER. Unidade: ' + DADOS.unidade + '.';
  document.getElementById('citacao').textContent = DADOS.citacao;
}

function ligarControles() {
  document.querySelectorAll('.alternar button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.alternar button').forEach((x) => { x.classList.remove('ativo'); x.setAttribute('aria-pressed', 'false'); });
    b.classList.add('ativo');
    b.setAttribute('aria-pressed', 'true');
    estado.modo = b.dataset.modo;
    calendario(estado.modo);
  }));
  const caixa = document.getElementById('mostrar-brutos');
  caixa.addEventListener('change', (e) => { estado.brutos = e.target.checked; serie(estado.brutos); });
  document.getElementById('sel-mes').addEventListener('change', (e) => { estado.mes = Number(e.target.value); mesAoLongoDosAnos(estado.mes); });
  document.getElementById('cta-salto').addEventListener('click', () => {
    caixa.checked = true;
    estado.brutos = true;
    serie(true);
    document.getElementById('por-ano').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('botao-tema').addEventListener('click', () => {
    const novo = temaAtual() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', novo);
    try { localStorage.setItem('tema', novo); } catch (e) { /* sem armazenamento */ }
    desenharTudo();
  });
}

iniciar().catch((e) => {
  document.getElementById('cartoes').innerHTML = '<p>Não foi possível carregar os dados. Abra a página por um servidor (veja o README).</p>';
  console.error(e);
});
