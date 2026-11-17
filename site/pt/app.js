/* Régua de Fogo: lê os dados harmonizados e desenha o painel e as janelas.
   Sem build: HTML, CSS e este arquivo. Bibliotecas: ECharts (gráficos) e Leaflet (mapa).
   Dados: data/calendario_bahia.json (série oficial da Bahia) e data/celulas_bahia.json (série por célula,
   para somar só a área em volta de um ponto). Últimos 7 dias: função api/recentes. */

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
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

const fmt = (n) => (n === null || n === undefined) ? 'sem dado' : Math.round(n).toLocaleString('pt-BR');
const pct = (n) => (n > 0 ? '+' : '') + n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
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
  OFICIAL = await (await fetch('../data/calendario_bahia.json')).json();
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
  if (a.tipo === 'poligono') return 'Área desenhada';
  const rotulo = { local: 'Perto de você', mapa: 'Ponto escolhido', coordenada: 'Coordenada escolhida' }[a.origem] || 'Ponto escolhido';
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
    const r = await fetch('../data/celulas_bahia.json');
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
const TAMANHO_AREA = { celula: 'uma célula da grade (cerca de 55 x 68 km)', bloco_2x2: 'áreas de cerca de 110 x 135 km', bloco_4x4: 'áreas de cerca de 220 x 270 km' };
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
      nome: nomeArea(), descricao: `${cels.length} células da grade NASA POWER`,
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
      msgJanela.textContent = 'Não foi possível carregar as células da grade. Recarregue a página e tente de novo.';
      aviso.textContent = 'Não foi possível carregar as células da grade. Recarregue a página e tente de novo.';
      return;
    }
    const { cels, pequena } = celulasDaArea(nova);
    if (cels.length === 0) {
      estado.area = { tipo: 'bahia' };
      DADOS = OFICIAL;
      const txt = (nova.tipo === 'poligono' ? 'Essa área fica' : 'Esse ponto fica') + ' fora da área processada nesta versão (Bahia). Mostrando a Bahia inteira.';
      aviso.textContent = nova.origem === 'local'
        ? 'Você está fora da área processada nesta versão (Bahia). Mostrando a Bahia inteira; dá para escolher um ponto no chip de área, no topo.'
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
    const extra = (pequena ? ' A área desenhada é menor que uma célula da grade, então entra a célula mais próxima (cerca de 55 x 68 km).' : '')
      + (eaAviso ? ` Antes de 2012 a conversão usa a taxa da Bahia inteira: no teste de 2020 a 2023, o erro por mês em ${TAMANHO_AREA[eaAviso.escala]} foi de cerca de ${Math.round(eaAviso.erro_mensal_wape_pct)}%.` : '')
      + (mediaAnual < 3000 ? ' Área com poucos focos: os números variam mais.' : '');
    aviso.textContent = (mensagem || `Mostrando ${nomeArea().toLowerCase()}: ${cels.length} células da grade (cerca de 55 x 68 km cada).`) + extra;
    msgJanela.textContent = `${cels.length} ${cels.length === 1 ? 'célula' : 'células'} da grade ${nova.tipo === 'poligono' ? 'dentro do contorno' : 'dentro do raio'} (em azul no mapa).` + extra;
  } else {
    estado.area = { tipo: 'bahia' };
    DADOS = OFICIAL;
    aviso.textContent = mensagem || '';
    msgJanela.textContent = 'Mostrando a Bahia inteira.';
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
  if (!('geolocation' in navigator)) { msg.textContent = 'Este navegador não informa a localização.'; return; }
  msg.textContent = 'Buscando sua localização...';
  pedirLocalizacao(() => { msg.textContent = 'Não foi possível usar a localização (permissão negada ou indisponível). Toque no mapa para escolher um ponto.'; });
}

function atualizarTextosArea() {
  const nome = nomeArea();
  document.querySelectorAll('.nome-area').forEach((el) => { el.textContent = nome; });
  document.getElementById('titulo-area').textContent = estado.area.tipo === 'bahia'
    ? 'a Bahia'
    : (estado.area.tipo === 'poligono' ? 'essa área' : (estado.area.origem === 'local' ? 'perto de você' : 'esse lugar'));
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
  document.getElementById('hero-meses').textContent = cap(MESES_LONGO[top2[0]]) + ' e ' + MESES_LONGO[top2[1]];
  document.getElementById('hero-pct').textContent = Math.round((vals[top2[0]] + vals[top2[1]]) / total * 100) + '%';
  g.setOption({
    animationDuration: 700,
    grid: { left: 8, right: 8, top: 18, bottom: 22 },
    tooltip: { trigger: 'item', confine: true, formatter: (p) => `<strong>${MESES_LONGO[p.dataIndex]}</strong><br>mediana de ${fmt(p.value)} focos<br><span style="opacity:.75">clique para ver o mês ao longo dos anos</span>` },
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
      label: { show: true, position: 'top', fontSize: 10, color: css('--texto-suave'), formatter: (p) => (p.dataIndex + 1 === MES_ATUAL ? 'agora' : '') },
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
  document.getElementById('agora-titulo').textContent = `Agora: ${nomeMes} de ${ANO_ATUAL}`;
  document.getElementById('agora-normal').textContent =
    `Normal de ${nomeMes}: ${fmt(porDia(nm.mediana[chave]))} focos por dia (mediana dos anos medidos pelo VIIRS, 2012 a 2025; faixa normal de ${fmt(porDia(nm.p25[chave]))} a ${fmt(porDia(nm.p75[chave]))}${nm.media ? `; média de ${fmt(porDia(nm.media[chave]))}` : ''}). Esperado para o mês inteiro: cerca de ${fmt(nm.mediana[chave])} focos.`;
  try {
    let url = '../api/recentes';
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
    document.getElementById('agora-unidade').textContent = 'focos por dia';
    tag.textContent = classe;
    tag.className = 'tag ' + classeTag(classe);
    document.getElementById('agora-comparacao').textContent = `${pct(Math.round((media - med) / med * 1000) / 10)} em relação à mediana de ${nomeMes}`;
    const dm = (d) => d.data.slice(8, 10) + '/' + d.data.slice(5, 7);
    const atual = j.atualizado_em ? new Date(j.atualizado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    document.getElementById('agora-fonte').textContent = `Média dos últimos ${dias.length} dias completos (${dm(dias[0])} a ${dm(dias[dias.length - 1])}) contra o normal de ${nomeMes}. Fonte: NASA FIRMS, VIIRS NOAA-20 em quase tempo real, convertido para a régua do histórico${atual ? '; arquivo de ' + atual : ''}. Dado provisório; a série do calendário vai até ${MESES_LONGO[Number(OFICIAL.periodo.fim.slice(5, 7)) - 1]} de ${OFICIAL.periodo.fim.slice(0, 4)}.`;
  } catch (e) {
    if (meuPedido !== pedidoAgora) return;
    document.getElementById('agora-valor').textContent = fmt(porDia(nm.mediana[chave]));
    document.getElementById('agora-unidade').textContent = 'focos por dia num ' + nomeMes + ' típico';
    tag.textContent = 'esperado';
    tag.className = 'tag normal';
    document.getElementById('agora-comparacao').textContent = 'Os dados dos últimos dias não carregaram agora.';
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
      <p class="rotulo">Último mês da série: ${MESES_LONGO[ultimo.mes_num - 1]} de ${ultimo.ano}${ultimo.qualidade === 'provisorio' ? ' (provisório)' : ''}</p>
      <p class="valor">${fmt(ultimo.focos)} focos</p>
      <p class="detalhe"><span class="tag ${classeTag(ultimo.classe)}">${ultimo.classe}</span> ${pct(ultimo.anomalia_pct)} da mediana de ${MESES_LONGO[ultimo.mes_num - 1]}; ${ultimo.posicao_no_mes}º de ${nMesmoMes} desde 2003.</p>
    </article>`,
    `<article class="cartao">
      <p class="rotulo">Ano com mais fogo</p>
      <p class="valor">${pico.ano}</p>
      <p class="detalhe">${fmt(pico.focos)} focos${pico.faixa_inferior ? ` (estimativa, entre ${fmt(pico.faixa_inferior)} e ${fmt(pico.faixa_superior)})` : ''}. Pico em ${MESES_LONGO[Number(pico.mes_pico.slice(5, 7)) - 1]}.</p>
    </article>`,
    `<article class="cartao">
      <p class="rotulo">${ultimoAno.ano} contra 2013 a ${ultimoAno.ano - 1}</p>
      <p class="valor">${pct(Math.round(difAno * 10) / 10)}</p>
      <p class="detalhe">${fmt(ultimoAno.focos)} focos no ano, contra média de ${fmt(mediaViirs)}.</p>
    </article>`,
    estado.area.tipo === 'bahia'
      ? `<article class="cartao">
      <p class="rotulo">Precisão da conversão</p>
      <p class="valor">${val.erro_mensal_wape_pct.toLocaleString('pt-BR')}%</p>
      <p class="detalhe">de erro por mês em anos que o modelo não viu (2020 a 2023), com desvio de ${pct(val.vies_pct)} no total.</p>
    </article>`
      : `<article class="cartao">
      <p class="rotulo">Precisão nesta escala</p>
      <p class="valor">${ea ? `cerca de ${Math.round(ea.erro_mensal_wape_pct)}%` : 'menor'}</p>
      <p class="detalhe">${ea ? `de erro por mês medido em 2020 a 2023 em ${TAMANHO_AREA[ea.escala]}` : 'áreas menores têm erro maior'}; é a melhor referência para os anos convertidos antes de 2012. Na Bahia inteira o erro é de ${val.erro_mensal_wape_pct.toLocaleString('pt-BR')}%. De 2012 em diante a área usa o VIIRS medido.</p>
    </article>`,
  ].join('');
}

// ------------------------------------------------------------------ gráficos das janelas

function tooltipMes(m) {
  let t = `<strong>${MESES_LONGO[m.mes_num - 1]} de ${m.ano}</strong><br>`;
  if (m.faixa_inferior !== null && m.faixa_inferior !== undefined) {
    t += `${fmt(m.focos)} focos (estimativa)<br>faixa: ${fmt(m.faixa_inferior)} a ${fmt(m.faixa_superior)}<br>`;
  } else {
    t += `${fmt(m.focos)} focos<br>`;
  }
  t += `${pct(m.anomalia_pct)} da mediana do mês (${m.classe})<br>`;
  const media = DADOS.normal_por_mes.media && DADOS.normal_por_mes.media[String(m.mes_num).padStart(2, '0')];
  if (media) t += `${pct(Math.round((m.focos - media) / media * 1000) / 10)} da média dos anos medidos pelo VIIRS<br>`;
  t += `${m.posicao_no_mes}º ${MESES_LONGO[m.mes_num - 1]} com mais fogo desde 2003<br>`;
  t += `<span style="opacity:.75">origem: ${m.origem}${m.qualidade === 'corrigido' ? ', mês corrigido' : ''}${m.qualidade === 'provisorio' ? ', dado provisório (quase tempo real)' : ''}</span>`;
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
    ? { min: Math.floor(Math.min(...vals) * 10) / 10, max: Math.ceil(Math.max(...vals) * 10) / 10, inRange: { color: INFERNO }, formatter: (v) => fmt(Math.pow(10, v)), text: ['mais focos', 'menos focos'] }
    : { min: -2, max: 2, inRange: { color: DIVERGENTE }, formatter: (v) => (v >= 0 ? '+' : '') + Math.round((Math.pow(2, v) - 1) * 100) + '%', text: ['acima do normal', 'abaixo do normal'] };
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
    { name: 'Faixa (2003 a 2011)', type: 'line', data: anos.map((a) => (a.faixa_inferior ? a.faixa_superior - a.faixa_inferior : null)), stack: 'faixa', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(56,189,248,.25)' }, tooltip: { show: false }, silent: true },
    { name: 'Focos harmonizados', type: 'line', data: anos.map((a) => a.focos), symbolSize: 6, lineStyle: { width: 3, color: css('--destaque') }, itemStyle: { color: css('--destaque') } },
  ];
  if (brutos) {
    // série "ingênua": o que se vê juntando os dados sem harmonizar (MODIS até 2011, VIIRS de 2012 em diante)
    const ingenua = anos.map((a) => DADOS.meses.filter((m) => m.ano === a.ano)
      .reduce((s, m) => s + (m.viirs_real !== null && m.viirs_real !== undefined ? m.viirs_real : (m.modis_bruto || 0)), 0));
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
    xAxis: { type: 'category', data: anos.map((a) => String(a.ano)), axisLabel: { color: css('--texto-suave') } },
    yAxis: { type: 'value', axisLabel: { color: css('--texto-suave'), formatter: (v) => (v >= 1000 ? Math.round(v / 1000) + ' mil' : v) }, splitLine: { lineStyle: { color: css('--borda') } } },
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
    yAxis: { type: 'value', axisLabel: { color: css('--texto-suave'), formatter: (v) => (v >= 1000 ? Math.round(v / 1000) + ' mil' : v) }, splitLine: { lineStyle: { color: css('--borda') } } },
    series: [{
      type: 'bar',
      data: ms.map((m) => ({ value: m.focos, itemStyle: { color: cor(m), decal: m.faixa_inferior ? { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: Math.PI / 4, color: 'rgba(255,255,255,.35)' } : undefined } })),
      markArea: { silent: true, itemStyle: { color: 'rgba(148,163,184,.18)' }, data: [[{ yAxis: normal.p25[chave] }, { yAxis: normal.p75[chave] }]] },
      markLine: {
        silent: true, symbol: 'none',
        data: [
          { yAxis: normal.mediana[chave], lineStyle: { color: css('--texto'), type: 'dashed' }, label: { position: 'insideEndTop', formatter: 'mediana ' + fmt(normal.mediana[chave]), color: css('--texto-suave') } },
          ...(normal.media ? [{ yAxis: normal.media[chave], lineStyle: { color: css('--destaque'), type: 'dotted', width: 2 }, label: { position: 'insideStartTop', formatter: 'média ' + fmt(normal.media[chave]), color: css('--destaque') } }] : []),
        ],
      },
    }],
  }, true);
}

function topDez() {
  document.getElementById('lista-top').innerHTML = DADOS.top10_meses.map((t) => {
    const m = DADOS.meses.find((x) => x.mes === t.mes);
    const est = m.faixa_inferior ? ` <span class="est">(estimativa: ${fmt(m.faixa_inferior)} a ${fmt(m.faixa_superior)})</span>` : '';
    return `<li><strong>${MESES_LONGO[m.mes_num - 1]} de ${m.ano}</strong>: ${fmt(m.focos)} focos${est}</li>`;
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
  const linhas = [['mes', 'focos_harmonizados', 'faixa_inferior', 'faixa_superior', 'origem', 'anomalia_pct_vs_mediana', 'classe', 'posicao_no_mes']];
  noPeriodo(DADOS.meses).forEach((m) => linhas.push([
    m.mes, m.focos, m.faixa_inferior ?? '', m.faixa_superior ?? '', m.origem, String(m.anomalia_pct).replace('.', ','), m.classe, m.posicao_no_mes,
  ]));
  const texto = '\ufeff' + linhas.map((l) => l.map((c) => (/[;"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(';')).join('\n');
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
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: '&copy; colaboradores do OpenStreetMap' }).addTo(mapaL);
    camadas.bahia = L.rectangle([[a.lat_min, a.lon_min], [a.lat_max, a.lon_max]], { color: '#d9480f', weight: 2, fillOpacity: 0.04, dashArray: '4 4' }).addTo(mapaL);
    camadas.bahia.bindTooltip('Área processada nesta versão: ' + a.descricao);
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

const CORES_IDADE = [['#d7191c', 'menos de 24 h'], ['#fdae61', '1 a 3 dias'], ['#ffd34d', '3 a 7 dias']];
const COR_DIA = { modis: '#d7191c', viirs: '#f57c00' };

function celulaDoPonto(lat, lon) {
  const i = Math.round((lat + 18.5) / 0.5);
  const j = Math.round((lon + 46.875) / 0.625);
  return 'L' + String(i).padStart(2, '0') + 'C' + String(j).padStart(2, '0');
}

function dataBr(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4); }

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
  let url = '../api/pontos?modo=recentes';
  if (sel === 'dia') {
    const dia = document.getElementById('dia-focos').value;
    if (!dia) { msg.textContent = 'Escolha um dia.'; return; }
    url = `../api/pontos?modo=dia&data=${dia}&sat=${document.getElementById('sat-dia').value}`;
  }
  msg.textContent = 'Buscando os focos na NASA...';
  try {
    const r = await fetch(url);
    const j = await r.json();
    if (meuPedido !== focosMapa.pedido) return;
    if (!r.ok) { msg.textContent = j.erro || 'Não foi possível buscar os focos agora.'; return; }
    focosMapa.dados = j;
    const render = L.canvas({ padding: 0.3 });
    camadas.focos = L.layerGroup(j.pontos.map((p) => L.circleMarker([p[0], p[1]], {
      renderer: render, radius: 3, weight: 0.5, color: '#3a1a00', fillColor: corDoPonto(p), fillOpacity: 0.9,
    }).bindPopup(`<strong>${dataBr(p[2])}, ${p[3].slice(0, 2)}h${p[3].slice(2, 4)} UTC</strong><br>potência do fogo (FRP): ${String(p[4]).replace('.', ',')} MW<br>satélite: ${p[5]}`))).addTo(mapaL);
    legenda.innerHTML = sel === 'dia'
      ? `<span><i style="background:${COR_DIA[j.sat]}"></i>${j.sat === 'modis' ? 'MODIS (Aqua e Terra)' : 'VIIRS'}, ${dataBr(j.data)}</span>`
      : CORES_IDADE.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
    contagemFocos();
  } catch (e) {
    if (meuPedido === focosMapa.pedido) msg.textContent = 'Não foi possível buscar os focos agora.';
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
    naArea = ` ${fmt(k)} na área escolhida.`;
  }
  if (focosMapa.modo === 'dia') {
    let txt = `${fmt(n)} focos na Bahia em ${dataBr(j.data)}.${naArea}`;
    if (j.sat === 'modis') {
      const taxa = OFICIAL.metodo.taxa_por_mes[j.data.slice(5, 7)];
      const nAqua = j.pontos.filter((p) => p[5] === 'Aqua').length;  // a taxa foi calibrada só com o Aqua
      txt += ` Na régua do VIIRS, os ${fmt(nAqua)} focos do Aqua vezes a taxa de ${MESES_LONGO[Number(j.data.slice(5, 7)) - 1]} (${num1(taxa)}) dão cerca de ${fmt(nAqua * taxa)} na Bahia (a taxa foi calibrada só com o Aqua). Num dia só, a conversão varia mais que no mês.`;
    }
    msg.textContent = txt + ` Fonte: ${j.fonte}. Toque num ponto para ver hora e potência.`;
  } else {
    msg.textContent = `${fmt(n)} focos na Bahia nos últimos 7 dias.${naArea} Fonte: ${j.fonte}. Toque num ponto para ver hora e potência.`;
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
  document.getElementById('msg-area').textContent = 'Toque no mapa para marcar os cantos da área. Com 3 pontos ou mais, clique em "Concluir área".';
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
    document.getElementById('msg-area').textContent = `${pts.length} ${pts.length === 1 ? 'ponto marcado' : 'pontos marcados'}.` + (pts.length < 3 ? ' Marque pelo menos 3.' : ' Clique em "Concluir área" ou continue marcando.');
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

const num1 = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const num3 = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const num2b = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ORDEM_METODOS = ['taxa_unica', 'taxa_por_mes', 'quadradinhos', 'ranking', 'formula_pesos', 'terra', 'mistura'];

function textosMetodos(d) {
  const r = d.metodos;
  const t1 = r.taxa_por_mes;
  const taxa = OFICIAL.metodo.taxa_por_mes;
  const peso = Math.round(d.peso_mistura_taxa_por_mes * 100);
  const nAnos = Object.keys(t1.um_ano_fora_por_ano).length;
  return {
    taxa_unica: {
      nome: 'Uma taxa só para o ano todo', curto: 'Taxa única', tag: ['descartado', 'descartado'],
      como: 'Um número só: o total de focos do VIIRS dividido pelo do MODIS Aqua nos anos em que os dois funcionaram juntos.',
      veredito: 'Usa a mesma taxa na seca e na chuva. Na chuva o fogo é pequeno e o VIIRS enxerga bem mais que o MODIS, então a taxa única erra nesses meses.',
    },
    taxa_por_mes: {
      nome: 'Uma taxa para cada mês do ano', curto: 'Taxa por mês', tag: ['usado', 'usado no site'],
      como: `Para cada mês do ano, quantos focos o VIIRS vê para cada foco do MODIS Aqua. Em setembro, na seca, são ${num1(taxa['09'])}; em janeiro, na chuva, ${num1(taxa['01'])}. O dado antigo é multiplicado pela taxa do seu mês.`,
      veredito: `Menor erro entre os métodos usados sozinhos, e continuou perto de ${num1(t1.um_ano_fora_erro_pct)}% escondendo cada ano. São 12 números que qualquer pessoa confere numa planilha.`,
    },
    quadradinhos: {
      nome: 'Contar lugares com fogo em vez de focos', curto: 'Quadradinhos *', tag: ['descartado', 'teste de robustez'],
      como: 'Divide o mapa em quadradinhos de uns 5,5 km e conta quantos tiveram fogo em cada dia. Depois aplica uma taxa por mês.',
      veredito: `Quando o fogo é denso, o quadradinho já está aceso e para de contar. Errou mais em anos novos e nos anos de deriva do Aqua (${num1(r.quadradinhos.deriva_erro_pct)}%), e o número não se compara com as contagens oficiais de focos.`,
    },
    ranking: {
      nome: 'Converter pela posição no ranking', curto: 'Posição no ranking', tag: ['descartado', 'descartado'],
      como: 'Um mês que ficou entre os 30% mais fortes do MODIS recebe o valor dos 30% mais fortes do VIIRS.',
      veredito: `Decorou os dados: errou ${num1(r.ranking.anos_que_viu_erro_pct)}% nos anos que já tinha visto e ${num1(r.ranking.teste_erro_pct)}% nos que não tinha. Os anos recordes antes de 2012 passam do maior valor que ele conhece.`,
    },
    formula_pesos: {
      nome: 'Fórmula com pesos (pedido da mentoria)', curto: 'Fórmula com pesos', tag: ['faixa', 'usado na faixa'],
      como: 'Uma fórmula estatística que ajusta a taxa pela intensidade do fogo, pela parte de focos noturnos, chuva, umidade, temperatura e altitude, com dados da NASA POWER.',
      veredito: `Explica por que a taxa muda e manteve os mesmos fatores em todos os testes, mas não errou menos que a taxa por mês (${num1(r.formula_pesos.teste_erro_pct)}% contra ${num1(t1.teste_erro_pct)}%). Nos anos de deriva do Aqua errou menos (${num1(r.formula_pesos.deriva_erro_pct)}% contra ${num1(t1.deriva_erro_pct)}%). Entra na faixa de 2003 a 2011.`,
    },
    terra: {
      nome: 'Converter a partir do MODIS Terra', curto: 'Taxa pelo Terra', tag: ['faixa', 'usado na faixa'],
      como: 'A mesma taxa por mês, mas partindo do MODIS Terra em vez do Aqua.',
      veredito: `Errou ${num1(r.terra.teste_erro_pct)}% no teste. O Terra passa de manhã e o Aqua à tarde, quase no horário do VIIRS. Antes de 2012 os dois MODIS discordam, por isso o Terra entra na faixa de incerteza.`,
    },
    mistura: {
      nome: 'Misturar a taxa por mês com a fórmula', curto: `Mistura ${peso}/${100 - peso}`, tag: ['promissor', 'próximo passo'],
      como: `${peso}% da taxa por mês e ${100 - peso}% da fórmula com pesos. A proporção foi otimizada com validação cruzada só em 2013 a 2019 (o peso com menor erro em previsões às cegas), sem olhar o teste.`,
      veredito: `Teve o menor erro (${num1(r.mistura.teste_erro_pct)}%) e ganhou da taxa por mês em ${r.mistura.anos_que_ganha_da_taxa_por_mes} de ${nAnos} anos, mas a diferença é de ${num1(t1.teste_erro_pct - r.mistura.teste_erro_pct)} ponto e ainda pode ser acaso. Por isso o número principal não mudou.`,
    },
  };
}

async function comparacaoMetodos() {
  if (!METODOS) {
    try {
      METODOS = await (await fetch('../data/metodos.json')).json();
    } catch (e) {
      document.getElementById('metodos-intro').innerHTML = '<p>Não foi possível carregar a comparação.</p>';
      return;
    }
  }
  const d = METODOS;
  const r = d.metodos;
  const tx = textosMetodos(d);
  const t1 = r.taxa_por_mes;
  const nAnos = Object.keys(t1.um_ano_fora_por_ano).length;
  document.getElementById('metodos-intro').innerHTML = `
    <p>Para escolher a conversão, colocamos todos os métodos na mesma prova. Cada um aprendeu só com ${d.periodos.calibracao_teste[0].slice(0, 4)} a 2019 e tentou adivinhar 2020 a 2023, anos que não tinha visto. Depois comparamos com o que o VIIRS mediu de verdade. Para conferir que não foi sorte do período, repetimos escondendo um ano de cada vez, de ${d.periodos.um_ano_fora[0]} a ${d.periodos.um_ano_fora[1]}.</p>
    <p class="nota">Erro: quanto a conversão errou por mês, em média, contra o VIIRS real (WAPE, em %). Quanto menor, melhor. Mesmos ${t1.teste_n_meses} meses de teste para todos.</p>`;

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
      { name: 'Teste 2020 a 2023', type: 'bar', barGap: '15%', itemStyle: { color: css('--destaque'), borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', fontSize: fonte, color: css('--texto'), formatter: (p) => num1(p.value) + '%' },
        data: ordem.map((k) => r[k].teste_erro_pct) },
      { name: `Escondendo um ano de cada vez (${nAnos} anos)`, type: 'bar', itemStyle: { color: css('--destaque-2'), opacity: 0.75, borderRadius: [0, 4, 4, 0] },
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
        <span><strong>${num1(m.teste_erro_pct)}%</strong>no teste</span>
        <span><strong>${num1(m.um_ano_fora_erro_pct)}%</strong>escondendo cada ano</span>
        <span><strong>${num1(m.anos_que_viu_erro_pct)}%</strong>nos anos que viu</span>
      </div>
      <p class="veredito">${t.veredito}</p>
    </article>`;
  }).join('');

  const c = d.correlacao_ordem_dos_meses;
  document.getElementById('metodos-conclusao').innerHTML = `
    <h3>Por que o site usa a taxa por mês</h3>
    <ul>
      <li><strong>Menor erro entre os métodos usados sozinhos:</strong> ${num1(t1.teste_erro_pct)}% no teste e ${num1(t1.um_ano_fora_erro_pct)}% escondendo um ano de cada vez.</li>
      <li><strong>Não decora:</strong> erra ${num1(t1.anos_que_viu_erro_pct)}% nos anos que viu e ${num1(t1.teste_erro_pct)}% nos que não viu. A posição no ranking ia de ${num1(r.ranking.anos_que_viu_erro_pct)}% para ${num1(r.ranking.teste_erro_pct)}%.</li>
      <li><strong>Simples de conferir:</strong> 12 números, um por mês, que qualquer pessoa refaz numa planilha.</li>
      <li><strong>Faz sentido físico:</strong> a taxa sobe na chuva, quando o fogo é pequeno e o VIIRS enxerga mais do que o MODIS.</li>
      <li><strong>Vale para qualquer área:</strong> as mesmas 12 taxas são usadas quando você escolhe um ponto no mapa.</li>
    </ul>
    <h3>E a mistura, que errou menos?</h3>
    <p>Ela ganhou por pouco: ${num1(r.mistura.teste_erro_pct)}% contra ${num1(t1.teste_erro_pct)}% no teste, e em ${r.mistura.anos_que_ganha_da_taxa_por_mes} de ${nAnos} anos. Com tão poucos anos de dado, uma diferença desse tamanho ainda pode ser acaso, e o site ainda não calcula a fórmula com pesos para cada área do mapa. Por isso o número principal segue com a taxa por mês e a mistura fica como próximo teste.</p>
    <h3>Conferência de fora</h3>
    <p>Comparamos a série convertida com a do satélite de referência do INPE, que não passa pela nossa conversão. O desenho dos anos bate e o salto de 2012 some. <a href="#inpe" data-janela="inpe">Veja a conferência com o INPE</a>.</p>
    <h3>Correlação não é prova</h3>
    <p>A ordem dos meses, do mais fraco ao mais forte, tem correlação de ${num3(c.taxa_por_mes)} com a taxa por mês. Mas o Aqua sem conversão nenhuma já chega a ${num3(c.aqua_sem_conversao)}, porque seca e chuva mandam no ano. Por isso medimos pelo erro em focos, não pela correlação.</p>
    <p class="nota">* ${d.notas.join(' ')} Os anos de 2024 e 2025 ficam fora da escolha porque a órbita do Aqua mudou; o erro de cada método nesses anos está no JSON.</p>`;
}

// ------------------------------------------------------------------ conferência com o INPE

async function comparacaoInpe() {
  if (!INPE) {
    try {
      INPE = await (await fetch('../data/inpe.json')).json();
    } catch (e) {
      document.getElementById('inpe-intro').innerHTML = '<p>Não foi possível carregar a comparação.</p>';
      return;
    }
  }
  const d = INPE;
  const r = d.resumo;
  const anos = d.anos;
  const num2 = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const iguais = (a, b) => a[0] === b[0];
  document.getElementById('inpe-intro').innerHTML = `
    <p>O INPE publica os focos de um <strong>satélite de referência</strong>, o mesmo desde 2003, justamente para comparar anos. É uma série que não passa pela nossa conversão. Se a harmonização estiver certa, as duas séries têm que subir e descer juntas, sem salto em 2012.</p>
    <div class="metricas">
      <div><strong>${num3(r.correlacao_anual)}</strong><span>correlação ano a ano com o INPE (sem harmonizar: ${num2(r.correlacao_anual_sem_harmonizar)})</span></div>
      <div><strong>${num3(r.correlacao_mensal)}</strong><span>correlação mês a mês</span></div>
      <div><strong>${r.mes_pico_igual} de ${r.n_anos}</strong><span>anos com o mesmo mês de pico</span></div>
      <div><strong>${r.top5_inpe[0]}</strong><span>${iguais(r.top5_inpe, r.top5_nossa) ? 'ano com mais fogo nas duas séries' : 'ano com mais fogo no INPE (nosso: ' + r.top5_nossa[0] + ')'}</span></div>
    </div>`;

  const nomes = { inpe: 'INPE, satélite de referência', nossa: 'Régua de Fogo (harmonizada)', crua: 'Sem harmonizar' };
  const cores = { inpe: css('--abaixo'), nossa: css('--destaque'), crua: '#94a3b8' };
  const eixo = (fmtY) => ({
    xAxis: { type: 'category', data: anos.map((a) => String(a.ano)), axisLabel: { color: css('--texto-suave') } },
    yAxis: { type: 'value', axisLabel: { color: css('--texto-suave'), formatter: fmtY }, splitLine: { lineStyle: { color: css('--borda') } } },
  });
  const marca2012 = { silent: true, symbol: 'none', lineStyle: { color: css('--texto-suave'), type: 'dotted' }, label: { formatter: 'chega o VIIRS', color: css('--texto-suave') }, data: [{ xAxis: '2012' }] };
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
      return `<strong>${a.ano}</strong><br>INPE: ${fmt(a.inpe)} focos<br>Régua de Fogo: ${fmt(a.nossa)} focos<br>Sem harmonizar: ${fmt(a.sem_harmonizar)} focos<br><span style="opacity:.75">índice: ${ps.map((p) => p.seriesName.split(' ')[0] + ' ' + Math.round(p.value)).join(' · ')}</span>`;
    } },
    ...eixo((v) => v),
    series: [linha('inpe', 'indice_inpe', { markLine: marca2012 }), linha('nossa', 'indice_nossa'), linha('crua', 'indice_sem_harmonizar')],
  }, true);

  const g2 = graficos.inpeRazao || echarts.init(document.getElementById('graf-inpe-razao'));
  graficos.inpeRazao = g2;
  g2.setOption({
    animation: false, legend: { ...legenda, data: [nomes.nossa, nomes.crua] },
    grid: { left: 48, right: 16, top: estreito ? 70 : 56, bottom: 28 },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: (v) => num1(v) + ' focos para cada foco do INPE' },
    ...eixo((v) => v + 'x'),
    series: [linha('nossa', 'razao_nossa_inpe', { markLine: marca2012 }), linha('crua', 'razao_sem_harmonizar_inpe')],
  }, true);

  const h = anos.filter((a) => a.hora_utc_mais_comum_inpe !== null);
  const ultimoAntes = h.filter((a) => a.hora_utc_mais_comum_inpe === h[0].hora_utc_mais_comum_inpe).pop();
  const depois = h.filter((a) => a.ano > ultimoAntes.ano);
  document.getElementById('inpe-leitura').innerHTML = `
    <h3>O que a comparação mostra</h3>
    <ul>
      <li><strong>O salto de 2012 some.</strong> Sem harmonizar, a nossa contagem passa de ${num1(r.razao_sem_harmonizar_2011)} para ${num1(r.razao_sem_harmonizar_2012)} focos para cada foco do INPE de 2011 para 2012, um salto de ${num1(r.salto_sem_harmonizar_vezes)} vezes só pela troca de satélite. Harmonizada, fica em ${num1(r.razao_media_2003_2011)} de 2003 a 2011 e ${num1(r.razao_media_2012_2021)} de 2012 a 2021: sobra uma diferença de ${num1(r.diferenca_entre_periodos_pct)}%.</li>
      <li><strong>Os anos sobem e descem juntos, mas isso sozinho não prova nada.</strong> Correlação de ${num3(r.correlacao_anual)} ano a ano e ${num3(r.correlacao_mensal)} mês a mês. O MODIS Aqua cru, sem conversão nenhuma, já chega a ${num3(r.correlacao_anual_aqua_sem_conversao)}, porque o satélite de referência do INPE é o próprio Aqua. O que a comparação mostra de fato é o item acima: o salto de 2012 some. Emendando MODIS até 2011 e VIIRS depois, sem harmonizar, a correlação cai para ${num2(r.correlacao_anual_sem_harmonizar)}.</li>
      <li><strong>Os piores anos coincidem.</strong> Cinco anos com mais fogo no INPE: ${r.top5_inpe.join(', ')}. Na Régua de Fogo: ${r.top5_nossa.join(', ')}.</li>
      ${depois.length ? `<li><strong>A mudança de órbita do Aqua aparece no INPE também.</strong> A hora mais comum das passagens era ${h[0].hora_utc_mais_comum_inpe}h UTC até ${ultimoAntes.ano} e passa a ${depois[0].hora_utc_mais_comum_inpe}h UTC em ${depois.map((a) => a.ano).join(' e ')}. É a mesma deriva que encontramos nos dados da NASA, confirmada por outra fonte.</li>` : ''}
    </ul>
    <h3>Como ler</h3>
    <ul>
      <li>O INPE conta bem menos focos que a nossa série: usa outro processamento e só os focos dentro do contorno oficial do estado. Nós usamos um retângulo em volta da Bahia, que pega pedaços dos estados vizinhos. Por isso a comparação é do desenho da série, não do número absoluto.</li>
      <li>A hora das passagens, por volta das 13h30 na Bahia, indica que o satélite de referência é o MODIS Aqua, o mesmo que usamos como base. Por isso a conferência confirma a forma da série, mas não resolve a diferença entre o Aqua e o Terra antes de 2012. A faixa de incerteza desse período continua.</li>
    </ul>
    <p class="nota">Fonte: ${d.fonte}, <a href="${d.url_fonte}" target="_blank" rel="noopener">dataserver-coids.inpe.br</a>. Contagem dos focos com estado igual a Bahia, de 2003 a 2025.</p>`;
}

// ------------------------------------------------------------------ detectados e relatados

async function detectadosRelatados() {
  if (!RELATADOS) {
    try {
      RELATADOS = await (await fetch('../data/relatados.json')).json();
    } catch (e) {
      document.getElementById('relatados-intro').innerHTML = '<p>Não foi possível carregar os registros.</p>';
      return;
    }
  }
  const d = RELATADOS;
  const [a0, a1] = d.anos_com_cobertura;
  const num2 = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('relatados-intro').innerHTML = `
    <p><strong>Detectado</strong> é o foco de calor que o satélite vê. <strong>Relatado</strong> é o incêndio que uma brigada registrou em solo, com data, local, causa e área queimada. Aqui comparamos a nossa série com os Registros de Ocorrência de Incêndio (ROI) das brigadas do IBAMA (Prevfogo) na Bahia.</p>
    <div class="metricas">
      <div><strong>${fmt(d.media_ocorrencias_por_ano)}</strong><span>incêndios relatados por ano (${a0} a ${a1})</span></div>
      <div><strong>${fmt(d.media_focos_por_ano)}</strong><span>focos detectados por ano no mesmo período</span></div>
      <div><strong>${fmt(d.focos_por_ocorrencia)}</strong><span>focos detectados para cada incêndio relatado</span></div>
      <div><strong>${d.detectados_por_satelite} de ${fmt(d.total_ocorrencias)}</strong><span>registros em que o fogo foi achado por satélite; os outros vieram de ronda, telefone e observação</span></div>
    </div>
    <p class="nota">${d.cobertura} Por isso o número de relatados não mede todo o fogo do estado: mostra o pedaço que chega a uma equipe em solo.</p>`;

  const estreito = document.getElementById('graf-relatados-mes').clientWidth < 520;
  const legenda = { top: 0, left: estreito ? 0 : 'center', orient: estreito ? 'vertical' : 'horizontal', itemGap: 6, textStyle: { color: css('--texto-suave'), fontSize: estreito ? 11 : 12 } };
  const eixoY = (f) => ({ type: 'value', axisLabel: { color: css('--texto-suave'), formatter: f }, splitLine: { lineStyle: { color: css('--borda') } } });

  const g1 = graficos.relMes || echarts.init(document.getElementById('graf-relatados-mes'));
  graficos.relMes = g1;
  g1.setOption({
    animation: false, legend: legenda,
    grid: { left: 44, right: 12, top: estreito ? 52 : 34, bottom: 24 },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: (v) => num1(v) + '% do ano' },
    xAxis: { type: 'category', data: MESES, axisLabel: { color: css('--texto-suave') } },
    yAxis: eixoY((v) => v + '%'),
    series: [
      { name: 'Relatados (IBAMA)', type: 'bar', data: d.sazonal.map((x) => x.relatados_pct), itemStyle: { color: css('--abaixo'), borderRadius: [4, 4, 0, 0] } },
      { name: 'Detectados (satélite)', type: 'bar', data: d.sazonal.map((x) => x.detectados_pct), itemStyle: { color: css('--destaque'), borderRadius: [4, 4, 0, 0] } },
    ],
  }, true);

  const g2 = graficos.relAno || echarts.init(document.getElementById('graf-relatados-ano'));
  graficos.relAno = g2;
  g2.setOption({
    animation: false, legend: legenda,
    grid: { left: 44, right: 56, top: estreito ? 52 : 34, bottom: 24 },
    tooltip: { trigger: 'axis', confine: true, formatter: (ps) => {
      const x = d.por_ano[ps[0].dataIndex];
      return `<strong>${x.ano}</strong><br>${x.relatados} incêndios relatados (${fmt(x.area_ha)} ha atingidos)<br>${fmt(x.detectados)} focos detectados`;
    } },
    xAxis: { type: 'category', data: d.por_ano.map((x) => String(x.ano)), axisLabel: { color: css('--texto-suave') } },
    yAxis: [eixoY((v) => v), { ...eixoY((v) => (v >= 1000 ? Math.round(v / 1000) + ' mil' : v)), splitLine: { show: false } }],
    series: [
      { name: 'Incêndios relatados (eixo da esquerda)', type: 'bar', data: d.por_ano.map((x) => x.relatados), itemStyle: { color: css('--abaixo'), borderRadius: [4, 4, 0, 0] } },
      { name: 'Focos detectados (eixo da direita)', type: 'line', yAxisIndex: 1, data: d.por_ano.map((x) => x.detectados), symbolSize: 6, lineStyle: { width: 3, color: css('--destaque') }, itemStyle: { color: css('--destaque') } },
    ],
  }, true);

  const frase = (t) => t.charAt(0) + t.slice(1).toLowerCase();
  const nomeProprio = (t) => t.toLowerCase().split(' ').map((w, k) => (k > 0 && ['de', 'da', 'do', 'das', 'dos', 'e'].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  const lista = (titulo, itens, f = frase) => `<div><h4>${titulo}</h4><ol>${itens.map((i) => `<li>${f(i.nome)}: ${i.n}</li>`).join('')}</ol></div>`;
  document.getElementById('relatados-detalhe').innerHTML = `
    <h3>O que a comparação mostra</h3>
    <ul>
      <li><strong>Só uma fração do fogo vira registro.</strong> Para cada incêndio relatado pelas brigadas federais, o satélite detectou cerca de ${fmt(d.focos_por_ocorrencia)} focos na Bahia. Mesmo contando que um incêndio grande gera muitos focos, a maior parte do fogo do estado não aparece nesses registros. Para ver o estado inteiro, o satélite é a única fonte contínua.</li>
      <li><strong>A época do fogo é parecida.</strong> Os relatados têm pico em ${MESES_LONGO[d.mes_pico_relatados - 1]} e os detectados em ${MESES_LONGO[d.mes_pico_detectados - 1]}; os dois se concentram de julho a outubro (correlação de ${num2(d.correlacao_sazonal)} entre as duas curvas do ano).</li>
      <li><strong>Mês a mês, os números não andam juntos</strong> (correlação de ${num2(d.correlacao_mensal)}). Os registros dependem de onde há brigada e de quantas equipes estavam em campo, não de quanto fogo houve no estado.</li>
    </ul>
    <div class="listas-relatados">
      ${lista('Como o fogo foi descoberto', d.deteccao.slice(0, 6))}
      ${lista('Causa provável', d.causas.slice(0, 6))}
      ${lista('Onde', d.locais.slice(0, 6))}
      ${lista('Municípios com mais registros', d.municipios.slice(0, 6), nomeProprio)}
    </div>
    <p class="nota">Fonte: ${d.fonte}, <a href="${d.url_fonte}" target="_blank" rel="noopener">dadosabertos.ibama.gov.br</a>. ${fmt(d.total_ocorrencias)} ocorrências na Bahia, contando cada registro uma vez. Anos com menos de ${d.minimo_registros_por_ano} registros ficam fora dos gráficos, porque o arquivo aberto só tem cobertura de ${a0} a ${a1}; ${d.datas_invalidas_descartadas} registros com data inválida foram descartados.</p>`;
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
      METODOS || carregarJson('../data/metodos.json'), INPE || carregarJson('../data/inpe.json'), RELATADOS || carregarJson('../data/relatados.json'),
      REPLICACAO || carregarJson('../data/replicacao_regioes.json'), CONFERENCIA || carregarJson('../data/conferencia_api.json'),
    ]);
  } catch (e) {
    caixa.innerHTML = '<p>Não foi possível carregar os testes.</p>';
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
  const NOMES = { 'Bahia (Brazil)': 'Bahia', Argentina: 'Argentina', Australia: 'Austrália', Bolivia: 'Bolívia', Canada: 'Canadá', Chile: 'Chile',
    Indonesia: 'Indonésia', Mexico: 'México', Portugal: 'Portugal', 'South Africa': 'África do Sul', 'United States': 'Estados Unidos' };
  const nome = (r) => NOMES[r.regiao] || r.regiao;
  const card = (titulo, pergunta, resultado, ok, janela) => `<article class="teste-card">
      <header><h4>${titulo}</h4><span class="tag ${ok ? 'passou' : 'limite'}">${ok ? 'passou' : 'limite achado'}</span></header>
      <p class="pergunta">${pergunta}</p>
      <p class="resultado">${resultado}</p>
      ${janela ? `<a href="#${janela}" data-janela="${janela}">Ver os detalhes</a>` : ''}
    </article>`;
  const regioes = [...rep.regioes].sort((a, b) => a.teste_erro_pct - b.teste_erro_pct);
  caixa.innerHTML = `
    <h3>1. Como a série é montada</h3>
    <ol class="passos">
      <li><strong>Baixar</strong>Arquivos anuais do NASA FIRMS para o Brasil: MODIS Coleção 6.1 (Aqua e Terra, 2000 a 2025) e VIIRS 375 m (Suomi NPP 2012 a 2025, NOAA-20 2018 a 2025), recortados num retângulo em volta da Bahia. 2026 vem da API de área do FIRMS, até ${MESES_LONGO[Number(fim.slice(5, 7)) - 1]} de ${fim.slice(0, 4)}.</li>
      <li><strong>Filtrar e contar</strong>Só fogo em vegetação (type = 0), MODIS com confiança 30 ou mais, VIIRS sem confiança baixa. Os focos são contados por mês para cada satélite, e por célula da grade NASA POWER (cerca de 55 x 68 km), para somar qualquer área de interesse.</li>
      <li><strong>Tirar os meses ruins</strong>Meses com 3 dias ou mais sem dado, ou com dias degradados do Aqua (razão diária Aqua/Suomi NPP abaixo de 0,25 vez a mediana do mês), ficam fora da calibração e do teste. As falhas do Suomi NPP são completadas com o NOAA-20 vezes ${OFICIAL.metodo.razao_snpp_noaa20.toLocaleString('pt-BR')}, razão medida quando os dois estavam completos.</li>
      <li><strong>Aprender uma taxa para cada mês do ano</strong>Nos anos em que os dois sensores funcionaram juntos (fevereiro de 2012 a dezembro de 2021, antes da deriva da órbita do Aqua), a taxa de cada mês do ano é o total do VIIRS dividido pelo total do MODIS Aqua. O Aqua é a base porque passa à tarde, perto do horário do VIIRS.<br><span class="formula">equivalente VIIRS(mês) = taxa(mês do ano) × MODIS Aqua(mês)</span></li>
      <li><strong>Montar a série</strong>2003 a janeiro de 2012: MODIS Aqua convertido com a taxa do seu mês. De fevereiro de 2012 em diante: VIIRS medido. Antes de 2012, uma faixa entre três leituras (taxa pelo Aqua, taxa pelo Terra e modelo com fatores), porque os dois MODIS discordam.</li>
      <li><strong>Comparar com o normal</strong>Para cada mês do ano, a mediana, a média e a faixa entre os percentis 25 e 75 dos anos medidos pelo VIIRS (2012 a 2025). Mês acima do percentil 75 está acima do normal; abaixo do 25, abaixo do normal.</li>
    </ol>
    <p class="nota">As 12 taxas aprendidas (focos do VIIRS para cada foco do MODIS Aqua). Ficam mais altas na chuva, quando o fogo é pequeno e o VIIRS enxerga bem mais que o MODIS.</p>
    <div id="graf-taxas" class="grafico baixo" role="img" aria-label="Taxa VIIRS/MODIS Aqua de cada mês do ano"></div>

    <h3>2. Todos os testes que fizemos</h3>
    <div class="testes">
      ${card('Anos não vistos', 'Aprendendo só com 2012 a 2019, quanto ele acerta 2020 a 2023?', `<strong>${num1(t1.teste_erro_pct)}%</strong>de erro por mês em ${t1.teste_n_meses} meses, desvio total de ${pct(t1.teste_vies_pct)}.`, true, null)}
      ${card('Escondendo um ano de cada vez', '2020 a 2023 foi só um período de sorte?', `<strong>${num1(t1.um_ano_fora_erro_pct)}%</strong>de erro escondendo cada ano de 2013 a 2023 (${t1.um_ano_fora_n_meses} meses). Taxa única: ${num1(unica.um_ano_fora_erro_pct)}%.`, true, null)}
      ${card('7 métodos, mesma prova', 'A taxa por mês é mesmo a melhor escolha?', `<strong>${num1(t1.teste_erro_pct)}%</strong>o menor erro entre os métodos usados sozinhos. A posição no ranking decorou os dados (${num1(METODOS.metodos.ranking.anos_que_viu_erro_pct)}% nos anos vistos, ${num1(METODOS.metodos.ranking.teste_erro_pct)}% nos novos).`, true, 'metodos')}
      ${card('Conferência com o INPE', 'O salto de 2012 some em outro processamento do mesmo satélite?', `<strong>${num1(ri.diferenca_entre_periodos_pct)}%</strong>de diferença na razão nossa/INPE antes e depois de 2012, contra um salto de ${num1(ri.salto_sem_harmonizar_vezes)} vezes sem harmonizar. A correlação ano a ano é ${num3(ri.correlacao_anual)}, mas o Aqua cru já chega a ${num3(ri.correlacao_anual_aqua_sem_conversao)}: o satélite de referência do INPE é o Aqua.`, true, 'inpe')}
      ${card('Conferência dos dados: API do FIRMS', 'Os arquivos que baixamos são iguais aos da API oficial da NASA?', `<strong>${viirsApi.iguais} de ${viirsApi.n}</strong>janelas do VIIRS batem exatamente. O MODIS difere em ${pct(Math.round(modisApi.dif * 100) / 100)} (versão de processamento mais nova nos arquivos anuais).`, true, null)}
      ${card('Completude dos dados', 'Há buracos no registro dos satélites?', `<strong>&gt;99%</strong>dos dias com dado: ${COMPLETUDE.map(([n, p]) => `${n} ${p.toLocaleString('pt-BR')}%`).join(', ')}. Meses com falha são sinalizados.`, true, null)}
      ${card('Outras regiões', 'O método só funciona na Bahia?', `<strong>${outrosGanham} de ${outros.length}</strong>outros países em que a taxa por mês ganha da taxa única em anos não vistos (${outrosUmAnoFora} de ${outros.length} escondendo um ano de cada vez). Sofre com pouco fogo (Portugal) e com anos recordes (Canadá 2023).`, false, null)}
      ${card('Modelo com fatores (pesos da mentoria)', 'Fatores de clima e de fogo melhoram a conversão?', `<strong>${num1(METODOS.metodos.formula_pesos.teste_erro_pct)}%</strong>de erro, não melhor que a taxa por mês, mas explica por que a taxa muda (focos noturnos, umidade) e a faixa de 95% cobriu ${f.cobertura_faixa_95} meses de teste.`, false, 'metodo')}
      ${card('Detectados x relatados', 'Como a detecção por satélite se compara aos incêndios registrados em solo?', `<strong>${fmt(RELATADOS.focos_por_ocorrencia)}</strong>focos para cada incêndio registrado pelas brigadas do IBAMA; só ${RELATADOS.detectados_por_satelite} de ${fmt(RELATADOS.total_ocorrencias)} registros foram achados por satélite.`, true, 'relatados')}
      ${card('Correlação não é prova', 'Uma correlação alta basta para confiar no método?', `<strong>${num3(METODOS.correlacao_ordem_dos_meses.aqua_sem_conversao)}</strong>o Aqua cru já chega a isso, sem conversão nenhuma, porque as estações mandam no ano. Por isso medimos pelo erro em focos, não pela correlação.`, false, null)}
    </div>

    <h3>3. Funciona em outros lugares?</h3>
    <p>Os mesmos scripts, os mesmos filtros e a mesma prova (aprende com 2012 a 2019, adivinha 2020 a 2023) em ${rep.n_regioes - 1} países com fogo muito diferente. As taxas são recalculadas em cada lugar: julho vai de ${num1(rep.taxa_julho_min_max[0])} a ${num1(rep.taxa_julho_min_max[1])}.</p>
    <div id="graf-replicacao" class="grafico" style="height:460px" role="img" aria-label="Erro da taxa por mês e da taxa única em cada região"></div>
    <div class="tabela-rolagem"><table class="tabela-regioes">
      <thead><tr><th>Região</th><th>Taxa por mês</th><th>Taxa única</th><th>Escondendo cada ano</th><th>Desvio</th><th>Salto de 2012</th><th>Ano recorde</th></tr></thead>
      <tbody>${regioes.map((r) => `<tr class="${r.regiao.startsWith('Bahia') ? 'destaque' : ''}"><td>${nome(r)}</td><td>${num1(r.teste_erro_pct)}%</td><td>${num1(r.teste_erro_taxa_unica_pct)}%</td><td>${num1(r.um_ano_fora_erro_pct)}%</td><td>${pct(r.teste_vies_pct)}</td><td>${num1(r.salto_sem_harmonizar_2011_2012)}x</td><td>${r.ano_com_mais_fogo}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="nota">Erro = WAPE mensal em 2020 a 2023 contra o VIIRS medido. Os anos recordes batem com eventos conhecidos (Indonésia 2015, Chile 2017, Canadá 2023, Bolívia 2024). Portugal tem mediana de cerca de 100 focos VIIRS por mês, pouco para uma taxa por mês estável; o recorde do Canadá em 2023 ficou muito fora dos anos de calibração.</p>

    <h3>4. Incerteza e limites</h3>
    <ul>
      <li>Antes de 2012 não há VIIRS para conferir, e os dois MODIS discordam: esses anos aparecem com faixa.</li>
      <li>Os ${num1(v.erro_mensal_wape_pct)}% de erro valem para a Bahia inteira; em áreas menores o erro cresce (teste de 2020 a 2023: ${num1(erroEscala('bloco_2x2'))}% em cerca de 110 x 135 km, ${num1(erroEscala('celula'))}% numa célula da grade).</li>
      <li>Só a Bahia está processada no site; o método foi testado em outros ${rep.n_regioes - 1} países.</li>
      <li>Os meses recentes de 2026 são provisórios (quase tempo real).</li>
    </ul>

    <h3>5. Como refazer</h3>
    <p>Tudo está no repositório aberto: <a href="https://github.com/RafaTheMonk/calendario-queimadas" target="_blank" rel="noopener">github.com/RafaTheMonk/calendario-queimadas</a>. Python 3 com numpy; os scripts de 2026 e da API precisam de uma chave gratuita do FIRMS (MAP_KEY).</p>
    <div class="comandos">Scripts/baixar_firms_bahia.sh                    # baixa o FIRMS e recorta a área
python3 -I Scripts/completude_firms.py           # completude dos dados
python3 -I Scripts/harmonizacao/erro_por_area.py  # erro por tamanho de área (antes da linha seguinte)
python3 -I Scripts/gerar_json_site.py            # monta a série harmonizada
python3 -I Scripts/harmonizacao/comparar_metodos.py   # 7 métodos, mesma prova
python3 -I Scripts/comparar_inpe.py              # conferência com o INPE
python3 -I Scripts/conferir_com_api.py           # confere os arquivos com a API do FIRMS
python3 -I Scripts/replicar_regiao.py Argentina  # o método em outro país
python3 -I Scripts/resumo_regioes.py             # resumo de todas as regiões</div>`;

  const estreito = caixa.clientWidth < 560;
  if (graficos.taxas) graficos.taxas.dispose();
  const g1 = echarts.init(document.getElementById('graf-taxas'));
  graficos.taxas = g1;
  g1.setOption({
    animation: false,
    grid: { left: 36, right: 12, top: 24, bottom: 24 },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: (x) => num1(x) + ' focos VIIRS por foco do MODIS Aqua' },
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
    yAxis: { type: 'category', data: ordem.map(nome),
      axisLabel: { color: css('--texto'), fontSize: estreito ? 11 : 12, formatter: (n) => (n === 'Bahia' ? '{b|Bahia}' : n), rich: { b: { fontWeight: 700, color: css('--destaque') } } } },
    series: [
      { name: 'Taxa por mês (nosso método)', type: 'bar', data: ordem.map((r) => r.teste_erro_pct), itemStyle: { color: css('--destaque'), borderRadius: [0, 4, 4, 0] } },
      { name: 'Taxa única', type: 'bar', data: ordem.map((r) => r.teste_erro_taxa_unica_pct), itemStyle: { color: '#94a3b8', borderRadius: [0, 4, 4, 0] } },
    ],
  }, true);
}

// ------------------------------------------------------------------ método e rodapé

function metodo() {
  const me = OFICIAL.metodo;
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
    <p>${v.desenho}.${v.taxas_publicadas ? ' ' + v.taxas_publicadas : ''}</p>
    <div class="metricas">
      <div><strong>${v.erro_mensal_wape_pct.toLocaleString('pt-BR')}%</strong><span>erro por mês (WAPE), meses válidos</span></div>
      ${v.erro_mensal_48_meses_pct ? `<div><strong>${v.erro_mensal_48_meses_pct.toLocaleString('pt-BR')}%</strong><span>erro por mês contando os 48 meses</span></div>` : ''}
      <div><strong>${pct(v.vies_pct)}</strong><span>desvio no total</span></div>
      ${f ? `<div><strong>${f.cobertura_faixa_95}</strong><span>meses de teste dentro da faixa de 95% do modelo com fatores</span></div>` : ''}
    </div>
    <p class="nota">Erro no total de cada ano de teste, nos meses válidos: ${anual}.${v.acerto_tres_faixas_pct ? ` Acerto ao classificar o mês em abaixo, normal ou acima: ${v.acerto_tres_faixas_pct.toLocaleString('pt-BR')}%.` : ''}</p>
    ${f ? `
    <h3>Por que a relação entre os satélites muda</h3>
    <p>${f.o_que_e}</p>
    <ul>${pesos}</ul>
    <p class="nota">Testados e descartados por não mudarem a relação: ${descartados}. Comparação no teste: taxa por mês ${comp.T1.erro_mensal_pct.toLocaleString('pt-BR')}% de erro, modelo com fatores ${comp.modelo_v2.erro_mensal_pct.toLocaleString('pt-BR')}%. O número principal usa a taxa por mês. <a href="#metodos" data-janela="metodos">Veja a comparação dos 7 métodos testados</a>.</p>
    <h3>O que descobrimos antes de 2012</h3>
    <p>${f.descoberta}</p>
    <p class="nota">Média anual de 2003 a 2011, em focos equivalentes VIIRS: ${fmt(f.media_anual_2003_2011.t1_terra)} pelo Terra, ${fmt(f.media_anual_2003_2011.fatores_aqua)} pelo modelo com fatores e ${fmt(f.media_anual_2003_2011.t1_aqua)} pela taxa por mês do Aqua. VIIRS real de 2012 a 2021: ${fmt(f.viirs_real_media_anual_2012_2021)} por ano.</p>` : ''}
    <h3>Conferência com o INPE</h3>
    <p>Comparamos a série harmonizada com a do satélite de referência do INPE. Esse satélite é o MODIS Aqua, o mesmo que convertemos, então uma correlação alta sozinha prova pouco: o Aqua cru correlaciona quase igual. A prova é que a razão entre a nossa série e a do INPE fica quase a mesma antes e depois de 2012, enquanto sem harmonizar ela salta em 2012. <a href="#inpe" data-janela="inpe">Ver a comparação</a>.</p>
    <h3>O método funciona em outros lugares</h3>
    <p>Os scripts recalculam as taxas para qualquer país do arquivo do FIRMS. Rodamos a mesma prova em 10 países com fogo muito diferente (Argentina, Austrália, Bolívia, Canadá, Chile, Indonésia, México, Portugal, África do Sul e Estados Unidos). Em anos não vistos (2020 a 2023), a taxa por mês ganhou da taxa única em 8 dos 10 países (além da Bahia) e em 9 de 10 escondendo um ano de cada vez. O erro ficou entre 6,6% e 10,6% no México, África do Sul, Austrália, Argentina, Bolívia e Estados Unidos. O método sofre onde há pouco fogo (Portugal, mediana de 99 focos VIIRS por mês) e com anos recordes fora da calibração (Canadá 2023). As taxas mudam muito entre regiões (julho: de 4,0 na Argentina a 14,5 no Canadá), por isso precisam ser recalculadas em cada região, nunca copiadas.</p>
    <h3>Áreas menores</h3>
    <p>Ao escolher um ponto, o site soma as células da grade NASA POWER (cerca de 55 x 68 km) dentro do raio, usando as mesmas taxas calibradas para a Bahia. Os ${v.erro_mensal_wape_pct.toLocaleString('pt-BR')}% de erro valem para a Bahia inteira; no teste de 2020 a 2023 o erro foi de ${num1(erroEscala('bloco_4x4'))}% em áreas de cerca de 220 x 270 km, ${num1(erroEscala('bloco_2x2'))}% em cerca de 110 x 135 km e ${num1(erroEscala('celula'))}% numa célula da grade.</p>
    <h3>Limitações</h3>
    <ul>${me.limitacoes.map((x) => `<li>${x}</li>`).join('')}</ul>`;
}

function rodape() {
  document.getElementById('fonte').textContent = 'Fonte: ' + OFICIAL.fonte + '. Clima e altitude: NASA POWER. Unidade: ' + OFICIAL.unidade + '.';
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
      document.getElementById('msg-area').textContent = 'Confira a coordenada: latitude entre -90 e 90, longitude entre -180 e 180 (na Bahia, as duas são negativas).';
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
    document.getElementById('msg-area').textContent = 'Desenho cancelado.';
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
  document.getElementById('cartoes').innerHTML = '<p>Não foi possível carregar os dados. Abra a página por um servidor (veja o README).</p>';
  console.error(e);
});
