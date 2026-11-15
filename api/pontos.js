// Pontos de foco para desenhar no mapa da área de interesse.
//
// ?modo=recentes          focos dos últimos 7 dias (VIIRS NOAA-20), do arquivo público de quase tempo real
//                         do NASA FIRMS. Não precisa de chave.
// ?modo=dia&data=AAAA-MM-DD&sat=modis|viirs
//                         focos de um dia qualquer pela API de área do FIRMS. Precisa da chave na variável
//                         de ambiente FIRMS_MAP_KEY (fica só no servidor; o navegador nunca vê a chave).
//
// Sempre o retângulo da Bahia, com os mesmos filtros da série (sem confiança baixa; só vegetação quando o
// arquivo traz o tipo do foco). Devolve só latitude, longitude, data, hora, FRP e satélite.

const URL_RECENTES = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_America_7d.csv';
const API = 'https://firms.modaps.eosdis.nasa.gov/api';
const AREA = { lonMin: -46.62, lonMax: -37.34, latMin: -18.35, latMax: -8.53 };
const AREA_API = '-46.62,-18.35,-37.34,-8.53';
const LIMITE_PONTOS = 20000;
// o S-NPP parou em 02/11/2026; depois disso o VIIRS do dia vem do NOAA-20
const FIM_SNPP = '2026-11-02';

let disponibilidade = null;  // datas de cada produto, guardadas enquanto a função estiver viva

function resposta(corpo, status, cache) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache },
  });
}

function lerCsv(texto) {
  const linhas = texto.split('\n');
  const cab = linhas[0].split(',').map((c) => c.trim());
  const ix = Object.fromEntries(cab.map((c, i) => [c, i]));
  const pontos = [];
  let fora = 0;
  for (let k = 1; k < linhas.length; k++) {
    const c = linhas[k].split(',');
    if (c.length !== cab.length) continue;
    const lat = parseFloat(c[ix.latitude]);
    const lon = parseFloat(c[ix.longitude]);
    if (!(lon > AREA.lonMin && lon < AREA.lonMax && lat > AREA.latMin && lat < AREA.latMax)) continue;
    const conf = (c[ix.confidence] || '').trim().toLowerCase();
    if (conf === 'l' || conf === 'low') { fora++; continue; }
    if (ix.type !== undefined && !['', '0'].includes((c[ix.type] || '').trim())) { fora++; continue; }
    if (/^\d+$/.test(conf) && Number(conf) < 30) { fora++; continue; }  // MODIS: mesma regra da série
    if (pontos.length >= LIMITE_PONTOS) break;
    pontos.push([
      Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4,
      c[ix.acq_date], (c[ix.acq_time] || '').trim().padStart(4, '0'),
      Math.round(parseFloat(c[ix.frp]) * 10) / 10 || 0,
      (c[ix.satellite] || '').trim(),
    ]);
  }
  return { pontos, fora };
}

async function produtoDoDia(chave, data, sat) {
  if (!disponibilidade) {
    const r = await fetch(`${API}/data_availability/csv/${chave}/all`, { headers: { 'User-Agent': 'regua-de-fogo' } });
    if (!r.ok) throw new Error('disponibilidade ' + r.status);
    disponibilidade = {};
    (await r.text()).split('\n').slice(1).forEach((l) => {
      const [id, ini, fim] = l.split(',').map((x) => (x || '').trim());
      if (id) disponibilidade[id] = [ini, fim];
    });
  }
  const opcoes = sat === 'modis'
    ? ['MODIS_SP', 'MODIS_NRT']
    : (data <= FIM_SNPP ? ['VIIRS_SNPP_SP', 'VIIRS_SNPP_NRT'] : ['VIIRS_NOAA20_SP', 'VIIRS_NOAA20_NRT']);
  return opcoes.find((p) => disponibilidade[p] && disponibilidade[p][0] <= data && data <= disponibilidade[p][1]) || null;
}

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const modo = q.get('modo') || 'recentes';
  try {
    if (modo === 'recentes') {
      const r = await fetch(URL_RECENTES, { headers: { 'User-Agent': 'regua-de-fogo' } });
      if (!r.ok) throw new Error('FIRMS respondeu ' + r.status);
      const { pontos, fora } = lerCsv(await r.text());
      return resposta({
        modo, fonte: 'NASA FIRMS, VIIRS NOAA-20, quase tempo real (últimos 7 dias)',
        atualizado_em: r.headers.get('last-modified'), campos: ['lat', 'lon', 'data', 'hora_utc', 'frp', 'satelite'],
        removidos: fora, pontos,
      }, 200, 'public, s-maxage=900, stale-while-revalidate=1800');
    }
    if (modo !== 'dia') return resposta({ erro: 'modo inválido' }, 400, 'public, s-maxage=3600');
    const data = q.get('data') || '';
    const sat = q.get('sat') === 'viirs' ? 'viirs' : 'modis';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(data))) {
      return resposta({ erro: 'data inválida (use AAAA-MM-DD)' }, 400, 'public, s-maxage=3600');
    }
    const chave = (process.env.FIRMS_MAP_KEY || '').trim();
    if (chave.length !== 32) {
      return resposta({ erro: 'A consulta de um dia escolhido ainda não está configurada neste site.' }, 503, 'no-store');
    }
    const produto = await produtoDoDia(chave, data, sat);
    if (!produto) {
      return resposta({ erro: sat === 'modis' ? 'O MODIS tem dados de 01/11/2000 até hoje.' : 'O VIIRS tem dados de 20/01/2012 até hoje.' }, 404, 'public, s-maxage=3600');
    }
    const r = await fetch(`${API}/area/csv/${chave}/${produto}/${AREA_API}/1/${data}`, { headers: { 'User-Agent': 'regua-de-fogo' } });
    const texto = await r.text();
    if (!r.ok || !texto.startsWith('latitude')) throw new Error('API do FIRMS respondeu ' + r.status);
    const { pontos, fora } = lerCsv(texto);
    const recente = (Date.now() - Date.parse(data)) < 3 * 86400000;
    return resposta({
      modo, data, sat, produto,
      fonte: `NASA FIRMS, ${produto.replace(/_/g, ' ')}`,
      campos: ['lat', 'lon', 'data', 'hora_utc', 'frp', 'satelite'], removidos: fora, pontos,
    }, 200, recente ? 'public, s-maxage=900' : 'public, s-maxage=86400, stale-while-revalidate=604800');
  } catch (e) {
    // a mensagem nunca leva a URL, que tem a chave
    return resposta({ erro: 'Não foi possível buscar os focos agora.' }, 502, 'public, s-maxage=120');
  }
}
