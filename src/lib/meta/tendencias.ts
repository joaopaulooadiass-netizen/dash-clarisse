import { metaGetAll, accountPath, fatiarPeriodo } from './client'
import { pickAction, ACTION_COMPRA } from './actions'

// ─── Tipos exportados (usados em TelaTendencias) ──────────────────────────────

export interface CampanhaDiaTendencias {
  campanhaId: string
  campanhaNome: string
  data: string
  diaSemana: number   // 0=Dom … 6=Sáb
  semanaIdx: number
  investimento: number
  impressoes: number
  cliques: number
  compras: number
  valorGerado: number
  roas: number
  cac: number
  ctr: number
  cpm: number
  temperatura: 'fundo' | 'quente' | 'neutro'
  objetivo: string    // 'VENDAS' | 'LEADS' | 'CPT' | 'C1' | 'C2' | 'C3' | ''
}

export interface DadoGeoTendencias {
  nome: string
  sigla: string
  lat: number
  lon: number
  investimento: number
  impressoes: number
  compras: number
  valorGerado: number
  roas: number
  ctr: number
}

// Geo POR CAMPANHA (level=campaign): permite à tela aplicar ao mapa os MESMOS
// filtros (objetivo/temperatura/nome/ativa) do resto da página — no nível de
// conta o mapa ficava pintado com a conta inteira ao lado de KPIs filtrados.
// A tela agrega por sigla depois de filtrar e recomputa ctr/roas das somas.
export interface GeoCampanhaRow {
  campanhaId: string
  campanhaNome: string
  temperatura: 'fundo' | 'quente' | 'neutro'
  objetivo: string    // mesmo derive da série por campanha ('VENDAS', 'LEADS'...)
  sigla: string
  nome: string
  lat: number         // NaN = país fora do dicionário (sem marcador; rodapé "fora do mapa")
  lon: number
  investimento: number
  impressoes: number
  cliques: number
  compras: number
  valorGerado: number
}

// ─── Tipos brutos da API ──────────────────────────────────────────────────────

interface MetaInsightCampanha {
  campaign_id: string
  campaign_name: string
  spend: string
  impressions: string
  inline_link_clicks: string
  ctr: string
  cpm: string
  actions?: { action_type: string; value: string }[]
  action_values?: { action_type: string; value: string }[]
  date_start: string
}

interface MetaInsightGeo {
  campaign_id?: string
  campaign_name?: string
  region?: string
  country?: string
  spend: string
  impressions: string
  inline_link_clicks?: string
  actions?: { action_type: string; value: string }[]
  action_values?: { action_type: string; value: string }[]
}

// ─── Mapeamento estado BR (nome completo → sigla e coordenadas) ───────────────

const BR_ESTADOS: Record<string, { sigla: string; lat: number; lon: number }> = {
  'Acre':                  { sigla: 'AC', lat: -9.0,  lon: -70.8 },
  'Alagoas':               { sigla: 'AL', lat: -9.6,  lon: -36.8 },
  'Amazonas':              { sigla: 'AM', lat: -4.0,  lon: -63.2 },
  'Amapá':                 { sigla: 'AP', lat: 1.4,   lon: -51.8 },
  'Bahia':                 { sigla: 'BA', lat: -12.9, lon: -41.7 },
  'Ceará':                 { sigla: 'CE', lat: -5.5,  lon: -39.3 },
  'Distrito Federal':      { sigla: 'DF', lat: -15.8, lon: -47.9 },
  'Espírito Santo':        { sigla: 'ES', lat: -19.6, lon: -40.7 },
  'Goiás':                 { sigla: 'GO', lat: -16.1, lon: -49.4 },
  'Maranhão':              { sigla: 'MA', lat: -5.4,  lon: -44.3 },
  'Minas Gerais':          { sigla: 'MG', lat: -18.5, lon: -44.7 },
  'Mato Grosso do Sul':    { sigla: 'MS', lat: -20.4, lon: -54.6 },
  'Mato Grosso':           { sigla: 'MT', lat: -12.6, lon: -56.1 },
  'Pará':                  { sigla: 'PA', lat: -3.4,  lon: -52.3 },
  'Paraíba':               { sigla: 'PB', lat: -7.1,  lon: -36.8 },
  'Pernambuco':            { sigla: 'PE', lat: -8.4,  lon: -37.9 },
  'Piauí':                 { sigla: 'PI', lat: -8.0,  lon: -43.1 },
  'Paraná':                { sigla: 'PR', lat: -25.3, lon: -51.4 },
  'Rio de Janeiro':        { sigla: 'RJ', lat: -22.5, lon: -43.2 },
  'Rio Grande do Norte':   { sigla: 'RN', lat: -5.8,  lon: -36.5 },
  'Rondônia':              { sigla: 'RO', lat: -10.9, lon: -63.9 },
  'Roraima':               { sigla: 'RR', lat: 2.8,   lon: -61.4 },
  'Rio Grande do Sul':     { sigla: 'RS', lat: -30.1, lon: -53.2 },
  'Santa Catarina':        { sigla: 'SC', lat: -27.6, lon: -50.2 },
  'Sergipe':               { sigla: 'SE', lat: -10.9, lon: -37.4 },
  'São Paulo':             { sigla: 'SP', lat: -22.2, lon: -48.5 },
  'Tocantins':             { sigla: 'TO', lat: -10.2, lon: -48.3 },
}

// Mapeamento países (ISO alpha-2 → nome e coordenadas)
const PAISES_GEO: Record<string, { nome: string; lat: number; lon: number }> = {
  BR: { nome: 'Brasil',        lat: -10.0, lon: -53.0  },
  PT: { nome: 'Portugal',      lat: 39.4,  lon: -8.2   },
  US: { nome: 'EUA',           lat: 37.1,  lon: -95.7  },
  AR: { nome: 'Argentina',     lat: -34.0, lon: -64.0  },
  CO: { nome: 'Colômbia',      lat: 4.0,   lon: -72.0  },
  MX: { nome: 'México',        lat: 23.6,  lon: -102.5 },
  CL: { nome: 'Chile',         lat: -30.0, lon: -71.0  },
  AO: { nome: 'Angola',        lat: -11.2, lon: 17.9   },
  DE: { nome: 'Alemanha',      lat: 51.2,  lon: 10.5   },
  GB: { nome: 'Reino Unido',   lat: 51.5,  lon: -0.1   },
  ES: { nome: 'Espanha',       lat: 40.4,  lon: -3.7   },
  FR: { nome: 'França',        lat: 46.2,  lon: 2.2    },
  IT: { nome: 'Itália',        lat: 41.9,  lon: 12.6   },
  PE: { nome: 'Peru',          lat: -9.2,  lon: -75.0  },
  CA: { nome: 'Canadá',        lat: 56.1,  lon: -106.3 },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deriveTemperatura(nome: string): 'fundo' | 'quente' | 'neutro' {
  const n = nome.toUpperCase()
  if (n.includes('[F]')) return 'fundo'
  if (n.includes('[Q]')) return 'quente'
  return 'neutro'
}

function deriveObjetivo(nome: string): string {
  const n = nome.toUpperCase()
  for (const tag of ['VENDAS', 'LEADS', 'CPT', 'C1', 'C2', 'C3']) {
    if (n.includes(`[${tag}]`) || n.includes(tag)) return tag
  }
  return ''
}

// ─── Dados por campanha (para filtros na tela de Tendências) ──────────────────

const CAMP_FIELDS = [
  'campaign_id', 'campaign_name',
  'spend', 'impressions', 'inline_link_clicks',
  'actions', 'action_values',
  'ctr', 'cpm',
].join(',')

// Período escolhido pelo usuário (de/ate) — dados diários acima de 90 dias
// precisam de janelas, senão a Meta devolve erro 1/99 (mesmo padrão das outras libs)
export async function getDadosPorCampanha(
  de: string,
  ate: string,
): Promise<CampanhaDiaTendencias[]> {
  const rowsMeta: MetaInsightCampanha[] = []

  // Sequencial de propósito: janelas em paralelo estouram o rate limit da conta
  for (const janela of fatiarPeriodo(de, ate)) {
    const parte = await metaGetAll<MetaInsightCampanha>(
      `${accountPath()}/insights`,
      {
        fields: CAMP_FIELDS,
        time_increment: '1',
        level: 'campaign',
        time_range: JSON.stringify(janela),
        limit: '500',
      },
      30,
    )
    rowsMeta.push(...parte)
  }

  const rows: CampanhaDiaTendencias[] = []
  // semanaIdx relativo ao início do período pedido (não ao primeiro dado que voltou)
  const dataInicio = de

  rowsMeta.forEach(row => {
    const d = new Date(`${row.date_start}T12:00:00`)
    const diasDesdeInicio = Math.floor((d.getTime() - new Date(`${dataInicio}T12:00:00`).getTime()) / 86400000)

    const investimento = parseFloat(row.spend) || 0
    const impressoes   = parseInt(row.impressions) || 0
    const cliques      = parseInt(row.inline_link_clicks) || 0
    const compras      = pickAction(row.actions, ...ACTION_COMPRA)
    const valorGerado  = pickAction(row.action_values, ...ACTION_COMPRA)
    const ctr          = parseFloat(row.ctr) || 0
    const cpm          = parseFloat(row.cpm) || 0
    const roas         = investimento > 0 ? valorGerado / investimento : 0
    const cac          = compras > 0 ? investimento / compras : 0

    rows.push({
      campanhaId:   row.campaign_id,
      campanhaNome: row.campaign_name,
      data:         row.date_start,
      diaSemana:    d.getDay(),
      semanaIdx:    Math.floor(diasDesdeInicio / 7),
      investimento,
      impressoes,
      cliques,
      compras,
      valorGerado,
      roas,
      cac,
      ctr,
      cpm,
      temperatura:  deriveTemperatura(row.campaign_name),
      objetivo:     deriveObjetivo(row.campaign_name),
    })
  })

  return rows
}

// ─── Dados geográficos ────────────────────────────────────────────────────────

// Agregado (sem granularidade diária) — um time_range único aguenta até 365d.
// LEVEL=CAMPAIGN: uma linha por campanha×local, para a tela aplicar ao mapa os
// mesmos filtros do resto da página (no nível de conta o mapa não era filtrável).
// CTR: pedimos inline_link_clicks e derivamos (cliques no link ÷ impressões),
// como no resto do app. O campo `ctr` pronto da API é "todos os cliques"
// (reação, ver mais, perfil...) e chegava 2–3× maior que o CTR das outras telas.
async function fetchGeo(breakdown: 'region' | 'country', de: string, ate: string): Promise<MetaInsightGeo[]> {
  return metaGetAll<MetaInsightGeo>(
    `${accountPath()}/insights`,
    {
      fields: 'campaign_id,campaign_name,spend,impressions,inline_link_clicks,actions,action_values',
      breakdowns: breakdown,
      level: 'campaign',
      time_range: JSON.stringify({ since: de, until: ate }),
      limit: '500',
    },
  )
}

// A Meta acrescenta " (state)" nos estados que têm cidade homônima (São Paulo,
// Rio de Janeiro, Acre) e devolve alguns nomes em inglês (ex.: "Federal District").
// Sem normalizar, esses estados — os maiores mercados — não casavam com BR_ESTADOS
// e sumiam do mapa. "Unknown" (localização não atribuída) segue sem match de propósito.
const REGIAO_ALIAS: Record<string, string> = {
  'Federal District': 'Distrito Federal',
}
function normalizarRegiao(nome: string): string {
  const limpo = nome.replace(/\s*\((?:state|estado)\)\s*$/i, '').trim()
  return REGIAO_ALIAS[limpo] ?? limpo
}

function metricasGeo(row: MetaInsightGeo) {
  return {
    investimento: parseFloat(row.spend) || 0,
    impressoes:   parseInt(row.impressions) || 0,
    cliques:      parseInt(row.inline_link_clicks ?? '0') || 0,
    compras:      pickAction(row.actions, ...ACTION_COMPRA),
    valorGerado:  pickAction(row.action_values, ...ACTION_COMPRA),
  }
}

export async function getGeoRegioesPorCampanha(de: string, ate: string): Promise<GeoCampanhaRow[]> {
  const rows = await fetchGeo('region', de, ate)
  const result: GeoCampanhaRow[] = []

  for (const row of rows) {
    const nome = normalizarRegiao(row.region ?? '')
    const info = BR_ESTADOS[nome]
    if (!info) continue  // ignora "Unknown" e estados de outros países

    result.push({
      campanhaId: row.campaign_id ?? '', campanhaNome: row.campaign_name ?? '',
      temperatura: deriveTemperatura(row.campaign_name ?? ''), objetivo: deriveObjetivo(row.campaign_name ?? ''),
      nome, sigla: info.sigla, lat: info.lat, lon: info.lon,
      ...metricasGeo(row),
    })
  }

  return result
}

export async function getGeoPaisesPorCampanha(de: string, ate: string): Promise<GeoCampanhaRow[]> {
  const rows = await fetchGeo('country', de, ate)
  const result: GeoCampanhaRow[] = []

  for (const row of rows) {
    const iso = (row.country ?? '').toUpperCase()
    if (!iso) continue
    const info = PAISES_GEO[iso]

    // País fora do dicionário NÃO é descartado (gasto real sumia do mapa em
    // silêncio): entra com o código ISO como nome e sem coordenada — a tela
    // lista no rodapé "fora do mapa". Para pintá-lo, adicionar a PAISES_GEO
    // (aqui) e a ISO_NUM_TO_ALPHA2 (TelaTendencias).
    result.push({
      campanhaId: row.campaign_id ?? '', campanhaNome: row.campaign_name ?? '',
      temperatura: deriveTemperatura(row.campaign_name ?? ''), objetivo: deriveObjetivo(row.campaign_name ?? ''),
      nome: info?.nome ?? iso, sigla: iso, lat: info?.lat ?? NaN, lon: info?.lon ?? NaN,
      ...metricasGeo(row),
    })
  }

  return result
}
