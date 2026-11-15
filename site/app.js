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

const fmt = (n) => (n === null || n === undefined) ? 'sem dado' : Math.round(n).toLocaleString('pt-BR');
const pct = (n) => (n > 0 ? '+' : '') + n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
const css = (nome) => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();

let OFICIAL = null;     // série oficial da Bahia
let CELULAS = null;     // série por célula (carregada sob demanda)
let DADOS = null;       // série da área ativa, no mesmo formato da oficial
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
  if (!CELULAS) CELULAS = await (await fetch('data/celulas_bahia.json')).json();
  return CELULAS;
}

function dentroDaBahia(lat, lon) {
  const a = OFICIAL.area;
  return lat > a.lat_min && lat < a.lat_max && lon > a.lon_min && lon < a.lon_max;
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
  // normal de cada mês só com os anos medidos pelo VIIRS (2012-02 em diante), como na série da Bahia
  for (let k = 1; k <= 12; k++) {
    const v = serie.filter((s, i) => s.mes_num === k && i >= nPre).map((s) => s.focos);
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

async function definirArea(nova, mensagem) {
  const aviso = document.getElementById('aviso-area');
  const msgJanela = document.getElementById('msg-area');
  if (nova.tipo === 'ponto') {
    await carregarCelulas();
    const cels = CELULAS.celulas.filter((c) => distanciaKm(nova.lat, nova.lon, c.lat, c.lon) <= nova.raio);
    if (!dentroDaBahia(nova.lat, nova.lon) || cels.length === 0) {
      estado.area = { tipo: 'bahia' };
      DADOS = OFICIAL;
      const txt = 'Esse ponto fica fora da área processada nesta versão (Bahia). Mostrando a Bahia inteira.';
      aviso.textContent = nova.origem === 'local'
        ? 'Você está fora da área processada nesta versão (Bahia). Mostrando a Bahia inteira; dá para escolher um ponto no chip de área, no topo.'
        : txt;
      msgJanela.textContent = txt;
      atualizarTudo();
      return;
    }
    estado.area = nova;
    DADOS = montarDadosArea(cels);
    const mediaAnual = DADOS.totais_por_ano.reduce((s, t) => s + t.focos, 0) / DADOS.totais_por_ano.length;
    const extra = ' Antes de 2012 a conversão usa a taxa da Bahia inteira: em áreas de 100 km o erro típico medido é de cerca de 25%.'
      + (mediaAnual < 3000 ? ' Área com poucos focos: os números variam mais.' : '');
    aviso.textContent = (mensagem || `Mostrando ${nomeArea().toLowerCase()}: ${cels.length} células da grade (cerca de 55 x 68 km cada).`) + extra;
    msgJanela.textContent = `${cels.length} células dentro do raio.` + extra;
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
    : (estado.area.origem === 'local' ? 'perto de você' : 'esse lugar');
}

function atualizarTudo() {
  atualizarTextosArea();
  if (estado.anoIni !== null) montarSeletorPeriodo();
  heroGrafico();
  agora();
  cartoes();
  if (mapaL) desenharAreaNoMapa();
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
    `Normal de ${nomeMes}: ${fmt(porDia(nm.mediana[chave]))} focos por dia (mediana dos anos medidos pelo VIIRS, 2012 a 2025; faixa normal de ${fmt(porDia(nm.p25[chave]))} a ${fmt(porDia(nm.p75[chave]))}). Esperado para o mês inteiro: cerca de ${fmt(nm.mediana[chave])} focos.`;
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
    document.getElementById('agora-unidade').textContent = 'focos por dia';
    tag.textContent = classe;
    tag.className = 'tag ' + classeTag(classe);
    document.getElementById('agora-comparacao').textContent = `${pct(Math.round((media - med) / med * 1000) / 10)} em relação à mediana de ${nomeMes}`;
    const dm = (d) => d.data.slice(8, 10) + '/' + d.data.slice(5, 7);
    const atual = j.atualizado_em ? new Date(j.atualizado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    document.getElementById('agora-fonte').textContent = `Média dos últimos ${dias.length} dias completos (${dm(dias[0])} a ${dm(dias[dias.length - 1])}) contra o normal de ${nomeMes}. Fonte: NASA FIRMS, VIIRS NOAA-20 em quase tempo real, convertido para a régua do histórico${atual ? '; arquivo de ' + atual : ''}. Dado provisório; a série do calendário fecha em dezembro de 2025.`;
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
  const anos = DADOS.totais_por_ano;
  const pico = anos.reduce((a, b) => (b.focos > a.focos ? b : a));
  const ultimoAno = anos[anos.length - 1];
  const anosViirs = anos.filter((a) => a.ano >= 2013 && a.ano < ultimoAno.ano);
  const mediaViirs = anosViirs.reduce((s, a) => s + a.focos, 0) / anosViirs.length;
  const difAno = (ultimoAno.focos - mediaViirs) / mediaViirs * 100;
  const val = OFICIAL.metodo.validacao;
  document.getElementById('cartoes').innerHTML = [
    `<article class="cartao principal">
      <p class="rotulo">Último mês da série: ${MESES_LONGO[ultimo.mes_num - 1]} de ${ultimo.ano}</p>
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
      <p class="valor">cerca de 25%</p>
      <p class="detalhe">de erro típico antes de 2012 em áreas de 100 km. Na Bahia inteira o erro é de ${val.erro_mensal_wape_pct.toLocaleString('pt-BR')}%. De 2012 em diante a área usa o VIIRS medido.</p>
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
  t += `${m.posicao_no_mes}º ${MESES_LONGO[m.mes_num - 1]} com mais fogo desde 2003<br>`;
  t += `<span style="opacity:.75">origem: ${m.origem}${m.qualidade === 'corrigido' ? ', mês corrigido' : ''}</span>`;
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
  const anos = noPeriodo(DADOS.totais_por_ano);
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
      markLine: { silent: true, symbol: 'none', lineStyle: { color: css('--texto'), type: 'dashed' }, label: { position: 'insideEndTop', formatter: 'mediana ' + fmt(normal.mediana[chave]), color: css('--texto-suave') }, data: [{ yAxis: normal.mediana[chave] }] },
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
    mapaL.on('click', (e) => definirArea({ tipo: 'ponto', lat: e.latlng.lat, lon: e.latlng.lng, raio: Number(document.getElementById('raio').value), origem: 'mapa' }));
  }
  setTimeout(() => { mapaL.invalidateSize(); desenharAreaNoMapa(); }, 60);
}

function desenharAreaNoMapa() {
  if (camadas.circulo) { mapaL.removeLayer(camadas.circulo); camadas.circulo = null; }
  if (camadas.ponto) { mapaL.removeLayer(camadas.ponto); camadas.ponto = null; }
  const a = estado.area;
  if (a.tipo === 'ponto') {
    camadas.circulo = L.circle([a.lat, a.lon], { radius: a.raio * 1000, color: '#38bdf8', weight: 2, fillOpacity: 0.08 }).addTo(mapaL);
    camadas.ponto = L.circleMarker([a.lat, a.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#d9480f', fillOpacity: 1 }).addTo(mapaL);
    mapaL.fitBounds(camadas.circulo.getBounds(), { padding: [20, 20] });
  } else {
    mapaL.fitBounds(camadas.bahia.getBounds(), { padding: [12, 12] });
  }
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
    <p>${v.desenho}.</p>
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
    <p class="nota">Testados e descartados por não mudarem a relação: ${descartados}. Comparação no teste: taxa por mês ${comp.T1.erro_mensal_pct.toLocaleString('pt-BR')}% de erro, modelo com fatores ${comp.modelo_v2.erro_mensal_pct.toLocaleString('pt-BR')}%. O número principal usa a taxa por mês, que errou menos.</p>
    <h3>O que descobrimos antes de 2012</h3>
    <p>${f.descoberta}</p>
    <p class="nota">Média anual de 2003 a 2011, em focos equivalentes VIIRS: ${fmt(f.media_anual_2003_2011.t1_terra)} pelo Terra, ${fmt(f.media_anual_2003_2011.fatores_aqua)} pelo modelo com fatores e ${fmt(f.media_anual_2003_2011.t1_aqua)} pela taxa por mês do Aqua. VIIRS real de 2012 a 2021: ${fmt(f.viirs_real_media_anual_2012_2021)} por ano.</p>` : ''}
    <h3>Áreas menores</h3>
    <p>Ao escolher um ponto, o site soma as células da grade NASA POWER (cerca de 55 x 68 km) dentro do raio, usando as mesmas taxas calibradas para a Bahia. A precisão medida (${v.erro_mensal_wape_pct.toLocaleString('pt-BR')}%) vale para a Bahia inteira; em áreas pequenas, com poucos focos, os números variam mais.</p>
    <h3>Limitações</h3>
    <ul>${me.limitacoes.map((x) => `<li>${x}</li>`).join('')}</ul>`;
}

function rodape() {
  document.getElementById('fonte').textContent = 'Fonte: ' + OFICIAL.fonte + '. Clima e altitude: NASA POWER. Unidade: ' + OFICIAL.unidade + '.';
  document.getElementById('citacao').textContent = OFICIAL.citacao;
}

// ------------------------------------------------------------------ controles

function ligarControles() {
  document.querySelectorAll('[data-janela]').forEach((el) => el.addEventListener('click', (ev) => {
    ev.preventDefault();
    abrirJanela(el.dataset.janela);
  }));
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
