// Focos dos últimos 7 dias na área do site, a partir do arquivo de quase tempo real do NASA FIRMS.
// O navegador não consegue ler o arquivo direto (o servidor da NASA não libera CORS), por isso esta função
// baixa, filtra e devolve só a contagem por dia. Resposta guardada em cache por 1 hora.

const URL_FIRMS = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_America_7d.csv';
const AREA_PADRAO = { lonMin: -46.62, lonMax: -37.34, latMin: -18.35, latMax: -8.53 };
// o arquivo cobre a América do Sul: retângulos fora disso não fazem sentido
const LIMITES = { lonMin: -82, lonMax: -34, latMin: -56, latMax: 13 };

function areaDaUrl(url) {
  const q = new URL(url).searchParams;
  const n = (k) => parseFloat(q.get(k));
  const a = { lonMin: n('lonMin'), lonMax: n('lonMax'), latMin: n('latMin'), latMax: n('latMax') };
  const ok = Object.values(a).every(Number.isFinite) && a.lonMin < a.lonMax && a.latMin < a.latMax
    && a.lonMin >= LIMITES.lonMin && a.lonMax <= LIMITES.lonMax && a.latMin >= LIMITES.latMin && a.latMax <= LIMITES.latMax
    && (a.lonMax - a.lonMin) <= 20 && (a.latMax - a.latMin) <= 20;
  return ok ? a : AREA_PADRAO;
}
// NOAA-20 para a régua do Suomi NPP (razão medida nos meses em que os dois estavam completos)
const FATOR_NOAA20_PARA_SNPP = 1.0547;

export async function GET(request) {
  const AREA = request && request.url ? areaDaUrl(request.url) : AREA_PADRAO;
  try {
    const resp = await fetch(URL_FIRMS, { headers: { 'User-Agent': 'calendario-queimadas' } });
    if (!resp.ok) throw new Error('FIRMS respondeu ' + resp.status);
    const texto = await resp.text();
    const linhas = texto.split('\n');
    const cab = linhas[0].split(',');
    const ix = Object.fromEntries(cab.map((c, i) => [c.trim(), i]));
    const porDia = {};
    let total = 0;
    let removidosBaixa = 0;
    for (let k = 1; k < linhas.length; k++) {
      const c = linhas[k].split(',');
      if (c.length !== cab.length) continue;
      const lat = parseFloat(c[ix.latitude]);
      const lon = parseFloat(c[ix.longitude]);
      if (!(lon > AREA.lonMin && lon < AREA.lonMax && lat > AREA.latMin && lat < AREA.latMax)) continue;
      const conf = (c[ix.confidence] || '').trim().toLowerCase();
      if (conf === 'low' || conf === 'l') { removidosBaixa++; continue; }
      const dia = c[ix.acq_date];
      porDia[dia] = (porDia[dia] || 0) + 1;
      total++;
    }
    const dias = Object.keys(porDia).sort().map((d) => ({ data: d, focos_noaa20: porDia[d], focos_equivalentes: Math.round(porDia[d] * FATOR_NOAA20_PARA_SNPP) }));
    const corpo = {
      fonte: 'NASA FIRMS, VIIRS NOAA-20, quase tempo real (últimos 7 dias, América do Sul)',
      atualizado_em: resp.headers.get('last-modified'),
      area: AREA,
      fator_noaa20_para_snpp: FATOR_NOAA20_PARA_SNPP,
      dias,
      total_noaa20: total,
      total_equivalente: Math.round(total * FATOR_NOAA20_PARA_SNPP),
      removidos_confianca_baixa: removidosBaixa,
      observacao: 'Dado provisório de quase tempo real. Não tem a classificação de tipo de foco, então pode incluir fontes industriais (no histórico elas são menos de 1% dos focos).',
    };
    return new Response(JSON.stringify(corpo), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ erro: String(e && e.message ? e.message : e) }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, s-maxage=300' },
    });
  }
}
