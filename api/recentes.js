// Focos dos últimos dias na área do site, a partir do arquivo de quase tempo real do NASA FIRMS.
// O navegador não consegue ler o arquivo direto (o servidor da NASA não libera CORS), por isso esta função
// baixa, filtra e devolve só a contagem por dia. Resposta guardada em cache por 1 hora.
//
// Área: sem parâmetros, o retângulo da Bahia. Com ?celulas=L14C05,L14C06,..., só os focos cujo ponto mais
// próximo da grade NASA POWER (0,5 x 0,625 grau) está na lista: as mesmas células que o site somou.

const URL_FIRMS = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_America_7d.csv';
const AREA_BAHIA = { lonMin: -46.62, lonMax: -37.34, latMin: -18.35, latMax: -8.53 };
const GRADE = { lon0: -46.875, dlon: 0.625, nlon: 16, lat0: -18.5, dlat: 0.5, nlat: 21 };
// NOAA-20 para a régua do Suomi NPP (razão medida nos meses em que os dois estavam completos)
const FATOR_NOAA20_PARA_SNPP = 1.0547;
// a passagem da tarde do NOAA-20 sobre a Bahia é por volta das 16h UTC e o dado chega horas depois:
// antes das 19h UTC, o dia corrente ainda está incompleto e fica fora da média
const HORA_DIA_COMPLETO_UTC = 19;

function celulasDaUrl(url) {
  const bruto = new URL(url).searchParams.get('celulas');
  if (!bruto) return null;
  const ids = bruto.split(',').map((s) => s.trim()).filter((s) => /^L\d{2}C\d{2}$/.test(s)).slice(0, 400);
  return ids.length ? new Set(ids) : null;
}

function celulaDe(lat, lon) {
  const i = Math.round((lat - GRADE.lat0) / GRADE.dlat);
  const j = Math.round((lon - GRADE.lon0) / GRADE.dlon);
  if (i < 0 || i >= GRADE.nlat || j < 0 || j >= GRADE.nlon) return null;
  return 'L' + String(i).padStart(2, '0') + 'C' + String(j).padStart(2, '0');
}

export async function GET(request) {
  const celulas = request && request.url ? celulasDaUrl(request.url) : null;
  try {
    const resp = await fetch(URL_FIRMS, { headers: { 'User-Agent': 'regua-de-fogo' } });
    if (!resp.ok) throw new Error('FIRMS respondeu ' + resp.status);
    const texto = await resp.text();
    const linhas = texto.split('\n');
    const cab = linhas[0].split(',');
    const ix = Object.fromEntries(cab.map((c, i) => [c.trim(), i]));
    const porDia = {};
    let removidosBaixa = 0;
    for (let k = 1; k < linhas.length; k++) {
      const c = linhas[k].split(',');
      if (c.length !== cab.length) continue;
      const lat = parseFloat(c[ix.latitude]);
      const lon = parseFloat(c[ix.longitude]);
      if (celulas) {
        if (!celulas.has(celulaDe(lat, lon))) continue;
      } else if (!(lon > AREA_BAHIA.lonMin && lon < AREA_BAHIA.lonMax && lat > AREA_BAHIA.latMin && lat < AREA_BAHIA.latMax)) {
        continue;
      }
      const conf = (c[ix.confidence] || '').trim().toLowerCase();
      if (conf === 'low' || conf === 'l') { removidosBaixa++; continue; }
      const dia = c[ix.acq_date];
      porDia[dia] = (porDia[dia] || 0) + 1;
    }
    const agora = new Date();
    const hoje = agora.toISOString().slice(0, 10);
    const incompleto = agora.getUTCHours() < HORA_DIA_COMPLETO_UTC ? hoje : null;
    const dias = Object.keys(porDia).sort()
      .filter((d) => d !== incompleto)
      .map((d) => ({ data: d, focos_noaa20: porDia[d], focos_equivalentes: Math.round(porDia[d] * FATOR_NOAA20_PARA_SNPP) }));
    const total = dias.reduce((s, d) => s + d.focos_noaa20, 0);
    const corpo = {
      fonte: 'NASA FIRMS, VIIRS NOAA-20, quase tempo real (últimos 7 dias, América do Sul)',
      atualizado_em: resp.headers.get('last-modified'),
      area: celulas ? { celulas: [...celulas] } : AREA_BAHIA,
      fator_noaa20_para_snpp: FATOR_NOAA20_PARA_SNPP,
      dias,
      dia_incompleto_fora: incompleto,
      total_noaa20: total,
      total_equivalente: Math.round(total * FATOR_NOAA20_PARA_SNPP),
      removidos_confianca_baixa: removidosBaixa,
      observacao: 'Dado provisório de quase tempo real. Não tem a classificação de tipo de foco, então pode incluir fontes industriais: na Bahia inteira elas são menos de 1% dos focos do histórico, mas perto de polos industriais (como Camaçari) chegam a quase 30%.',
    };
    return new Response(JSON.stringify(corpo), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, s-maxage=1800, stale-while-revalidate=3600',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ erro: String(e && e.message ? e.message : e) }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, s-maxage=300' },
    });
  }
}
