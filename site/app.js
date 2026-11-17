/* Régua de Fogo: lê os dados harmonizados e desenha o painel e as janelas.
   Sem build: HTML, CSS e este arquivo. Bibliotecas: ECharts (gráficos) e Leaflet (mapa).
   Dados: data/calendario_bahia.json (série oficial da Bahia) e data/celulas_bahia.json (série por célula,
   para somar só a área em volta de um ponto). Últimos 7 dias: função api/recentes. */

const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MESES_LONGO = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// rótulos em inglês para os valores internos dos dados (que continuam em português)
const CLASSE_EN = { 'acima do normal': 'above normal', 'abaixo do normal': 'below normal', normal: 'normal' };
const ORIGEM_EN = { VIIRS: 'VIIRS', 'MODIS convertido': 'converted MODIS', 'VIIRS NOAA-20 ajustado': 'adjusted VIIRS NOAA-20' };
const rotuloClasse = (c) => CLASSE_EN[c] || c;
const rotuloOrigem = (o) => ORIGEM_EN[o] || o;
// paleta "inferno": lembra fogo, é perceptualmente uniforme e funciona para daltônicos
const INFERNO = ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4'];
// divergente azul e laranja (PuOr), seguro para daltônicos
const DIVERGENTE = ['#2d6fae', '#6fa3d2', '#b9d3ea', '#f2f0ee', '#f6c68f', '#e08a2c', '#b35806'];
// meia célula da grade NASA POWER, em graus
const MEIA_LAT = 0.25;
const MEIA_LON = 0.3125;

const HOJE = new Date();
const MES_ATUAL = HOJE.getMonth() + 1;
const ANO_ATUAL = HOJE.getFullYear();
const ULTIMO_ANO_NORMAL = 2025;  // o normal usa os anos medidos pelo VIIRS de 2012 a 2025, como a série da Bahia

const fmt = (n) => (n === null || n === undefined) ? 'no data' : Math.round(n).toLocaleString('en-US');
const pct = (n) => (n > 0 ? '+' : '') + n.toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
const milhar = (v) => (v >= 1000 ? Math.round(v / 1000) + 'k' : v);
const css = (nome) => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();

let OFICIAL = null;     // série oficial da Bahia
let CELULAS = null;     // série por célula (carregada sob demanda)
let DADOS = null;       // série da área ativa, no mesmo formato da oficial
let METODOS = null;     // comparação dos métodos (carregada sob demanda)
let INPE = null;        // comparação com o INPE (carregada sob demanda)
let RELATADOS = null;   // incêndios relatados pelo IBAMA (carregados sob demanda)
let REPLICACAO = null;  // o método em outras regiões (carregado sob demanda)
let CONFERENCIA = null; // conferência dos arquivos com a API do FIRMS (carregada sob demanda)
const desenho = { ativo: false, pontos: [] };  // área desenhada no mapa
const focosMapa = { modo: '', dados: null, pedido: 0 };  // pontos de foco desenhados no mapa
const graficos = {};
const estado = {
  modo: 'focos', brutos: false, mes: MES_ATUAL,
  area: { tipo: 'bahia' },  // ou { tipo: 'ponto', lat, lon, raio, origem: 'local' | 'mapa' | 'coordenada' }
  anoIni: null, anoFim: null,
};
let mapaL = null;
const camadas = {};

// ------------------------------------------------------------------ início

async function iniciar() {
  aplicarTemaSalvo();
  OFICIAL = await (await fetch('data/calendario_bahia.json')).json();
  DADOS = OFICIAL;
  document.getElementById('periodo-ini').textContent = OFICIAL.periodo.inicio.slice(0, 4);
  document.getElementById('periodo-fim').textContent = OFICIAL.periodo.fim.slice(0, 4);
  montarSeletorMes();
  metodo();
  rodape();
  atualizarTudo();
  ligarControles();
  montarSeletorPeriodo();
  const hash = location.hash.replace('#', '');
  if (document.getElementById('janela-' + hash)) abrirJanela(hash);
  window.addEventListener('resize', () => Object.values(graficos).forEach((g) => g.resize()));
}

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

// ------------------------------------------------------------------ área

function nomeArea() {
  const a = estado.area;
  if (a.tipo === 'bahia') return 'Bahia';
  if (a.tipo === 'poligono') return 'Drawn area';
  const rotulo = { local: 'Near you', mapa: 'Chosen point', coordenada: 'Chosen coordinate' }[a.origem] || 'Chosen point';
  return rotulo + ` (${a.raio} km)`;
}

function distanciaKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

async function carregarCelulas() {
  if (!CELULAS) {
    const r = await fetch('data/celulas_bahia.json');
    if (!r.ok) throw new Error('celulas ' + r.status);
    CELULAS = await r.json();
  }
  return CELULAS;
}

function dentroDaBahia(lat, lon) {
  const a = OFICIAL.area;
  return lat > a.lat_min && lat < a.lat_max && lon > a.lon_min && lon < a.lon_max;
}

// Erro medido no teste de 2020-2023 para a escala mais parecida com a área (Scripts/harmonizacao/erro_por_area.py).
const TAMANHO_AREA = { celula: 'one grid cell (about 55 x 68 km)', bloco_2x2: 'areas of about 110 x 135 km', bloco_4x4: 'areas of about 220 x 270 km' };
function erroDaArea(nCelulas) {
  const escalas = (OFICIAL.metodo.validacao.erro_por_area || []).filter((e) => e.escala !== 'bahia');
  if (!escalas.length || !nCelulas) return null;
  const dist = (e) => Math.abs(Math.log(e.celulas_por_area / nCelulas));
  return escalas.reduce((m, e) => (dist(e) < dist(m) ? e : m));
}
function erroEscala(chave) {
  const e = (OFICIAL.metodo.validacao.erro_por_area || []).find((x) => x.escala === chave);
  return e ? e.erro_mensal_wape_pct : null;
}

function quantil(v, q) {
  const s = [...v].sort((a, b) => a - b);
  const k = (s.length - 1) * q;
  const b = Math.floor(k);
  return b + 1 < s.length ? s[b] + (s[b + 1] - s[b]) * (k - b) : s[b];
}

// Monta a série de um conjunto de células no mesmo formato da série oficial.
function montarDadosArea(cels) {
  const meses = CELULAS.meses;
  const nPre = CELULAS.n_pre;
  const serie = meses.map((m, i) => {
    const focos = cels.reduce((s, c) => s + c.f[i], 0);
    const pre = i < nPre;
    const of = OFICIAL.meses[i];
    return {
      mes: m, ano: Number(m.slice(0, 4)), mes_num: Number(m.slice(5, 7)), focos,
      origem: of.origem, qualidade: of.qualidade,
      faixa_inferior: pre ? cels.reduce((s, c) => s + c.i[i], 0) : null,
      faixa_superior: pre ? cels.reduce((s, c) => s + c.s[i], 0) : null,
      modis_bruto: pre ? cels.reduce((s, c) => s + c.a[i], 0) : null,
      viirs_real: pre ? null : focos,
    };
  });
  const normal = { mediana: {}, media: {}, p25: {}, p75: {} };
  // normal de cada mês só com os anos medidos pelo VIIRS (2012-02 a 2025), como na série da Bahia
  for (let k = 1; k <= 12; k++) {
    const v = serie.filter((s, i) => s.mes_num === k && i >= nPre && s.ano <= ULTIMO_ANO_NORMAL).map((s) => s.focos);
    const c = String(k).padStart(2, '0');
    normal.mediana[c] = Math.max(1, Math.round(quantil(v, 0.5)));
    normal.p25[c] = Math.round(quantil(v, 0.25));
    normal.p75[c] = Math.round(quantil(v, 0.75));
    normal.media[c] = Math.round(v.reduce((a, b) => a + b, 0) / v.length);
  }
  serie.forEach((s) => {
    const c = String(s.mes_num).padStart(2, '0');
    s.anomalia_pct = Math.round(1000 * (s.focos - normal.mediana[c]) / normal.mediana[c]) / 10;
    s.classe = s.focos > normal.p75[c] ? 'acima do normal' : (s.focos < normal.p25[c] ? 'abaixo do normal' : 'normal');
    s.posicao_no_mes = 1 + serie.filter((x) => x.mes_num === s.mes_num && x.focos > s.focos).length;
  });
  const anos = [...new Set(serie.map((s) => s.ano))];
  const totais = anos.map((ano) => {
    const ms = serie.filter((s) => s.ano === ano);
    const comFaixa = ms.some((s) => s.faixa_inferior !== null);
    const pico = ms.reduce((a, b) => (b.focos > a.focos ? b : a));
    return {
      ano, focos: ms.reduce((a, s) => a + s.focos, 0), meses: ms.length, mes_pico: pico.mes,
      faixa_inferior: comFaixa ? ms.reduce((a, s) => a + (s.faixa_inferior !== null ? s.faixa_inferior : s.focos), 0) : null,
      faixa_superior: comFaixa ? ms.reduce((a, s) => a + (s.faixa_superior !== null ? s.faixa_superior : s.focos), 0) : null,
    };
  });
  const lats = cels.map((c) => c.lat);
  const lons = cels.map((c) => c.lon);
  return {
    ...OFICIAL,
    area: {
      nome: nomeArea(), descricao: `${cels.length} NASA POWER grid cells`,
      lat_min: Math.min(...lats) - MEIA_LAT, lat_max: Math.max(...lats) + MEIA_LAT,
      lon_min: Math.min(...lons) - MEIA_LON, lon_max: Math.max(...lons) + MEIA_LON,
    },
    meses: serie, normal_por_mes: normal, totais_por_ano: totais,
    top10_meses: [...serie].sort((a, b) => b.focos - a.focos).slice(0, 10).map((s) => ({ mes: s.mes, focos: s.focos, origem: s.origem })),
    n_celulas: cels.length,
    celulas_ids: cels.map((c) => c.id),
  };
}

// Ponto dentro do polígono (raio cruzando as arestas), com x = longitude e y = latitude.
function pontoNoPoligono(lat, lon, pts) {
  let dentro = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, xi] = pts[i];
    const [yj, xj] = pts[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function celulasDaArea(nova) {
  if (nova.tipo === 'ponto') {
    if (!dentroDaBahia(nova.lat, nova.lon)) return { cels: [] };
    return { cels: CELULAS.celulas.filter((c) => distanciaKm(nova.lat, nova.lon, c.lat, c.lon) <= nova.raio) };
  }
  const cels = CELULAS.celulas.filter((c) => pontoNoPoligono(c.lat, c.lon, nova.pontos));
  if (cels.length) return { cels };
  // área menor que uma célula: usa a célula mais próxima do centro do desenho, se ela estiver perto
  const cLat = nova.pontos.reduce((t, p) => t + p[0], 0) / nova.pontos.length;
  const cLon = nova.pontos.reduce((t, p) => t + p[1], 0) / nova.pontos.length;
  let melhor = null;
  let dMelhor = Infinity;
  CELULAS.celulas.forEach((c) => {
    const d = distanciaKm(cLat, cLon, c.lat, c.lon);
    if (d < dMelhor) { dMelhor = d; melhor = c; }
  });
  return dMelhor <= 45 ? { cels: [melhor], pequena: true } : { cels: [] };
}

async function definirArea(nova, mensagem) {
  const aviso = document.getElementById('aviso-area');
  const msgJanela = document.getElementById('msg-area');
  if (desenho.ativo) encerrarDesenho();
  if (nova.tipo === 'ponto' || nova.tipo === 'poligono') {
    try {
      await carregarCelulas();
    } catch (e) {
      msgJanela.textContent = 'Could not load the grid cells. Reload the page and try again.';
      aviso.textContent = 'Could not load the grid cells. Reload the page and try again.';
      return;
    }
    const { cels, pequena } = celulasDaArea(nova);
    if (cels.length === 0) {
      estado.area = { tipo: 'bahia' };
      DADOS = OFICIAL;
      const txt = (nova.tipo === 'poligono' ? 'This area is' : 'This point is') + ' outside the area processed in this version (Bahia). Showing the whole of Bahia.';
      aviso.textContent = nova.origem === 'local'
        ? 'You are outside the area processed in this version (Bahia). Showing the whole of Bahia; you can choose a point with the area chip at the top.'
        : txt;
      msgJanela.textContent = txt;
      atualizarTudo();
      return;
    }
    estado.area = nova;
    estado.nCelulas = cels.length;
    DADOS = montarDadosArea(cels);
    const eaAviso = erroDaArea(cels.length);
    const mediaAnual = DADOS.totais_por_ano.reduce((t, x) => t + x.focos, 0) / DADOS.totais_por_ano.length;
    const extra = (pequena ? ' The drawn area is smaller than one grid cell, so the nearest cell is used (about 55 x 68 km).' : '')
      + (eaAviso ? ` Before 2012 the conversion uses the rates of the whole of Bahia: in the 2020 to 2023 test, the monthly error for ${TAMANHO_AREA[eaAviso.escala]} was about ${Math.round(eaAviso.erro_mensal_wape_pct)}%.` : '')
      + (mediaAnual < 3000 ? ' Area with few hotspots: the numbers vary more.' : '');
    aviso.textContent = (mensagem || `Showing ${nomeArea().toLowerCase()}: ${cels.length} grid cells (about 55 x 68 km each).`) + extra;
    msgJanela.textContent = `${cels.length} grid ${cels.length === 1 ? 'cell' : 'cells'} ${nova.tipo === 'poligono' ? 'inside the outline' : 'inside the radius'} (blue on the map).` + extra;
  } else {
    estado.area = { tipo: 'bahia' };
    DADOS = OFICIAL;
    aviso.textContent = mensagem || '';
    msgJanela.textContent = 'Showing the whole of Bahia.';
  }
  atualizarTudo();
}

function pedirLocalizacao(aoFalhar) {
  navigator.geolocation.getCurrentPosition(
    (pos) => definirArea({ tipo: 'ponto', lat: pos.coords.latitude, lon: pos.coords.longitude, raio: Number(document.getElementById('raio').value), origem: 'local' }),
    aoFalhar,
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
  );
}

function usarMinhaLocalizacao() {
  const msg = document.getElementById('msg-area');
  if (!('geolocation' in navigator)) { msg.textContent = 'This browser does not provide a location.'; return; }
  msg.textContent = 'Getting your location...';
  pedirLocalizacao(() => { msg.textContent = 'Could not use your location (permission denied or unavailable). Tap the map to choose a point.'; });
}

function atualizarTextosArea() {
  const nome = nomeArea();
  document.querySelectorAll('.nome-area').forEach((el) => { el.textContent = nome; });
  document.getElementById('titulo-area').textContent = estado.area.tipo === 'bahia'
    ? 'Bahia'
    : (estado.area.tipo === 'poligono' ? 'this area' : (estado.area.origem === 'local' ? 'your area' : 'this place'));
}

function atualizarTudo() {
  atualizarTextosArea();
  if (estado.anoIni !== null) montarSeletorPeriodo();
  heroGrafico();
  agora();
  cartoes();
  if (mapaL) desenharAreaNoMapa();
  contagemFocos();
  const aberta = document.querySelector('dialog.janela[open]');
  if (aberta) desenharJanela(aberta.id.replace('janela-', ''));
}

// ------------------------------------------------------------------ janelas

function abrirJanela(nome) {
  const d = document.getElementById('janela-' + nome);
  if (!d) return;
  document.querySelectorAll('dialog.janela[open]').forEach((x) => { if (x !== d) x.close(); });
  if (!d.open) d.showModal();
  history.replaceState(null, '', '#' + nome);
  requestAnimationFrame(() => desenharJanela(nome));
}

function desenharJanela(nome) {
  if (nome === 'calendario') calendario(estado.modo);
  else if (nome === 'por-ano') serie(estado.brutos);
  else if (nome === 'por-mes') mesAoLongoDosAnos(estado.mes);
  else if (nome === 'top') topDez();
  else if (nome === 'area') abrirMapa();
  else if (nome === 'metodos') comparacaoMetodos();
  else if (nome === 'inpe') comparacaoInpe();
  else if (nome === 'relatados') detectadosRelatados();
  else if (nome === 'metodologia') metodologia();
  Object.values(graficos).forEach((g) => g.resize());
}

// ------------------------------------------------------------------ hero e cartões

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

function classeTag(classe) {
  if (classe === 'acima do normal') return 'acima';
  if (classe === 'abaixo do normal') return 'abaixo';
  return 'normal';
}

function heroGrafico() {
  const el = document.getElementById('graf-hero');
  const g = graficos.hero || echarts.init(el);
  graficos.hero = g;
  const med = DADOS.normal_por_mes.mediana;
  const vals = MESES.map((_, i) => med[String(i + 1).padStart(2, '0')]);
  const lmin = Math.log10(Math.max(1, Math.min(...vals)));
  const lmax = Math.log10(Math.max(...vals));
  const total = vals.reduce((s, v) => s + v, 0);
  const top2 = vals.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 2).map((x) => x[1]).sort((a, b) => a - b);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  document.getElementById('hero-meses').textContent = cap(MESES_LONGO[top2[0]]) + ' and ' + MESES_LONGO[top2[1]];
  document.getElementById('hero-pct').textContent = Math.round((vals[top2[0]] + vals[top2[1]]) / total * 100) + '%';
  g.setOption({
    animationDuration: 700,
    grid: { left: 8, right: 8, top: 18, bottom: 22 },
    tooltip: { trigger: 'item', confine: true, formatter: (p) => `<strong>${MESES_LONGO[p.dataIndex]}</strong><br>median of ${fmt(p.value)} hotspots<br><span style="opacity:.75">click to see the month across the years</span>` },
    xAxis: { type: 'category', data: MESES.map((m) => m.charAt(0).toUpperCase()), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: css('--texto-suave'), fontSize: 11 } },
    yAxis: { type: 'value', show: false },
    series: [{
      type: 'bar', barWidth: '62%',
      data: vals.map((v, i) => ({
        value: v,
        itemStyle: {
          color: corInferno(0.18 + 0.8 * (Math.log10(Math.max(1, v)) - lmin) / Math.max(0.001, lmax - lmin)),
          borderRadius: [6, 6, 2, 2],
          borderColor: i + 1 === MES_ATUAL ? css('--texto') : 'transparent',
          borderWidth: i + 1 === MES_ATUAL ? 2 : 0,
        },
      })),
      emphasis: { itemStyle: { shadowBlur: 12, shadowColor: 'rgba(255,140,40,.6)' } },
      label: { show: true, position: 'top', fontSize: 10, color: css('--texto-suave'), formatter: (p) => (p.dataIndex + 1 === MES_ATUAL ? 'now' : '') },
    }],
  }, true);
  g.off('click');
  g.on('click', (p) => {
    estado.mes = p.dataIndex + 1;
    document.getElementById('sel-mes').value = String(estado.mes);
    abrirJanela('por-mes');
  });
}

let pedidoAgora = 0;
async function agora() {
  const meuPedido = ++pedidoAgora;
  const chave = String(MES_ATUAL).padStart(2, '0');
  const nm = DADOS.normal_por_mes;
  const diasNoMes = new Date(ANO_ATUAL, MES_ATUAL, 0).getDate();
  const porDia = (v) => v / diasNoMes;
  const nomeMes = MESES_LONGO[MES_ATUAL - 1];
  const tag = document.getElementById('agora-tag');
  document.getElementById('agora-titulo').textContent = `Now: ${nomeMes} ${ANO_ATUAL}`;
  document.getElementById('agora-normal').textContent =
    `${nomeMes} normal: ${fmt(porDia(nm.mediana[chave]))} hotspots per day (median of the years measured by VIIRS, 2012 to 2025; normal range ${fmt(porDia(nm.p25[chave]))} to ${fmt(porDia(nm.p75[chave]))}${nm.media ? `; mean ${fmt(porDia(nm.media[chave]))}` : ''}). Expected for the whole month: about ${fmt(nm.mediana[chave])} hotspots.`;
  try {
    let url = 'api/recentes';
    if (estado.area.tipo !== 'bahia') url += '?celulas=' + DADOS.celulas_ids.join(',');
    const r = await fetch(url);
    if (!r.ok) throw new Error('sem dados');
    const j = await r.json();
    if (meuPedido !== pedidoAgora) return;
    const dias = j.dias || [];
    if (!dias.length) throw new Error('sem dias');
    const media = dias.reduce((s, d) => s + d.focos_equivalentes, 0) / dias.length;
    const lo = porDia(nm.p25[chave]);
    const hi = porDia(nm.p75[chave]);
    const med = porDia(nm.mediana[chave]);
    const classe = media > hi ? 'acima do normal' : (media < lo ? 'abaixo do normal' : 'normal');
    document.getElementById('agora-valor').textContent = fmt(media);
    document.getElementById('agora-unidade').textContent = 'hotspots per day';
    tag.textContent = rotuloClasse(classe);
    tag.className = 'tag ' + classeTag(classe);
    document.getElementById('agora-comparacao').textContent = `${pct(Math.round((media - med) / med * 1000) / 10)} compared with the ${nomeMes} median`;
    const dm = (d) => MESES[Number(d.data.slice(5, 7)) - 1] + ' ' + Number(d.data.slice(8, 10));
    const atual = j.atualizado_em ? new Date(j.atualizado_em).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    document.getElementById('agora-fonte').textContent = `Mean of the last ${dias.length} complete days (${dm(dias[0])} to ${dm(dias[dias.length - 1])}) against the ${nomeMes} normal. Source: NASA FIRMS, VIIRS NOAA-20 near real time, converted to the historical ruler${atual ? '; file from ' + atual : ''}. Provisional data; the calendar series runs to ${MESES_LONGO[Number(OFICIAL.periodo.fim.slice(5, 7)) - 1]} ${OFICIAL.periodo.fim.slice(0, 4)}.`;
  } catch (e) {
    if (meuPedido !== pedidoAgora) return;
    document.getElementById('agora-valor').textContent = fmt(porDia(nm.mediana[chave]));
    document.getElementById('agora-unidade').textContent = 'hotspots per day in a typical ' + nomeMes;
    tag.textContent = 'expected';
    tag.className = 'tag normal';
    document.getElementById('agora-comparacao').textContent = 'The data for the last days did not load right now.';
    document.getElementById('agora-fonte').textContent = '';
  }
}

function cartoes() {
  const meses = DADOS.meses;
  const ultimo = meses[meses.length - 1];
  const nMesmoMes = meses.filter((m) => m.mes_num === ultimo.mes_num).length;
  // anos completos: um ano em andamento (como 2026) não entra nas comparações de total anual
  const anos = DADOS.totais_por_ano.filter((a) => a.meses === 12);
  const pico = anos.reduce((a, b) => (b.focos > a.focos ? b : a));
  const ultimoAno = anos[anos.length - 1];
  const anosViirs = anos.filter((a) => a.ano >= 2013 && a.ano < ultimoAno.ano);
  const mediaViirs = anosViirs.reduce((s, a) => s + a.focos, 0) / anosViirs.length;
  const difAno = (ultimoAno.focos - mediaViirs) / mediaViirs * 100;
  const val = OFICIAL.metodo.validacao;
  const ea = estado.area.tipo === 'bahia' ? null : erroDaArea(estado.nCelulas);
  document.getElementById('cartoes').innerHTML = [
    `<article class="cartao principal">
      <p class="rotulo">Last month in the series: ${MESES_LONGO[ultimo.mes_num - 1]} ${ultimo.ano}${ultimo.qualidade === 'provisorio' ? ' (provisional)' : ''}</p>
      <p class="valor">${fmt(ultimo.focos)} hotspots</p>
      <p class="detalhe"><span class="tag ${classeTag(ultimo.classe)}">${rotuloClasse(ultimo.classe)}</span> ${pct(ultimo.anomalia_pct)} vs the ${MESES_LONGO[ultimo.mes_num - 1]} median; #${ultimo.posicao_no_mes} of ${nMesmoMes} since 2003.</p>
    </article>`,
    `<article class="cartao">
      <p class="rotulo">Year with the most fire</p>
      <p class="valor">${pico.ano}</p>
      <p class="detalhe">${fmt(pico.focos)} hotspots${pico.faixa_inferior ? ` (estimate, between ${fmt(pico.faixa_inferior)} and ${fmt(pico.faixa_superior)})` : ''}. Peak in ${MESES_LONGO[Number(pico.mes_pico.slice(5, 7)) - 1]}.</p>
    </article>`,
    `<article class="cartao">
      <p class="rotulo">${ultimoAno.ano} vs 2013 to ${ultimoAno.ano - 1}</p>
      <p class="valor">${pct(Math.round(difAno * 10) / 10)}</p>
      <p class="detalhe">${fmt(ultimoAno.focos)} hotspots in the year, against a mean of ${fmt(mediaViirs)}.</p>
    </article>`,
    estado.area.tipo === 'bahia'
      ? `<article class="cartao">
      <p class="rotulo">Conversion accuracy</p>
      <p class="valor">${val.erro_mensal_wape_pct.toLocaleString('en-US')}%</p>
      <p class="detalhe">monthly error in years the model never saw (2020 to 2023), with a total bias of ${pct(val.vies_pct)}.</p>
    </article>`
      : `<article class="cartao">
      <p class="rotulo">Accuracy at this scale</p>
      <p class="valor">${ea ? `about ${Math.round(ea.erro_mensal_wape_pct)}%` : 'lower'}</p>
      <p class="detalhe">${ea ? `monthly error measured in 2020 to 2023 for ${TAMANHO_AREA[ea.escala]}` : 'smaller areas have larger errors'}; the best reference for the converted years before 2012. For the whole of Bahia the error is ${val.erro_mensal_wape_pct.toLocaleString('en-US')}%. From 2012 on the area uses measured VIIRS.</p>
    </article>`,
  ].join('');
}

// ------------------------------------------------------------------ gráficos das janelas

function tooltipMes(m) {
  let t = `<strong>${MESES_LONGO[m.mes_num - 1]} ${m.ano}</strong><br>`;
  if (m.faixa_inferior !== null && m.faixa_inferior !== undefined) {
    t += `${fmt(m.focos)} hotspots (estimate)<br>range: ${fmt(m.faixa_inferior)} to ${fmt(m.faixa_superior)}<br>`;
  } else {
    t += `${fmt(m.focos)} hotspots<br>`;
  }
  t += `${pct(m.anomalia_pct)} vs the month median (${rotuloClasse(m.classe)})<br>`;
  const media = DADOS.normal_por_mes.media && DADOS.normal_por_mes.media[String(m.mes_num).padStart(2, '0')];
  if (media) t += `${pct(Math.round((m.focos - media) / media * 1000) / 10)} vs the mean of the years measured by VIIRS<br>`;
  t += `#${m.posicao_no_mes} ${MESES_LONGO[m.mes_num - 1]} with the most fire since 2003<br>`;
  t += `<span style="opacity:.75">source: ${rotuloOrigem(m.origem)}${m.qualidade === 'corrigido' ? ', corrected month' : ''}${m.qualidade === 'provisorio' ? ', provisional data (near real time)' : ''}</span>`;
  return t;
}

function calendario(modo) {
  const el = document.getElementById('graf-calendario');
  const g = graficos.cal || echarts.init(el);
  graficos.cal = g;
  const meses = noPeriodo(DADOS.meses);
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
      itemStyle: estimado
        ? { borderColor: 'rgba(56,189,248,.55)', borderWidth: 1, borderType: 'dashed' }
        : { borderColor: css('--superficie'), borderWidth: 1 },
    };
  });
  const vals = meses.map((m) => Math.log10(Math.max(m.focos, 1)));
  const visual = modo === 'focos'
    ? { min: Math.floor(Math.min(...vals) * 10) / 10, max: Math.ceil(Math.max(...vals) * 10) / 10, inRange: { color: INFERNO }, formatter: (v) => fmt(Math.pow(10, v)), text: ['more hotspots', 'fewer hotspots'] }
    : { min: -2, max: 2, inRange: { color: DIVERGENTE }, formatter: (v) => (v >= 0 ? '+' : '') + Math.round((Math.pow(2, v) - 1) * 100) + '%', text: ['above normal', 'below normal'] };
  g.setOption({
    animation: false,
    grid: { left: 52, right: 16, top: 8, bottom: 72 },
    tooltip: { formatter: (p) => tooltipMes(p.data.mes), confine: true },
    xAxis: { type: 'category', data: MESES, axisLabel: { color: css('--texto-suave') }, axisLine: { show: false }, axisTick: { show: false }, position: 'top' },
    yAxis: { type: 'category', data: anos, inverse: true, axisLabel: { color: css('--texto-suave') }, axisLine: { show: false }, axisTick: { show: false } },
    visualMap: { type: 'continuous', dimension: 2, orient: 'horizontal', left: 'center', bottom: 6, itemWidth: 14, itemHeight: 220, calculable: false, textStyle: { color: css('--texto-suave') }, ...visual },
    series: [{ type: 'heatmap', data: dados, emphasis: { itemStyle: { borderColor: css('--texto'), borderWidth: 2 } } }],
  }, true);
}

function serie(brutos) {
  const el = document.getElementById('graf-serie');
  const g = graficos.serie || echarts.init(el);
  graficos.serie = g;
  // só anos completos: o ano em andamento fica no calendário até fechar
  const anos = noPeriodo(DADOS.totais_por_ano).filter((a) => a.meses === 12);
  const series = [
    { name: 'faixa_base', type: 'line', data: anos.map((a) => (a.faixa_inferior ? a.faixa_inferior : null)), stack: 'faixa', symbol: 'none', lineStyle: { opacity: 0 }, tooltip: { show: false }, silent: true },
    { name: 'Range (2003 to 2011)', type: 'line', data: anos.map((a) => (a.faixa_inferior ? a.faixa_superior - a.faixa_inferior : null)), stack: 'faixa', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(56,189,248,.25)' }, tooltip: { show: false }, silent: true },
    { name: 'Harmonized hotspots', type: 'line', data: anos.map((a) => a.focos), symbolSize: 6, lineStyle: { width: 3, color: css('--destaque') }, itemStyle: { color: css('--destaque') } },
  ];
  if (brutos) {
    // série "ingênua": o que se vê juntando os dados sem harmonizar (MODIS até 2011, VIIRS de 2012 em diante)
    const ingenua = anos.map((a) => DADOS.meses.filter((m) => m.ano === a.ano)
      .reduce((s, m) => s + (m.viirs_real !== null && m.viirs_real !== undefined ? m.viirs_real : (m.modis_bruto || 0)), 0));
    series.push({ name: 'Not harmonized (MODIS to 2011, VIIRS after)', type: 'line', data: ingenua, symbolSize: 5, lineStyle: { type: 'dashed', width: 2, color: '#94a3b8' }, itemStyle: { color: '#94a3b8' } });
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
        ps.filter((p) => p.seriesName !== 'faixa_base' && p.seriesName !== 'Range (2003 to 2011)' && p.value !== null && p.value !== undefined)
          .forEach((p) => { t += `${p.marker}${p.seriesName}: ${fmt(p.value)}<br>`; });
        if (ano.faixa_inferior) t += `range: ${fmt(ano.faixa_inferior)} to ${fmt(ano.faixa_superior)}`;
        return t;
      },
    },
    xAxis: { type: 'category', data: anos.map((a) => String(a.ano)), axisLabel: { color: css('--texto-suave') } },
    yAxis: { type: 'value', axisLabel: { color: css('--texto-suave'), formatter: milhar }, splitLine: { lineStyle: { color: css('--borda') } } },
    series,
  }, true);
  document.getElementById('nota-brutos').hidden = !brutos;
}

function montarSeletorMes() {
  document.getElementById('sel-mes').innerHTML = MESES_LONGO
    .map((m, i) => `<option value="${i + 1}" ${i + 1 === estado.mes ? 'selected' : ''}>${m}</option>`).join('');
}

function mesAoLongoDosAnos(numMes) {
  const el = document.getElementById('graf-mes');
  const g = graficos.mes || echarts.init(el);
  graficos.mes = g;
  const chave = String(numMes).padStart(2, '0');
  const normal = DADOS.normal_por_mes;
  const ms = noPeriodo(DADOS.meses).filter((m) => m.mes_num === numMes);
  const cor = (m) => (m.classe === 'acima do normal' ? css('--acima') : m.classe === 'abaixo do normal' ? css('--abaixo') : '#9ca3af');
  g.setOption({
    animation: false,
    grid: { left: 64, right: 16, top: 16, bottom: 32 },
    tooltip: { confine: true, formatter: (p) => tooltipMes(ms[p.dataIndex]) },
    xAxis: { type: 'category', data: ms.map((m) => String(m.ano)), axisLabel: { color: css('--texto-suave') } },
    yAxis: { type: 'value', axisLabel: { color: css('--texto-suave'), formatter: milhar }, splitLine: { lineStyle: { color: css('--borda') } } },
    series: [{
      type: 'bar',
      data: ms.map((m) => ({ value: m.focos, itemStyle: { color: cor(m), decal: m.faixa_inferior ? { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: Math.PI / 4, color: 'rgba(255,255,255,.35)' } : undefined } })),
      markArea: { silent: true, itemStyle: { color: 'rgba(148,163,184,.18)' }, data: [[{ yAxis: normal.p25[chave] }, { yAxis: normal.p75[chave] }]] },
      markLine: {
        silent: true, symbol: 'none',
        data: [
          { yAxis: normal.mediana[chave], lineStyle: { color: css('--texto'), type: 'dashed' }, label: { position: 'insideEndTop', formatter: 'median ' + fmt(normal.mediana[chave]), color: css('--texto-suave') } },
          ...(normal.media ? [{ yAxis: normal.media[chave], lineStyle: { color: css('--destaque'), type: 'dotted', width: 2 }, label: { position: 'insideStartTop', formatter: 'mean ' + fmt(normal.media[chave]), color: css('--destaque') } }] : []),
        ],
      },
    }],
  }, true);
}

function topDez() {
  document.getElementById('lista-top').innerHTML = DADOS.top10_meses.map((t) => {
    const m = DADOS.meses.find((x) => x.mes === t.mes);
    const est = m.faixa_inferior ? ` <span class="est">(estimate: ${fmt(m.faixa_inferior)} to ${fmt(m.faixa_superior)})</span>` : '';
    return `<li><strong>${MESES_LONGO[m.mes_num - 1]} ${m.ano}</strong>: ${fmt(m.focos)} hotspots${est}</li>`;
  }).join('');
}

// ------------------------------------------------------------------ período e CSV

function noPeriodo(lista) {
  if (estado.anoIni === null) return lista;
  return lista.filter((x) => x.ano >= estado.anoIni && x.ano <= estado.anoFim);
}

function montarSeletorPeriodo() {
  const anos = [...new Set(OFICIAL.meses.map((m) => m.ano))];
  if (estado.anoIni === null) { estado.anoIni = anos[0]; estado.anoFim = anos[anos.length - 1]; }
  const opcoes = (sel) => anos.map((a) => `<option value="${a}" ${a === sel ? 'selected' : ''}>${a}</option>`).join('');
  document.querySelectorAll('.sel-ano-ini').forEach((s) => { s.innerHTML = opcoes(estado.anoIni); });
  document.querySelectorAll('.sel-ano-fim').forEach((s) => { s.innerHTML = opcoes(estado.anoFim); });
}

function mudarPeriodo(ini, fim) {
  estado.anoIni = Math.min(ini, fim);
  estado.anoFim = Math.max(ini, fim);
  montarSeletorPeriodo();
  const aberta = document.querySelector('dialog.janela[open]');
  if (aberta) desenharJanela(aberta.id.replace('janela-', ''));
}

function baixarCsvArea() {
  const linhas = [['month', 'harmonized_hotspots', 'range_low', 'range_high', 'source', 'anomaly_pct_vs_median', 'class', 'rank_within_month']];
  noPeriodo(DADOS.meses).forEach((m) => linhas.push([
    m.mes, m.focos, m.faixa_inferior ?? '', m.faixa_superior ?? '', rotuloOrigem(m.origem), m.anomalia_pct, rotuloClasse(m.classe), m.posicao_no_mes,
  ]));
  const texto = '\ufeff' + linhas.map((l) => l.map((c) => (/[,"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');
  const nome = 'regua-de-fogo_' + nomeArea().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    + `_${estado.anoIni}-${estado.anoFim}.csv`;
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ------------------------------------------------------------------ mapa

function abrirMapa() {
  if (!mapaL) {
    const a = OFICIAL.area;
    mapaL = L.map('mapa', { scrollWheelZoom: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: '&copy; OpenStreetMap contributors' }).addTo(mapaL);
    camadas.bahia = L.rectangle([[a.lat_min, a.lon_min], [a.lat_max, a.lon_max]], { color: '#d9480f', weight: 2, fillOpacity: 0.04, dashArray: '4 4' }).addTo(mapaL);
    camadas.bahia.bindTooltip('Area processed in this version: bounding rectangle of Bahia (includes parts of neighboring states)');
    mapaL.on('click', (e) => {
      if (desenho.ativo) {
        desenho.pontos.push([e.latlng.lat, e.latlng.lng]);
        atualizarDesenho();
        return;
      }
      definirArea({ tipo: 'ponto', lat: e.latlng.lat, lon: e.latlng.lng, raio: Number(document.getElementById('raio').value), origem: 'mapa' });
    });
  }
  setTimeout(() => { mapaL.invalidateSize(); desenharAreaNoMapa(); }, 60);
}

function desenharAreaNoMapa() {
  ['circulo', 'ponto', 'poligono', 'celulas'].forEach((k) => { if (camadas[k]) { mapaL.removeLayer(camadas[k]); camadas[k] = null; } });
  const a = estado.area;
  if (a.tipo !== 'bahia' && CELULAS && DADOS.celulas_ids) {
    // as células que o site está somando, para mostrar a resolução real da área
    const ids = new Set(DADOS.celulas_ids);
    camadas.celulas = L.layerGroup(CELULAS.celulas.filter((c) => ids.has(c.id)).map((c) => L.rectangle(
      [[c.lat - MEIA_LAT, c.lon - MEIA_LON], [c.lat + MEIA_LAT, c.lon + MEIA_LON]],
      { color: '#2d6fae', weight: 1, fillOpacity: 0.12, interactive: false },
    ))).addTo(mapaL);
  }
  if (a.tipo === 'ponto') {
    camadas.circulo = L.circle([a.lat, a.lon], { radius: a.raio * 1000, color: '#38bdf8', weight: 2, fillOpacity: 0.05 }).addTo(mapaL);
    camadas.ponto = L.circleMarker([a.lat, a.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#d9480f', fillOpacity: 1 }).addTo(mapaL);
    mapaL.fitBounds(camadas.circulo.getBounds(), { padding: [20, 20] });
  } else if (a.tipo === 'poligono') {
    camadas.poligono = L.polygon(a.pontos, { color: '#d9480f', weight: 2, fillOpacity: 0.06 }).addTo(mapaL);
    mapaL.fitBounds(camadas.celulas ? L.featureGroup([camadas.poligono, ...camadas.celulas.getLayers()]).getBounds() : camadas.poligono.getBounds(), { padding: [20, 20] });
  } else {
    mapaL.fitBounds(camadas.bahia.getBounds(), { padding: [12, 12] });
  }
}

// ------------------------------------------------------------------ focos no mapa

const CORES_IDADE = [['#d7191c', 'less than 24 h'], ['#fdae61', '1 to 3 days'], ['#ffd34d', '3 to 7 days']];
const COR_DIA = { modis: '#d7191c', viirs: '#f57c00' };

function celulaDoPonto(lat, lon) {
  const i = Math.round((lat + 18.5) / 0.5);
  const j = Math.round((lon + 46.875) / 0.625);
  return 'L' + String(i).padStart(2, '0') + 'C' + String(j).padStart(2, '0');
}

function dataBr(iso) { return MESES[Number(iso.slice(5, 7)) - 1] + ' ' + Number(iso.slice(8, 10)) + ', ' + iso.slice(0, 4); }

function idadeHoras(p) {
  const t = Date.parse(`${p[2]}T${p[3].slice(0, 2)}:${p[3].slice(2, 4)}:00Z`);
  return (Date.now() - t) / 3600000;
}

function corDoPonto(p) {
  if (focosMapa.modo === 'dia') return COR_DIA[focosMapa.dados.sat];
  const h = idadeHoras(p);
  return h < 24 ? CORES_IDADE[0][0] : (h < 72 ? CORES_IDADE[1][0] : CORES_IDADE[2][0]);
}

async function atualizarCamadaFocos() {
  const sel = document.getElementById('camada-focos').value;
  const msg = document.getElementById('msg-focos');
  const legenda = document.getElementById('legenda-focos');
  document.getElementById('escolha-dia').hidden = sel !== 'dia';
  focosMapa.modo = sel;
  const meuPedido = ++focosMapa.pedido;
  if (camadas.focos) { mapaL.removeLayer(camadas.focos); camadas.focos = null; }
  focosMapa.dados = null;
  legenda.innerHTML = '';
  if (!sel) { msg.textContent = ''; return; }
  let url = 'api/pontos?modo=recentes';
  if (sel === 'dia') {
    const dia = document.getElementById('dia-focos').value;
    if (!dia) { msg.textContent = 'Choose a day.'; return; }
    url = `api/pontos?modo=dia&data=${dia}&sat=${document.getElementById('sat-dia').value}`;
  }
  msg.textContent = 'Fetching hotspots from NASA...';
  try {
    const r = await fetch(url);
    const j = await r.json();
    if (meuPedido !== focosMapa.pedido) return;
    if (!r.ok) {
      const sat = document.getElementById('sat-dia').value;
      msg.textContent = r.status === 503 ? 'Looking up a chosen day is not configured on this site yet.'
        : r.status === 404 ? (sat === 'modis' ? 'MODIS has data from Nov 1, 2000 to today.' : 'VIIRS has data from Jan 20, 2012 to today.')
          : r.status === 400 ? 'Invalid date.' : 'Could not fetch the hotspots right now.';
      return;
    }
    focosMapa.dados = j;
    const render = L.canvas({ padding: 0.3 });
    camadas.focos = L.layerGroup(j.pontos.map((p) => L.circleMarker([p[0], p[1]], {
      renderer: render, radius: 3, weight: 0.5, color: '#3a1a00', fillColor: corDoPonto(p), fillOpacity: 0.9,
    }).bindPopup(`<strong>${dataBr(p[2])}, ${p[3].slice(0, 2)}:${p[3].slice(2, 4)} UTC</strong><br>fire radiative power (FRP): ${p[4]} MW<br>satellite: ${p[5]}`))).addTo(mapaL);
    legenda.innerHTML = sel === 'dia'
      ? `<span><i style="background:${COR_DIA[j.sat]}"></i>${j.sat === 'modis' ? 'MODIS (Aqua and Terra)' : 'VIIRS'}, ${dataBr(j.data)}</span>`
      : CORES_IDADE.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
    contagemFocos();
  } catch (e) {
    if (meuPedido === focosMapa.pedido) msg.textContent = 'Could not fetch the hotspots right now.';
  }
}

// Texto com o total na Bahia e na área escolhida (mesmas células que o site soma).
function contagemFocos() {
  const j = focosMapa.dados;
  if (!j) return;
  const msg = document.getElementById('msg-focos');
  const n = j.pontos.length;
  let naArea = '';
  if (estado.area.tipo !== 'bahia' && DADOS.celulas_ids) {
    const ids = new Set(DADOS.celulas_ids);
    const k = j.pontos.filter((p) => ids.has(celulaDoPonto(p[0], p[1]))).length;
    naArea = ` ${fmt(k)} in the chosen area.`;
  }
  if (focosMapa.modo === 'dia') {
    let txt = `${fmt(n)} hotspots in Bahia on ${dataBr(j.data)}.${naArea}`;
    if (j.sat === 'modis') {
      const taxa = OFICIAL.metodo.taxa_por_mes[j.data.slice(5, 7)];
      const nAqua = j.pontos.filter((p) => p[5] === 'Aqua').length;  // a taxa foi calibrada só com o Aqua
      txt += ` On the VIIRS ruler, the ${fmt(nAqua)} Aqua hotspots times the ${MESES_LONGO[Number(j.data.slice(5, 7)) - 1]} rate (${num1(taxa)}) give about ${fmt(nAqua * taxa)} in Bahia (the rate was calibrated on Aqua only). For a single day, the conversion varies more than for a month.`;
    }
    msg.textContent = txt + ` Source: NASA FIRMS, ${String(j.produto || '').replace(/_/g, ' ')}. Tap a point to see time and power.`;
  } else {
    msg.textContent = `${fmt(n)} hotspots in Bahia in the last 7 days.${naArea} Source: NASA FIRMS, VIIRS NOAA-20 near real time. Tap a point to see time and power.`;
  }
}

// ------------------------------------------------------------------ desenho de área

function botoesDesenho() {
  const n = desenho.pontos.length;
  document.getElementById('desenhar-area').hidden = desenho.ativo;
  ['concluir-desenho', 'desfazer-ponto', 'cancelar-desenho'].forEach((id) => { document.getElementById(id).hidden = !desenho.ativo; });
  document.getElementById('concluir-desenho').disabled = n < 3;
  document.getElementById('desfazer-ponto').disabled = n === 0;
}

function iniciarDesenho() {
  if (!mapaL) abrirMapa();
  desenho.ativo = true;
  desenho.pontos = [];
  mapaL.doubleClickZoom.disable();
  document.getElementById('mapa').classList.add('desenhando');
  document.getElementById('msg-area').textContent = 'Tap the map to mark the corners of the area. With 3 points or more, click "Finish area".';
  atualizarDesenho();
}

function atualizarDesenho() {
  if (camadas.rascunho) { mapaL.removeLayer(camadas.rascunho); camadas.rascunho = null; }
  const pts = desenho.pontos;
  if (pts.length) {
    const forma = pts.length >= 3
      ? L.polygon(pts, { color: '#d9480f', weight: 2, dashArray: '6 4', fillOpacity: 0.08, interactive: false })
      : L.polyline(pts, { color: '#d9480f', weight: 2, dashArray: '6 4', interactive: false });
    const cantos = pts.map((p) => L.circleMarker(p, { radius: 5, color: '#fff', weight: 2, fillColor: '#d9480f', fillOpacity: 1, interactive: false }));
    camadas.rascunho = L.layerGroup([forma, ...cantos]).addTo(mapaL);
  }
  if (desenho.ativo && pts.length) {
    document.getElementById('msg-area').textContent = `${pts.length} ${pts.length === 1 ? 'point marked' : 'points marked'}.` + (pts.length < 3 ? ' Mark at least 3.' : ' Click "Finish area" or keep marking.');
  }
  botoesDesenho();
}

function encerrarDesenho() {
  desenho.ativo = false;
  if (camadas.rascunho) { mapaL.removeLayer(camadas.rascunho); camadas.rascunho = null; }
  if (mapaL) mapaL.doubleClickZoom.enable();
  document.getElementById('mapa').classList.remove('desenhando');
  botoesDesenho();
}

function concluirDesenho() {
  if (desenho.pontos.length < 3) return;
  const pontos = desenho.pontos.map((p) => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]);
  definirArea({ tipo: 'poligono', pontos, origem: 'desenho' });
}

// ------------------------------------------------------------------ métodos testados

const num1 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const num3 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const num2b = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ORDEM_METODOS = ['taxa_unica', 'taxa_por_mes', 'quadradinhos', 'ranking', 'formula_pesos', 'terra', 'mistura'];

function textosMetodos(d) {
  const r = d.metodos;
  const t1 = r.taxa_por_mes;
  const taxa = OFICIAL.metodo.taxa_por_mes;
  const peso = Math.round(d.peso_mistura_taxa_por_mes * 100);
  const nAnos = Object.keys(t1.um_ano_fora_por_ano).length;
  return {
    taxa_unica: {
      nome: 'One single ratio for the whole year', curto: 'Single ratio', tag: ['descartado', 'discarded'],
      como: 'One number: total VIIRS hotspots divided by total MODIS Aqua hotspots in the years both satellites flew together.',
      veredito: 'Uses the same ratio in the dry and the rainy season. In the rainy season fires are small and VIIRS sees many more than MODIS, so the single ratio misses those months.',
    },
    taxa_por_mes: {
      nome: 'One ratio for each calendar month', curto: 'Monthly ratio', tag: ['usado', 'used in the app'],
      como: `For each month of the year, how many hotspots VIIRS sees for each MODIS Aqua hotspot. In September (dry season) it is ${num1(taxa['09'])}; in January (rainy season), ${num1(taxa['01'])}. The old record is multiplied by the ratio of its month.`,
      veredito: `Lowest error among the methods used alone, and it stayed close to ${num1(t1.um_ano_fora_erro_pct)}% when leaving each year out. It is 12 numbers anyone can check in a spreadsheet.`,
    },
    quadradinhos: {
      nome: 'Count places with fire instead of hotspots', curto: 'Grid cells *', tag: ['descartado', 'robustness check'],
      como: 'Splits the map into cells of about 5.5 km and counts how many had fire on each day. Then applies a monthly ratio.',
      veredito: `When fire is dense, a cell is already lit and stops counting. It erred more in new years and in the Aqua drift years (${num1(r.quadradinhos.deriva_erro_pct)}%), and the number cannot be compared with official hotspot counts.`,
    },
    ranking: {
      nome: 'Convert by rank (quantile mapping)', curto: 'Quantile mapping', tag: ['descartado', 'discarded'],
      como: 'A month among the 30% strongest for MODIS gets the value of the 30% strongest for VIIRS.',
      veredito: `It memorized the data: ${num1(r.ranking.anos_que_viu_erro_pct)}% error in the years it had seen and ${num1(r.ranking.teste_erro_pct)}% in the years it had not. The record years before 2012 go beyond the largest value it knows.`,
    },
    formula_pesos: {
      nome: 'Weighted factor model (mentors\' request)', curto: 'Factor model', tag: ['faixa', 'used in the band'],
      como: 'A statistical model that adjusts the ratio by fire intensity, share of night-time hotspots, rain, humidity, temperature and elevation, with NASA POWER data.',
      veredito: `It explains why the ratio changes and kept the same factors in every test, but it did not beat the monthly ratio (${num1(r.formula_pesos.teste_erro_pct)}% against ${num1(t1.teste_erro_pct)}%). In the Aqua drift years it erred less (${num1(r.formula_pesos.deriva_erro_pct)}% against ${num1(t1.deriva_erro_pct)}%). It is part of the 2003 to 2011 band.`,
    },
    terra: {
      nome: 'Convert from MODIS Terra', curto: 'Terra-based ratio', tag: ['faixa', 'used in the band'],
      como: 'The same monthly ratio, but starting from MODIS Terra instead of Aqua.',
      veredito: `${num1(r.terra.teste_erro_pct)}% error on the test. Terra flies in the morning and Aqua in the afternoon, close to the VIIRS overpass. Before 2012 the two MODIS disagree, so Terra is part of the uncertainty band.`,
    },
    mistura: {
      nome: 'Blend of the monthly ratio and the factor model', curto: `Blend ${peso}/${100 - peso}`, tag: ['promissor', 'next step'],
      como: `${peso}% monthly ratio and ${100 - peso}% factor model. The weight was optimized with cross-validation on 2013 to 2019 only (the weight with the lowest error on blind predictions), without looking at the test.`,
      veredito: `It had the lowest error (${num1(r.mistura.teste_erro_pct)}%) and beat the monthly ratio in ${r.mistura.anos_que_ganha_da_taxa_por_mes} of ${nAnos} years, but the difference is ${num1(t1.teste_erro_pct - r.mistura.teste_erro_pct)} point and may still be chance. So the main number did not change.`,
    },
  };
}

async function comparacaoMetodos() {
  if (!METODOS) {
    try {
      METODOS = await (await fetch('data/metodos.json')).json();
    } catch (e) {
      document.getElementById('metodos-intro').innerHTML = '<p>Could not load the comparison.</p>';
      return;
    }
  }
  const d = METODOS;
  const r = d.metodos;
  const tx = textosMetodos(d);
  const t1 = r.taxa_por_mes;
  const nAnos = Object.keys(t1.um_ano_fora_por_ano).length;
  document.getElementById('metodos-intro').innerHTML = `
    <p>To choose the conversion, we put every method through the same test. Each one learned only from ${d.periodos.calibracao_teste[0].slice(0, 4)} to 2019 and tried to predict 2020 to 2023, years it had not seen. Then we compared with what VIIRS actually measured. To make sure it was not luck of the period, we repeated it leaving one year out at a time, from ${d.periodos.um_ano_fora[0]} to ${d.periodos.um_ano_fora[1]}.</p>
    <p class="nota">Error: how much the conversion missed per month, on average, against real VIIRS (WAPE, in %). Lower is better. The same ${t1.teste_n_meses} test months for every method.</p>`;

  const el = document.getElementById('graf-metodos');
  const g = graficos.metodos || echarts.init(el);
  graficos.metodos = g;
  const ordem = [...ORDEM_METODOS].sort((a, b) => r[b].teste_erro_pct - r[a].teste_erro_pct);
  const destaque = (k) => k === 'taxa_por_mes';
  const estreito = el.clientWidth < 520;
  const fonte = estreito ? 11 : 12;
  g.setOption({
    animation: false,
    grid: { left: estreito ? 108 : 150, right: estreito ? 40 : 56, top: estreito ? 50 : 34, bottom: estreito ? 8 : 24 },
    legend: { top: 0, left: estreito ? 0 : 'center', orient: estreito ? 'vertical' : 'horizontal', itemGap: 6, textStyle: { color: css('--texto-suave'), fontSize: fonte } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true, valueFormatter: (v) => num1(v) + '%' },
    xAxis: { type: 'value', axisLabel: { show: !estreito, color: css('--texto-suave'), formatter: (v) => v + '%' }, splitLine: { lineStyle: { color: css('--borda') } } },
    yAxis: {
      type: 'category', data: ordem.map((k) => k),
      axisLabel: { color: css('--texto'), fontSize: fonte, formatter: (k) => (destaque(k) ? '{b|' + tx[k].curto + '}' : tx[k].curto), rich: { b: { fontWeight: 700, color: css('--destaque') } } },
    },
    series: [
      { name: 'Test 2020 to 2023', type: 'bar', barGap: '15%', itemStyle: { color: css('--destaque'), borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', fontSize: fonte, color: css('--texto'), formatter: (p) => num1(p.value) + '%' },
        data: ordem.map((k) => r[k].teste_erro_pct) },
      { name: `Leaving one year out at a time (${nAnos} years)`, type: 'bar', itemStyle: { color: css('--destaque-2'), opacity: 0.75, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', fontSize: fonte, color: css('--texto-suave'), formatter: (p) => num1(p.value) + '%' },
        data: ordem.map((k) => r[k].um_ano_fora_erro_pct) },
    ],
  }, true);

  document.getElementById('metodos-lista').innerHTML = ORDEM_METODOS.map((k, i) => {
    const m = r[k];
    const t = tx[k];
    return `<article class="metodo-card ${k === 'taxa_por_mes' ? 'usado' : ''}">
      <header><h3>${i + 1}. ${t.nome}</h3><span class="tag ${t.tag[0]}">${t.tag[1]}</span></header>
      <p>${t.como}</p>
      <div class="numeros">
        <span><strong>${num1(m.teste_erro_pct)}%</strong>on the test</span>
        <span><strong>${num1(m.um_ano_fora_erro_pct)}%</strong>leaving each year out</span>
        <span><strong>${num1(m.anos_que_viu_erro_pct)}%</strong>in the years it saw</span>
      </div>
      <p class="veredito">${t.veredito}</p>
    </article>`;
  }).join('');

  const c = d.correlacao_ordem_dos_meses;
  document.getElementById('metodos-conclusao').innerHTML = `
    <h3>Why the app uses the monthly ratio</h3>
    <ul>
      <li><strong>Lowest error among the methods used alone:</strong> ${num1(t1.teste_erro_pct)}% on the test and ${num1(t1.um_ano_fora_erro_pct)}% leaving one year out at a time.</li>
      <li><strong>It does not memorize:</strong> ${num1(t1.anos_que_viu_erro_pct)}% error in the years it saw and ${num1(t1.teste_erro_pct)}% in the years it did not. Quantile mapping went from ${num1(r.ranking.anos_que_viu_erro_pct)}% to ${num1(r.ranking.teste_erro_pct)}%.</li>
      <li><strong>Easy to check:</strong> 12 numbers, one per month, that anyone can redo in a spreadsheet.</li>
      <li><strong>It makes physical sense:</strong> the ratio rises in the rainy season, when fires are small and VIIRS sees more than MODIS.</li>
      <li><strong>It works for any area:</strong> the same 12 ratios are used when you choose a point on the map.</li>
    </ul>
    <h3>What about the blend, which erred less?</h3>
    <p>It won by a little: ${num1(r.mistura.teste_erro_pct)}% against ${num1(t1.teste_erro_pct)}% on the test, and in ${r.mistura.anos_que_ganha_da_taxa_por_mes} of ${nAnos} years. With so few years of data, a difference this size may still be chance, and the app does not yet compute the factor model for each area of the map. So the main number keeps the monthly ratio and the blend is the next test.</p>
    <h3>External check</h3>
    <p>We compared the converted series with INPE's reference satellite series, which does not go through our conversion. The shape of the years matches and the 2012 jump disappears. <a href="#inpe" data-janela="inpe">See the check against INPE</a>.</p>
    <h3>Correlation is not proof</h3>
    <p>The order of the months, from weakest to strongest, has a correlation of ${num3(c.taxa_por_mes)} with the monthly ratio. But raw Aqua, with no conversion at all, already reaches ${num3(c.aqua_sem_conversao)}, because dry and rainy seasons rule the year. That is why we measure the error in hotspots, not the correlation.</p>
    <p class="nota">* Grid cells: error measured in 0.05 degree cells with fire per day, not in hotspots. Terra: without the months when Terra had missing data. Blend: the weight was optimized with cross-validation on 2013 to 2019 only, without looking at the test. The years 2024 and 2025 are left out of the choice because the Aqua orbit changed; the error of each method in those years is in the JSON.</p>`;
}

// ------------------------------------------------------------------ conferência com o INPE

async function comparacaoInpe() {
  if (!INPE) {
    try {
      INPE = await (await fetch('data/inpe.json')).json();
    } catch (e) {
      document.getElementById('inpe-intro').innerHTML = '<p>Could not load the comparison.</p>';
      return;
    }
  }
  const d = INPE;
  const r = d.resumo;
  const anos = d.anos;
  const num2 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const iguais = (a, b) => a[0] === b[0];
  document.getElementById('inpe-intro').innerHTML = `
    <p>INPE, Brazil's National Institute for Space Research, publishes the hotspots of one <strong>reference satellite</strong>, the same one since 2003, precisely to compare years. This series does not go through our conversion. If the harmonization is right, both series must rise and fall together, with no jump in 2012.</p>
    <div class="metricas">
      <div><strong>${num3(r.correlacao_anual)}</strong><span>year-to-year correlation with INPE (not harmonized: ${num2(r.correlacao_anual_sem_harmonizar)})</span></div>
      <div><strong>${num3(r.correlacao_mensal)}</strong><span>month-to-month correlation</span></div>
      <div><strong>${r.mes_pico_igual} of ${r.n_anos}</strong><span>years with the same peak month</span></div>
      <div><strong>${r.top5_inpe[0]}</strong><span>${iguais(r.top5_inpe, r.top5_nossa) ? 'year with the most fire in both series' : 'year with the most fire at INPE (ours: ' + r.top5_nossa[0] + ')'}</span></div>
    </div>`;

  const nomes = { inpe: 'INPE reference satellite', nossa: 'Régua de Fogo (harmonized)', crua: 'Not harmonized' };
  const cores = { inpe: css('--abaixo'), nossa: css('--destaque'), crua: '#94a3b8' };
  const eixo = (fmtY) => ({
    xAxis: { type: 'category', data: anos.map((a) => String(a.ano)), axisLabel: { color: css('--texto-suave') } },
    yAxis: { type: 'value', axisLabel: { color: css('--texto-suave'), formatter: fmtY }, splitLine: { lineStyle: { color: css('--borda') } } },
  });
  const marca2012 = { silent: true, symbol: 'none', lineStyle: { color: css('--texto-suave'), type: 'dotted' }, label: { formatter: 'VIIRS arrives', color: css('--texto-suave') }, data: [{ xAxis: '2012' }] };
  const estreito = document.getElementById('graf-inpe').clientWidth < 520;
  const legenda = { top: 0, left: estreito ? 0 : 'center', orient: estreito ? 'vertical' : 'horizontal', itemGap: 6, textStyle: { color: css('--texto-suave'), fontSize: estreito ? 11 : 12 } };
  const linha = (chave, campo, extra) => ({ name: nomes[chave], type: 'line', data: anos.map((a) => a[campo]), symbolSize: 5, lineStyle: { width: chave === 'crua' ? 2 : 3, color: cores[chave], type: chave === 'crua' ? 'dashed' : 'solid' }, itemStyle: { color: cores[chave] }, ...extra });

  const g1 = graficos.inpe || echarts.init(document.getElementById('graf-inpe'));
  graficos.inpe = g1;
  g1.setOption({
    animation: false, legend: legenda,
    grid: { left: 48, right: 16, top: estreito ? 84 : 56, bottom: 28 },
    tooltip: { trigger: 'axis', confine: true, formatter: (ps) => {
      const a = anos[ps[0].dataIndex];
      return `<strong>${a.ano}</strong><br>INPE: ${fmt(a.inpe)} hotspots<br>Régua de Fogo: ${fmt(a.nossa)} hotspots<br>Not harmonized: ${fmt(a.sem_harmonizar)} hotspots<br><span style="opacity:.75">index: ${ps.map((p) => p.seriesName.split(' ')[0] + ' ' + Math.round(p.value)).join(' · ')}</span>`;
    } },
    ...eixo((v) => v),
    series: [linha('inpe', 'indice_inpe', { markLine: marca2012 }), linha('nossa', 'indice_nossa'), linha('crua', 'indice_sem_harmonizar')],
  }, true);

  const g2 = graficos.inpeRazao || echarts.init(document.getElementById('graf-inpe-razao'));
  graficos.inpeRazao = g2;
  g2.setOption({
    animation: false, legend: { ...legenda, data: [nomes.nossa, nomes.crua] },
    grid: { left: 48, right: 16, top: estreito ? 70 : 56, bottom: 28 },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: (v) => num1(v) + ' hotspots for each INPE hotspot' },
    ...eixo((v) => v + 'x'),
    series: [linha('nossa', 'razao_nossa_inpe', { markLine: marca2012 }), linha('crua', 'razao_sem_harmonizar_inpe')],
  }, true);

  const h = anos.filter((a) => a.hora_utc_mais_comum_inpe !== null);
  const ultimoAntes = h.filter((a) => a.hora_utc_mais_comum_inpe === h[0].hora_utc_mais_comum_inpe).pop();
  const depois = h.filter((a) => a.ano > ultimoAntes.ano);
  document.getElementById('inpe-leitura').innerHTML = `
    <h3>What the comparison shows</h3>
    <ul>
      <li><strong>The 2012 jump disappears.</strong> Without harmonization, our count goes from ${num1(r.razao_sem_harmonizar_2011)} to ${num1(r.razao_sem_harmonizar_2012)} hotspots for each INPE hotspot from 2011 to 2012, a ${num1(r.salto_sem_harmonizar_vezes)}-fold jump caused only by the satellite change. Harmonized, it stays at ${num1(r.razao_media_2003_2011)} from 2003 to 2011 and ${num1(r.razao_media_2012_2021)} from 2012 to 2021: a remaining difference of ${num1(r.diferenca_entre_periodos_pct)}%.</li>
      <li><strong>The years rise and fall together, but that alone is not proof.</strong> Correlation of ${num3(r.correlacao_anual)} year to year and ${num3(r.correlacao_mensal)} month to month. Raw MODIS Aqua, with no conversion at all, already reaches ${num3(r.correlacao_anual_aqua_sem_conversao)}, because INPE's reference satellite is Aqua itself. What the comparison does show is the item above: the 2012 jump disappears. Joining MODIS until 2011 and VIIRS after without harmonization, the correlation drops to ${num2(r.correlacao_anual_sem_harmonizar)}.</li>
      <li><strong>The worst years match.</strong> Five years with the most fire at INPE: ${r.top5_inpe.join(', ')}. In Régua de Fogo: ${r.top5_nossa.join(', ')}.</li>
      ${depois.length ? `<li><strong>The Aqua orbit change shows up at INPE too.</strong> The most common overpass hour was ${h[0].hora_utc_mais_comum_inpe}:00 UTC until ${ultimoAntes.ano} and becomes ${depois[0].hora_utc_mais_comum_inpe}:00 UTC in ${depois.map((a) => a.ano).join(' and ')}. It is the same drift we found in the NASA data, confirmed by another source.</li>` : ''}
    </ul>
    <h3>How to read it</h3>
    <ul>
      <li>INPE counts far fewer hotspots than our series: it uses another processing and only the hotspots inside the official state border. We use a rectangle around Bahia that includes parts of the neighboring states. So the comparison is about the shape of the series, not the absolute number.</li>
      <li>The overpass time, around 1:30 pm local time in Bahia, indicates that the reference satellite is MODIS Aqua, the same one we use as the base. So this check confirms the shape of the series, but it does not settle the difference between Aqua and Terra before 2012. The uncertainty band for that period stays.</li>
    </ul>
    <p class="nota">Source: INPE, Programa Queimadas, reference satellite hotspots (annual files for Brazil), <a href="${d.url_fonte}" target="_blank" rel="noopener">dataserver-coids.inpe.br</a>. Hotspots with state equal to Bahia, from 2003 to 2025.</p>`;
}

// ------------------------------------------------------------------ detectados e relatados

async function detectadosRelatados() {
  if (!RELATADOS) {
    try {
      RELATADOS = await (await fetch('data/relatados.json')).json();
    } catch (e) {
      document.getElementById('relatados-intro').innerHTML = '<p>Could not load the records.</p>';
      return;
    }
  }
  const d = RELATADOS;
  const [a0, a1] = d.anos_com_cobertura;
  const num2 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('relatados-intro').innerHTML = `
    <p><strong>Detected</strong> is a fire hotspot seen by the satellite. <strong>Reported</strong> is a fire that a brigade registered on the ground, with date, place, cause and burned area. Here we compare our series with the Fire Occurrence Records (ROI) of the IBAMA (Prevfogo) federal brigades in Bahia.</p>
    <div class="metricas">
      <div><strong>${fmt(d.media_ocorrencias_por_ano)}</strong><span>reported fires per year (${a0} to ${a1})</span></div>
      <div><strong>${fmt(d.media_focos_por_ano)}</strong><span>detected hotspots per year in the same period</span></div>
      <div><strong>${fmt(d.focos_por_ocorrencia)}</strong><span>detected hotspots for each reported fire</span></div>
      <div><strong>${d.detectados_por_satelite} of ${fmt(d.total_ocorrencias)}</strong><span>records where the fire was found by satellite; the others came from patrols, phone calls and lookouts</span></div>
    </div>
    <p class="nota">The records only cover areas served by federal brigades: protected areas, indigenous lands, settlements and nearby properties. So the number of reported fires does not measure all the fire in the state: it shows the part that reaches a team on the ground.</p>`;

  const estreito = document.getElementById('graf-relatados-mes').clientWidth < 520;
  const legenda = { top: 0, left: estreito ? 0 : 'center', orient: estreito ? 'vertical' : 'horizontal', itemGap: 6, textStyle: { color: css('--texto-suave'), fontSize: estreito ? 11 : 12 } };
  const eixoY = (f) => ({ type: 'value', axisLabel: { color: css('--texto-suave'), formatter: f }, splitLine: { lineStyle: { color: css('--borda') } } });

  const g1 = graficos.relMes || echarts.init(document.getElementById('graf-relatados-mes'));
  graficos.relMes = g1;
  g1.setOption({
    animation: false, legend: legenda,
    grid: { left: 44, right: 12, top: estreito ? 52 : 34, bottom: 24 },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: (v) => num1(v) + '% of the year' },
    xAxis: { type: 'category', data: MESES, axisLabel: { color: css('--texto-suave') } },
    yAxis: eixoY((v) => v + '%'),
    series: [
      { name: 'Reported (IBAMA)', type: 'bar', data: d.sazonal.map((x) => x.relatados_pct), itemStyle: { color: css('--abaixo'), borderRadius: [4, 4, 0, 0] } },
      { name: 'Detected (satellite)', type: 'bar', data: d.sazonal.map((x) => x.detectados_pct), itemStyle: { color: css('--destaque'), borderRadius: [4, 4, 0, 0] } },
    ],
  }, true);

  const g2 = graficos.relAno || echarts.init(document.getElementById('graf-relatados-ano'));
  graficos.relAno = g2;
  g2.setOption({
    animation: false, legend: legenda,
    grid: { left: 44, right: 56, top: estreito ? 52 : 34, bottom: 24 },
    tooltip: { trigger: 'axis', confine: true, formatter: (ps) => {
      const x = d.por_ano[ps[0].dataIndex];
      return `<strong>${x.ano}</strong><br>${x.relatados} reported fires (${fmt(x.area_ha)} ha burned)<br>${fmt(x.detectados)} detected hotspots`;
    } },
    xAxis: { type: 'category', data: d.por_ano.map((x) => String(x.ano)), axisLabel: { color: css('--texto-suave') } },
    yAxis: [eixoY((v) => v), { ...eixoY(milhar), splitLine: { show: false } }],
    series: [
      { name: 'Reported fires (left axis)', type: 'bar', data: d.por_ano.map((x) => x.relatados), itemStyle: { color: css('--abaixo'), borderRadius: [4, 4, 0, 0] } },
      { name: 'Detected hotspots (right axis)', type: 'line', yAxisIndex: 1, data: d.por_ano.map((x) => x.detectados), symbolSize: 6, lineStyle: { width: 3, color: css('--destaque') }, itemStyle: { color: css('--destaque') } },
    ],
  }, true);

  // categorias do IBAMA em português, traduzidas para a tela
  const CATEGORIAS = {
    RONDA: 'Patrol', TELEFONE: 'Phone call', 'PONTO DE OBSERVAÇÃO': 'Lookout point', 'INDÍGENA': 'Indigenous people',
    'ASSENTADO/PROPRIETÁRIO': 'Settler or landowner', 'MONITORAMENTO POR SATÉLITE': 'Satellite monitoring', 'DURANTE COMBATE': 'During firefighting',
    OUTROS: 'Other', INDETERMINADO: 'Undetermined', VANDALISMO: 'Vandalism', 'QUEIMA DE LIXO': 'Waste burning',
    'LIMPEZA DE ÁREA PARA CULTIVO': 'Land clearing for crops', 'RENOVAÇÃO DE PASTAGEM NATURAL': 'Natural pasture renewal',
    'CAÇA': 'Hunting', 'RENOVAÇÃO DE PASTAGEM PLANTADA': 'Planted pasture renewal', 'não informada': 'Not reported', 'não informado': 'Not reported',
    'PROPRIEDADE RURAL': 'Rural property', 'UNIDADE DE CONSERVAÇÃO': 'Protected area', 'TERRA INDÍGENA': 'Indigenous land',
    'PROJETO DE ASSENTAMENTO': 'Settlement', 'COMUNIDADE TRADICIONAL': 'Traditional community', 'FLORESTA PÚBLICA': 'Public forest',
  };
  const frase = (t) => CATEGORIAS[t] || (t.charAt(0) + t.slice(1).toLowerCase());
  const nomeProprio = (t) => t.toLowerCase().split(' ').map((w, k) => (k > 0 && ['de', 'da', 'do', 'das', 'dos', 'e'].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  const lista = (titulo, itens, f = frase) => `<div><h4>${titulo}</h4><ol>${itens.map((i) => `<li>${f(i.nome)}: ${i.n}</li>`).join('')}</ol></div>`;
  document.getElementById('relatados-detalhe').innerHTML = `
    <h3>What the comparison shows</h3>
    <ul>
      <li><strong>Only a fraction of the fire becomes a record.</strong> For each fire reported by the federal brigades, the satellite detected about ${fmt(d.focos_por_ocorrencia)} hotspots in Bahia. Even counting that one large fire produces many hotspots, most of the fire in the state does not appear in these records. To see the whole state, the satellite is the only continuous source.</li>
      <li><strong>The fire season is similar.</strong> Reported fires peak in ${MESES_LONGO[d.mes_pico_relatados - 1]} and detected hotspots in ${MESES_LONGO[d.mes_pico_detectados - 1]}; both concentrate from July to October (correlation of ${num2(d.correlacao_sazonal)} between the two yearly curves).</li>
      <li><strong>Month to month, the numbers do not move together</strong> (correlation of ${num2(d.correlacao_mensal)}). Records depend on where brigades exist and how many teams were in the field, not on how much fire there was in the state.</li>
    </ul>
    <div class="listas-relatados">
      ${lista('How the fire was found', d.deteccao.slice(0, 6))}
      ${lista('Probable cause', d.causas.slice(0, 6))}
      ${lista('Where', d.locais.slice(0, 6))}
      ${lista('Municipalities with the most records', d.municipios.slice(0, 6), nomeProprio)}
    </div>
    <p class="nota">Source: IBAMA, Sisfogo, Fire Occurrence Records (ROI), open data, <a href="${d.url_fonte}" target="_blank" rel="noopener">dadosabertos.ibama.gov.br</a>. ${fmt(d.total_ocorrencias)} records in Bahia, each counted once. Years with fewer than ${d.minimo_registros_por_ano} records are left out of the charts, because the open file only covers ${a0} to ${a1}; ${d.datas_invalidas_descartadas} records with invalid dates were discarded.</p>`;
}

// ------------------------------------------------------------------ metodologia e testes

// completude dos dados: dias com dado por satélite (Dados/firms_bahia/relatorio_completude.md)
const COMPLETUDE = [['MODIS Aqua', 99.6], ['MODIS Terra', 99.3], ['VIIRS Suomi NPP', 99.3], ['VIIRS NOAA-20', 99.8]];

async function carregarJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

async function metodologia() {
  const caixa = document.getElementById('metodologia-conteudo');
  try {
    [METODOS, INPE, RELATADOS, REPLICACAO, CONFERENCIA] = await Promise.all([
      METODOS || carregarJson('data/metodos.json'), INPE || carregarJson('data/inpe.json'), RELATADOS || carregarJson('data/relatados.json'),
      REPLICACAO || carregarJson('data/replicacao_regioes.json'), CONFERENCIA || carregarJson('data/conferencia_api.json'),
    ]);
  } catch (e) {
    caixa.innerHTML = '<p>Could not load the tests.</p>';
    return;
  }
  const v = OFICIAL.metodo.validacao;
  const f = OFICIAL.metodo.fatores;
  const t1 = METODOS.metodos.taxa_por_mes;
  const unica = METODOS.metodos.taxa_unica;
  const ri = INPE.resumo;
  const rep = REPLICACAO;
  const outros = rep.regioes.filter((r) => !r.regiao.startsWith('Bahia'));
  const outrosGanham = outros.filter((r) => r.teste_erro_pct < r.teste_erro_taxa_unica_pct).length;
  const outrosUmAnoFora = outros.filter((r) => r.um_ano_fora_erro_pct < r.um_ano_fora_erro_taxa_unica_pct).length;
  const janelas = CONFERENCIA.janelas;
  const api = (prod) => {
    const js = janelas.filter((x) => x.produto === prod);
    const l = js.reduce((t, x) => t + x.local_filtrado, 0);
    const a = js.reduce((t, x) => t + x.api_filtrado, 0);
    return { n: js.length, iguais: js.filter((x) => x.local_filtrado === x.api_filtrado).length, dif: (l - a) / a * 100 };
  };
  const viirsApi = api('VIIRS_SNPP_SP');
  const modisApi = api('MODIS_SP');
  const taxa = OFICIAL.metodo.taxa_por_mes;
  const fim = OFICIAL.periodo.fim;
  const card = (titulo, pergunta, resultado, ok, janela) => `<article class="teste-card">
      <header><h4>${titulo}</h4><span class="tag ${ok ? 'passou' : 'limite'}">${ok ? 'passed' : 'limit found'}</span></header>
      <p class="pergunta">${pergunta}</p>
      <p class="resultado">${resultado}</p>
      ${janela ? `<a href="#${janela}" data-janela="${janela}">See the details</a>` : ''}
    </article>`;
  const regioes = [...rep.regioes].sort((a, b) => a.teste_erro_pct - b.teste_erro_pct);
  caixa.innerHTML = `
    <h3>1. How the series is built</h3>
    <ol class="passos">
      <li><strong>Download</strong>NASA FIRMS annual country files for Brazil: MODIS Collection 6.1 (Aqua and Terra, 2000 to 2025) and VIIRS 375 m (Suomi NPP 2012 to 2025, NOAA-20 2018 to 2025), clipped to a rectangle around Bahia. 2026 comes from the FIRMS area API, up to ${MESES_LONGO[Number(fim.slice(5, 7)) - 1]} ${fim.slice(0, 4)}.</li>
      <li><strong>Filter and count</strong>Vegetation fires only (type = 0), MODIS confidence 30 or more, VIIRS without low confidence. Hotspots are counted per month for each satellite, and per NASA POWER grid cell (about 55 x 68 km) so any area of interest can be added up.</li>
      <li><strong>Remove bad months</strong>Months with 3 or more days without data, or with degraded Aqua days (daily Aqua/Suomi NPP ratio below 0.25 times the monthly median), stay out of calibration and testing. Suomi NPP gaps are filled with NOAA-20 times ${OFICIAL.metodo.razao_snpp_noaa20.toLocaleString('en-US')}, the ratio measured when both were complete.</li>
      <li><strong>Learn one ratio per calendar month</strong>In the years both sensors flew together (February 2012 to December 2021, before the Aqua orbit drift), the ratio for each month of the year is total VIIRS divided by total MODIS Aqua. Aqua is the base because it crosses in the afternoon, close to VIIRS.<br><span class="formula">VIIRS-equivalent(month) = ratio(calendar month) × MODIS Aqua(month)</span></li>
      <li><strong>Build the series</strong>2003 to January 2012: MODIS Aqua converted with the ratio of its month. From February 2012: real VIIRS counts. Before 2012, a band between three readings (Aqua ratio, Terra ratio and the factor model), because the two MODIS satellites disagree.</li>
      <li><strong>Compare with the normal</strong>For each calendar month, the median, the mean and the 25th to 75th percentile range of the years measured by VIIRS (2012 to 2025). A month above the 75th percentile is above normal; below the 25th, below normal.</li>
    </ol>
    <p class="nota">The 12 learned ratios (VIIRS hotspots for each MODIS Aqua hotspot). They are higher in the rainy season, when fires are small and VIIRS sees much more than MODIS.</p>
    <div id="graf-taxas" class="grafico baixo" role="img" aria-label="VIIRS to MODIS Aqua ratio for each calendar month"></div>

    <h3>2. Every test we ran</h3>
    <div class="testes">
      ${card('Unseen years', 'Learning only from 2012 to 2019, how well does it predict 2020 to 2023?', `<strong>${num1(t1.teste_erro_pct)}%</strong>monthly error over ${t1.teste_n_meses} months, total bias ${pct(t1.teste_vies_pct)}.`, true, null)}
      ${card('Leave one year out', 'Was 2020 to 2023 just a lucky period?', `<strong>${num1(t1.um_ano_fora_erro_pct)}%</strong>error hiding each year from 2013 to 2023 (${t1.um_ano_fora_n_meses} months). Single ratio: ${num1(unica.um_ano_fora_erro_pct)}%.`, true, null)}
      ${card('7 methods, same test', 'Is the monthly ratio really the best choice?', `<strong>${num1(t1.teste_erro_pct)}%</strong>the lowest error among methods used alone. Quantile mapping memorized the data (${num1(METODOS.metodos.ranking.anos_que_viu_erro_pct)}% on seen years, ${num1(METODOS.metodos.ranking.teste_erro_pct)}% on new ones).`, true, 'metodos')}
      ${card('Check against INPE', 'Does the 2012 jump disappear in another processing of the same satellite?', `<strong>${num1(ri.diferenca_entre_periodos_pct)}%</strong>difference in our/INPE ratio before and after 2012, against a ${num1(ri.salto_sem_harmonizar_vezes)}-fold jump without harmonization. Year-to-year correlation is ${num3(ri.correlacao_anual)}, but raw Aqua already reaches ${num3(ri.correlacao_anual_aqua_sem_conversao)}: INPE's reference satellite is Aqua.`, true, 'inpe')}
      ${card('Data check: FIRMS API', 'Are the files we downloaded the same as NASA\'s official API?', `<strong>${viirsApi.iguais} of ${viirsApi.n}</strong>VIIRS windows match exactly. MODIS differs by ${pct(Math.round(modisApi.dif * 100) / 100)} (newer processing version in the annual files).`, true, null)}
      ${card('Data completeness', 'Are there holes in the satellite record?', `<strong>&gt;99%</strong>of days with data: ${COMPLETUDE.map(([n, p]) => `${n} ${p}%`).join(', ')}. Months with gaps are flagged.`, true, null)}
      ${card('Other regions', 'Does the method only work in Bahia?', `<strong>${outrosGanham} of ${outros.length}</strong>other countries where the monthly ratio beats a single ratio on unseen years (${outrosUmAnoFora} of ${outros.length} leaving one year out). Struggles with little fire (Portugal) and record years (Canada 2023).`, false, null)}
      ${card('Factor model (mentors\' weights)', 'Do weather and fire factors improve the conversion?', `<strong>${num1(METODOS.metodos.formula_pesos.teste_erro_pct)}%</strong>error, no better than the monthly ratio, but it explains why the ratio changes (night-time share, humidity) and its 95% band covered ${f.cobertura_faixa_95.replace(' de ', ' of ')} test months.`, false, 'metodo')}
      ${card('Detected vs reported', 'How does satellite detection compare with fires registered on the ground?', `<strong>${fmt(RELATADOS.focos_por_ocorrencia)}</strong>hotspots for each fire registered by IBAMA brigades; only ${RELATADOS.detectados_por_satelite} of ${fmt(RELATADOS.total_ocorrencias)} records were found by satellite.`, true, 'relatados')}
      ${card('Correlation is not proof', 'Is a high correlation enough to trust the method?', `<strong>${num3(METODOS.correlacao_ordem_dos_meses.aqua_sem_conversao)}</strong>raw Aqua already reaches this, with no conversion, because seasons rule the year. So we judge by error in hotspots, not correlation.`, false, null)}
    </div>

    <h3>3. Does it work elsewhere?</h3>
    <p>The same scripts, the same filters and the same test (learn 2012 to 2019, predict 2020 to 2023) in ${rep.n_regioes - 1} countries with very different fire regimes. The rates are recalculated in each place: July goes from ${num1(rep.taxa_julho_min_max[0])} to ${num1(rep.taxa_julho_min_max[1])}.</p>
    <div id="graf-replicacao" class="grafico" style="height:460px" role="img" aria-label="Monthly ratio and single ratio error in each region"></div>
    <div class="tabela-rolagem"><table class="tabela-regioes">
      <thead><tr><th>Region</th><th>Monthly ratio</th><th>Single ratio</th><th>Leave one year out</th><th>Bias</th><th>2012 jump</th><th>Record year</th></tr></thead>
      <tbody>${regioes.map((r) => `<tr class="${r.regiao.startsWith('Bahia') ? 'destaque' : ''}"><td>${r.regiao}</td><td>${num1(r.teste_erro_pct)}%</td><td>${num1(r.teste_erro_taxa_unica_pct)}%</td><td>${num1(r.um_ano_fora_erro_pct)}%</td><td>${pct(r.teste_vies_pct)}</td><td>${num1(r.salto_sem_harmonizar_2011_2012)}x</td><td>${r.ano_com_mais_fogo}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="nota">Error = monthly WAPE on 2020 to 2023 against real VIIRS. The record years match known events (Indonesia 2015, Chile 2017, Canada 2023, Bolivia 2024). Portugal has a median of about 100 VIIRS hotspots per month, too few for a stable monthly ratio; Canada's 2023 record was far outside the calibration years.</p>

    <h3>4. Uncertainty and limits</h3>
    <ul>
      <li>Before 2012 there is no VIIRS to check against, and the two MODIS disagree: those years are shown with a band.</li>
      <li>The ${num1(v.erro_mensal_wape_pct)}% error is for the whole of Bahia; in smaller areas it grows (2020 to 2023 test: ${num1(erroEscala('bloco_2x2'))}% for about 110 x 135 km, ${num1(erroEscala('celula'))}% for one grid cell).</li>
      <li>Only Bahia is processed in the app; the method was tested in ${rep.n_regioes - 1} other countries.</li>
      <li>Recent months of 2026 are provisional near real time data.</li>
    </ul>

    <h3>5. Reproduce it</h3>
    <p>Everything is in the open repository: <a href="https://github.com/RafaTheMonk/calendario-queimadas" target="_blank" rel="noopener">github.com/RafaTheMonk/calendario-queimadas</a>. Python 3 with numpy; the 2026 and API scripts need a free FIRMS MAP_KEY.</p>
    <div class="comandos">Scripts/baixar_firms_bahia.sh                    # download FIRMS and clip the area
python3 -I Scripts/completude_firms.py           # data completeness
python3 -I Scripts/gerar_json_site.py            # build the harmonized series
python3 -I Scripts/harmonizacao/comparar_metodos.py   # 7 methods, same test
python3 -I Scripts/comparar_inpe.py              # check against INPE
python3 -I Scripts/conferir_com_api.py           # check files against the FIRMS API
python3 -I Scripts/replicar_regiao.py Argentina  # the method in another country
python3 -I Scripts/resumo_regioes.py             # summary of all regions</div>`;

  const estreito = caixa.clientWidth < 560;
  if (graficos.taxas) graficos.taxas.dispose();
  const g1 = echarts.init(document.getElementById('graf-taxas'));
  graficos.taxas = g1;
  g1.setOption({
    animation: false,
    grid: { left: 36, right: 12, top: 24, bottom: 24 },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: (x) => num1(x) + ' VIIRS hotspots per MODIS Aqua hotspot' },
    xAxis: { type: 'category', data: MESES, axisLabel: { color: css('--texto-suave') } },
    yAxis: { type: 'value', axisLabel: { color: css('--texto-suave') }, splitLine: { lineStyle: { color: css('--borda') } } },
    series: [{ type: 'bar', data: MESES.map((_, i) => taxa[String(i + 1).padStart(2, '0')]), itemStyle: { color: css('--destaque'), borderRadius: [4, 4, 0, 0] },
      label: { show: !estreito, position: 'top', color: css('--texto-suave'), formatter: (x) => num1(x.value) } }],
  }, true);

  const ordem = [...regioes].reverse();
  if (graficos.replicacao) graficos.replicacao.dispose();
  const g2 = echarts.init(document.getElementById('graf-replicacao'));
  graficos.replicacao = g2;
  g2.setOption({
    animation: false,
    legend: { top: 0, textStyle: { color: css('--texto-suave'), fontSize: estreito ? 11 : 12 } },
    grid: { left: estreito ? 96 : 120, right: 40, top: 32, bottom: 20 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true, valueFormatter: (x) => num1(x) + '%' },
    xAxis: { type: 'value', axisLabel: { show: !estreito, color: css('--texto-suave'), formatter: (x) => x + '%' }, splitLine: { lineStyle: { color: css('--borda') } } },
    yAxis: { type: 'category', data: ordem.map((r) => r.regiao.replace(' (Brazil)', '')),
      axisLabel: { color: css('--texto'), fontSize: estreito ? 11 : 12, formatter: (n) => (n === 'Bahia' ? '{b|Bahia}' : n), rich: { b: { fontWeight: 700, color: css('--destaque') } } } },
    series: [
      { name: 'Monthly ratio (our method)', type: 'bar', data: ordem.map((r) => r.teste_erro_pct), itemStyle: { color: css('--destaque'), borderRadius: [0, 4, 4, 0] } },
      { name: 'Single ratio', type: 'bar', data: ordem.map((r) => r.teste_erro_taxa_unica_pct), itemStyle: { color: '#94a3b8', borderRadius: [0, 4, 4, 0] } },
    ],
  }, true);
}

// ------------------------------------------------------------------ método e rodapé

// nomes dos fatores do modelo, que vêm em português no JSON
const FATOR_EN = {
  'intensidade do fogo (FRP médio, log)': 'fire intensity (mean FRP, log)', 'fração de focos noturnos': 'share of night-time hotspots',
  'tamanho do pixel (scan)': 'pixel size (scan)', 'hora de passagem diurna': 'daytime overpass time', 'chuva (mm/dia)': 'rain (mm/day)',
  'vento a 10 m (m/s)': 'wind at 10 m (m/s)', 'umidade relativa (%)': 'relative humidity (%)', 'temperatura (°C)': 'temperature (°C)', 'altitude (m)': 'elevation (m)',
};
const rotuloFator = (f) => FATOR_EN[f] || f;

function metodo() {
  const me = OFICIAL.metodo;
  const f = me.fatores;
  const v = me.validacao;
  const comp = f ? f.comparacao_teste_2020_2023 : null;
  const fim = OFICIAL.periodo.fim;
  const fimTexto = `${MESES_LONGO[Number(fim.slice(5, 7)) - 1]} ${fim.slice(0, 4)}`;
  const anual = Object.entries(v.erro_total_anual_pct).map(([a, e]) => `${a}: ${pct(e)}`).join(' · ');
  const pesos = f ? f.pesos.map((p) => {
    const efeito = Math.round((p.multiplica_razao_por_1_desvio - 1) * 1000) / 10;
    const firme = !(p.ic95_peso && p.ic95_peso[0] < 0 && p.ic95_peso[1] > 0);
    return `<li><strong>${rotuloFator(p.fator)}</strong>: ${firme ? `${efeito > 0 ? '+' : ''}${efeito.toLocaleString('en-US')}% in the VIIRS/MODIS ratio for each typical variation` : 'no firm effect once the other factors are in (confidence interval crosses zero)'}</li>`;
  }).join('') : '';
  const descartados = f ? f.triagem.filter((t) => !t.mantido).map((t) => rotuloFator(t.fator)).join(', ') : '';
  const media = f ? f.media_anual_2003_2011 : null;
  document.getElementById('metodo-conteudo').innerHTML = `
    <p>The MODIS (2000 onward) and VIIRS (2012 onward) satellites cannot be compared directly: VIIRS has a 375 m pixel, against 1 km for MODIS, and sees smaller fires. In Bahia it counts about 6 times more hotspots. Without harmonization, the series shows a false jump in 2012.</p>
    <h3>What we do</h3>
    <p>In the years both sensors flew together, we divide the total VIIRS hotspots by the total MODIS Aqua hotspots for each calendar month. The months that only have MODIS (2003 to January 2012) are multiplied by that month's ratio. From February 2012 on, the series uses real VIIRS counts.</p>
    <ul>
      <li>type = 0 (vegetation fires only)</li>
      <li>MODIS with confidence 30 or more</li>
      <li>VIIRS without low confidence</li>
      <li>MODIS Aqua and VIIRS Suomi NPP pair (similar afternoon overpass time)</li>
    </ul>
    <h3>How well it works</h3>
    <p>Ratios learned from February 2012 to December 2019 and tested on 2020 to 2023, years the model never saw (${v.erro_mensal_48_meses_pct ? '44 valid months, without the months with satellite failures' : 'valid months'}). After the test, the published ratios were refit with the same method on February 2012 to December 2021.</p>
    <div class="metricas">
      <div><strong>${v.erro_mensal_wape_pct.toLocaleString('en-US')}%</strong><span>monthly error (WAPE), valid months</span></div>
      ${v.erro_mensal_48_meses_pct ? `<div><strong>${v.erro_mensal_48_meses_pct.toLocaleString('en-US')}%</strong><span>monthly error counting all 48 months</span></div>` : ''}
      <div><strong>${pct(v.vies_pct)}</strong><span>total bias</span></div>
      ${f ? `<div><strong>${f.cobertura_faixa_95.replace(' de ', ' of ')}</strong><span>test months inside the 95% band of the factor model</span></div>` : ''}
    </div>
    <p class="nota">Error in the total of each test year, valid months: ${anual}.${v.acerto_tres_faixas_pct ? ` Accuracy when classifying the month as below, normal or above: ${v.acerto_tres_faixas_pct.toLocaleString('en-US')}%.` : ''}</p>
    ${f ? `
    <h3>Why the relation between the satellites changes</h3>
    <p>A Poisson model per NASA POWER grid cell (about 55 x 68 km) and month, with weights for factors that only use data that existed before 2012 (MODIS and NASA POWER weather). It explains why the VIIRS/MODIS ratio changes and gives the 2003 to 2011 band.</p>
    <ul>${pesos}</ul>
    <p class="nota">Tested and discarded because they do not change the relation: ${descartados}. Test comparison: monthly ratio ${comp.T1.erro_mensal_pct.toLocaleString('en-US')}% error, factor model ${comp.modelo_v2.erro_mensal_pct.toLocaleString('en-US')}%. The main number uses the monthly ratio. <a href="#metodos" data-janela="metodos">See the comparison of the 7 methods tested</a>.</p>
    <h3>What we found before 2012</h3>
    <p>Before 2012 the two MODIS satellites disagree: Terra saw 0.47 hotspots for each Aqua hotspot in 2003 to 2011 and 0.72 from 2012 on (day and night together). According to Aqua, the past had more fire; according to Terra, the level was close to today's. That is why 2003 to 2011 is shown as a band.</p>
    <p class="nota">Mean per year from 2003 to 2011, in VIIRS-equivalent hotspots: ${fmt(media.t1_terra)} from Terra, ${fmt(media.fatores_aqua)} from the factor model and ${fmt(media.t1_aqua)} from the Aqua monthly ratio. Real VIIRS from 2012 to 2021: ${fmt(f.viirs_real_media_anual_2012_2021)} per year.</p>` : ''}
    <h3>Check against INPE</h3>
    <p>We compared the harmonized series with INPE's reference satellite series. That satellite is MODIS Aqua, the one we convert, so a high correlation alone proves little: raw Aqua correlates almost as well. The evidence is that the ratio between our series and INPE's stays about the same before and after 2012, while without harmonization it jumps in 2012. <a href="#inpe" data-janela="inpe">See the comparison</a>.</p>
    <h3>Smaller areas</h3>
    <p>When you choose a point or draw an area, the app adds up the NASA POWER grid cells (about 55 x 68 km) inside it, using the same rates calibrated for Bahia. The ${v.erro_mensal_wape_pct.toLocaleString('en-US')}% error is for the whole of Bahia; in the 2020 to 2023 test it was ${num1(erroEscala('bloco_4x4'))}% for areas of about 220 x 270 km, ${num1(erroEscala('bloco_2x2'))}% for about 110 x 135 km and ${num1(erroEscala('celula'))}% for one grid cell.</p>
    <h3>The method works elsewhere</h3>
    <p>The scripts recalibrate the rates for any country in the FIRMS archive. We ran the same test in 10 countries with very different fire regimes (Argentina, Australia, Bolivia, Canada, Chile, Indonesia, Mexico, Portugal, South Africa and the United States). On unseen years (2020 to 2023), the monthly ratio beat a single ratio in 8 of the 10 countries (plus Bahia) and in 9 of 10 when leaving one year out at a time. The error stayed between 6.6% and 10.6% in Mexico, South Africa, Australia, Argentina, Bolivia and the United States. It struggles where there is little fire (Portugal, a median of 99 VIIRS hotspots per month) and with record years outside the calibration (Canada 2023). The rates change a lot between regions (July: from 4.0 in Argentina to 14.5 in Canada), so they must be recalculated for each region, never copied.</p>
    <h3>Limitations</h3>
    <ul>
      <li>The main number is the monthly ratio, which had the lowest error among the simple methods on the test. The blend with the factor model erred a little less, but the difference may be chance. The factor model explains the variation and helps give the 2003 to 2011 band.</li>
      <li>From 2003 to 2011 the main number is the Aqua reading, almost always at the top of the band; the Terra reading gives less fire. Records and rankings from that period depend on this choice.</li>
      <li>From 2003 to 2011 there is no VIIRS to check against: the values for that period are estimates, so they come with a band.</li>
      <li>The normal for each month (median and the range between the 25th and 75th percentiles) uses the years measured by VIIRS, 2012 to 2025.</li>
      <li>The ${v.erro_mensal_wape_pct.toLocaleString('en-US')}% error is for the whole of Bahia. In smaller areas the error grows: in the 2020 to 2023 test it was ${num1(erroEscala('bloco_2x2'))}% for about 110 x 135 km and ${num1(erroEscala('celula'))}% for one grid cell. Before 2012 there is no VIIRS to measure it; the 2020 to 2023 error is the best reference.</li>
      <li>From 2022 on, the orbit of the Aqua satellite changed (it passes later), so the calibration only goes to 2021.</li>
      <li>The area is a rectangle, not the official border of Bahia. Only Bahia is processed in this version.</li>
      <li>Degraded days are only detected from 2012 on, when VIIRS exists to compare.</li>
      <li>2026 runs to ${fimTexto}. The months that come from FIRMS near real time data are provisional: they do not carry the hotspot type (they may include industrial sources, less than 1% in Bahia) and will change when the standard processing is released.</li>
    </ul>`;
}

function rodape() {
  document.getElementById('fonte').textContent = 'Source: NASA FIRMS (MODIS C6.1 Aqua; VIIRS 375 m Suomi NPP and NOAA-20), annual country files, standard processing; 2026 from the FIRMS area API. Weather and elevation: NASA POWER. Unit: VIIRS Suomi NPP 375 m equivalent hotspots.';
  document.getElementById('citacao').textContent = OFICIAL.citacao;
}

// ------------------------------------------------------------------ controles

function ligarControles() {
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-janela]');
    if (!el) return;
    ev.preventDefault();
    abrirJanela(el.dataset.janela);
  });
  document.querySelectorAll('dialog.janela').forEach((d) => {
    d.querySelector('.fechar').addEventListener('click', () => d.close());
    d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); });
    d.addEventListener('close', () => {
      if (!document.querySelector('dialog.janela[open]')) history.replaceState(null, '', location.pathname);
    });
  });
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
    abrirJanela('por-ano');
  });
  document.getElementById('usar-local').addEventListener('click', usarMinhaLocalizacao);
  document.getElementById('form-coordenada').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const lat = parseFloat(document.getElementById('lat-ponto').value);
    const lon = parseFloat(document.getElementById('lon-ponto').value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      document.getElementById('msg-area').textContent = 'Check the coordinate: latitude between -90 and 90, longitude between -180 and 180 (in Bahia, both are negative).';
      return;
    }
    definirArea({ tipo: 'ponto', lat, lon, raio: Number(document.getElementById('raio').value), origem: 'coordenada' });
  });
  document.querySelectorAll('.sel-ano-ini').forEach((s) => s.addEventListener('change', (e) => mudarPeriodo(Number(e.target.value), estado.anoFim)));
  document.querySelectorAll('.sel-ano-fim').forEach((s) => s.addEventListener('change', (e) => mudarPeriodo(estado.anoIni, Number(e.target.value))));
  document.querySelectorAll('.baixar-area').forEach((b) => b.addEventListener('click', baixarCsvArea));
  document.getElementById('bahia-inteira').addEventListener('click', () => definirArea({ tipo: 'bahia' }));
  document.getElementById('desenhar-area').addEventListener('click', iniciarDesenho);
  const diaFocos = document.getElementById('dia-focos');
  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);  // ontem no fuso de quem usa, não em UTC
  diaFocos.max = `${ontem.getFullYear()}-${String(ontem.getMonth() + 1).padStart(2, '0')}-${String(ontem.getDate()).padStart(2, '0')}`;
  diaFocos.value = '2007-09-10';
  document.getElementById('camada-focos').addEventListener('change', () => { if (!mapaL) abrirMapa(); atualizarCamadaFocos(); });
  document.getElementById('ver-focos-mapa').addEventListener('click', () => {
    const sel = document.getElementById('camada-focos');
    if (sel.value === 'recentes' && focosMapa.dados) return;
    sel.value = 'recentes';
    setTimeout(() => { if (!mapaL) abrirMapa(); atualizarCamadaFocos(); }, 80);
  });
  diaFocos.addEventListener('change', atualizarCamadaFocos);
  document.getElementById('sat-dia').addEventListener('change', atualizarCamadaFocos);
  document.getElementById('concluir-desenho').addEventListener('click', concluirDesenho);
  document.getElementById('desfazer-ponto').addEventListener('click', () => { desenho.pontos.pop(); atualizarDesenho(); });
  document.getElementById('cancelar-desenho').addEventListener('click', () => {
    encerrarDesenho();
    document.getElementById('msg-area').textContent = 'Drawing canceled.';
  });
  document.getElementById('raio').addEventListener('change', (e) => {
    if (estado.area.tipo === 'ponto') definirArea({ ...estado.area, raio: Number(e.target.value) });
  });
  document.getElementById('botao-tema').addEventListener('click', () => {
    const novo = temaAtual() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', novo);
    try { localStorage.setItem('tema', novo); } catch (e) { /* sem armazenamento */ }
    atualizarTudo();
  });
}

iniciar().catch((e) => {
  document.getElementById('cartoes').innerHTML = '<p>Could not load the data. Open the page through a web server (see the README).</p>';
  console.error(e);
});
