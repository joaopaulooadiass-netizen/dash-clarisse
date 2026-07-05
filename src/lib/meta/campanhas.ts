import type { Campanha, Temperatura } from '@/lib/types'
import { metaGetAll, accountPath, fatiarPeriodo } from './client'
import { pickAction, ACTION_COMPRA, ACTION_LEAD, ACTION_PAGEVIEW, ACTION_VIEW_CONTENT, ACTION_CHECKOUT, ACTION_SEGUIDOR, ACTION_REGISTRO, ACTION_CONTATO, ACTION_POST_ENGAGEMENT, type MetaAction } from './actions'
import { derivarMetricas } from '@/lib/metrics/derivar'
import {
  readCache, upsertCache, getDatesInCache, cacheCompleto, cutoffDate,
  type CacheRow,
} from '@/lib/supabase/meta-cache'
import { subDias } from '@/lib/utils/data'

// ─── Tipos brutos da API ──────────────────────────────────────────────────────

interface MetaCampanha {
  id: string
  name: string
  status: string
  objective: string
  created_time: string
}

interface MetaCampanhaInsight {
  campaign_id: string
  spend: string
  impressions: string
  inline_link_clicks: string
  ctr: string
  cpm: string
  actions?: MetaAction[]
  action_values?: MetaAction[]
}

interface MetaCampanhaInsightDiario {
  campaign_id: string
  campaign_name: string
  spend: string
  impressions: string
  inline_link_clicks: string
  actions?: MetaAction[]
  action_values?: MetaAction[]
  date_start: string
}

export interface CampanhaMetricaDia {
  campanhaId: string
  campanhaNome: string
  data: string
  gasto: number
  impressoes: number
  cliques: number
  sessoes: number
  leads: number
  checkout: number
  vendas: number
  receita: number
  seguidores: number
}

export interface CampanhaComMetricas {
  id: string
  nome: string
  temperatura: Temperatura
  tag: '[F]' | '[Q]' | null
  ativa: boolean
  impressoes: number
  cpm: number
  ctr: number
  cpc: number
  cliques: number
  connectRate: number
  pctCheckout: number
  pctCompras: number
  compras: number
  valorGerado: number
  investimento: number
  roas: number
  cac: number
  seguidores: number
  pageView: number    // landing_page_view (base das taxas LP→Venda / LP→Lead)
  viewContent: number // ViewContent do pixel — métrica PRÓPRIA, nunca fallback de pageView
  leads: number       // lead
  inicioCheckout: number // initiate_checkout (base para totais exatos de %Checkout/%Compras)
  resultado: number | null // contagem do evento que a campanha otimiza; null = a busca por adset FALHOU (rate limit) — tela mostra '—', nunca 0 falso
  objetivo: string    // rótulo do objetivo predominante ('Conversões', 'Visita ao Perfil', 'Misto'...)
  unidadeResultado: string // EVENTO contado no Resultado ('purchase', 'lead', 'custom.<id>', 'misto'...) — mais fino que o rótulo
}

interface MetaAdsetRaw {
  id: string
  name: string
  status: string
  campaign_id: string
}

interface MetaAdRaw {
  id: string
  name: string
  status: string
  adset_id: string
  campaign_id: string
}

export interface ConjuntoResumo {
  id: string
  nome: string
  ativo: boolean
}

export interface AnuncioResumo {
  id: string
  nome: string
  ativo: boolean
  conjuntoId: string
}

export interface EstruturaCampanha {
  conjuntos: ConjuntoResumo[]
  anuncios: AnuncioResumo[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deriveTemperatura(nome: string): Temperatura {
  const n = nome.toUpperCase()
  if (n.includes('[F]')) return 'fundo'
  if (n.includes('[Q]')) return 'quente'
  return 'neutro'
}

function deriveTag(nome: string): '[F]' | '[Q]' | null {
  const n = nome.toUpperCase()
  if (n.includes('[F]')) return '[F]'
  if (n.includes('[Q]')) return '[Q]'
  return null
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function getCampanhasReal(): Promise<Campanha[]> {
  const contaMetaId = accountPath()

  const rows = await metaGetAll<MetaCampanha>(
    `${contaMetaId}/campaigns`,
    {
      fields: 'id,name,status,objective,created_time',
      limit: '200',
    },
  )

  return rows.map(c => ({
    id:              c.id,
    contaMetaId,
    metaCampanhaId:  c.id,
    nome:            c.name,
    temperatura:     deriveTemperatura(c.name),
    tag:             deriveTag(c.name),
    ativa:           c.status === 'ACTIVE',
    criadoEm:        c.created_time,
  }))
}

// Mapa leve campanhaId → ativa, para o filtro de status das telas cujas linhas
// vêm só de insights (Diária, Tendências, Posicionamento) — insights não traz status
export async function getCampanhasAtivas(): Promise<Record<string, boolean>> {
  const campanhas = await getCampanhasReal()
  return Object.fromEntries(campanhas.map(c => [c.id, c.ativa]))
}

async function getCampanhaInsights(since: string, until: string): Promise<Map<string, MetaCampanhaInsight>> {
  const rows = await metaGetAll<MetaCampanhaInsight>(
    `${accountPath()}/insights`,
    {
      fields: [
        'campaign_id',
        'spend',
        'impressions',
        'inline_link_clicks',
        'ctr',
        'cpm',
        'actions',
        'action_values',
      ].join(','),
      level: 'campaign',
      time_range: JSON.stringify({ since, until }),
      limit: '500',
    },
    5,
  )

  const map = new Map<string, MetaCampanhaInsight>()
  for (const row of rows) map.set(row.campaign_id, row)
  return map
}

// ─── Resultado dinâmico (por optimization_goal do conjunto) ───────────────────
// Cada conjunto otimiza um evento diferente; o "Resultado" da campanha é a SOMA,
// por conjunto, do evento que cada um otimiza (decisão João 2026-06-15). Mapa de
// objetivo → evento confirmado na conta real (ver docs/metricas-catalogo.md).

interface MetaAdsetGoal {
  id: string
  campaign_id: string
  optimization_goal?: string
  promoted_object?: { custom_event_type?: string; custom_conversion_id?: string }
}

interface MetaAdsetInsightResultado {
  adset_id: string
  impressions?: string
  inline_link_clicks?: string
  reach?: string
  instagram_profile_visits?: string
  actions?: MetaAction[]
  video_thruplay_watched_actions?: MetaAction[]
}

const GOAL_LABEL: Record<string, string> = {
  OFFSITE_CONVERSIONS: 'Conversões',
  PROFILE_VISIT: 'Visita ao Perfil',
  VISIT_INSTAGRAM_PROFILE: 'Visita ao Perfil',
  POST_ENGAGEMENT: 'Engajamento',
  THRUPLAY: 'ThruPlay',
  IMPRESSIONS: 'Impressões',
  REACH: 'Alcance',
  LINK_CLICKS: 'Cliques',
  LANDING_PAGE_VIEWS: 'Page View',
  VIDEO_VIEWS: '3s Views',
}

// Conta o resultado de UM conjunto conforme o evento que ele otimiza.
function resultadoDoAdset(a: MetaAdsetGoal, ins: MetaAdsetInsightResultado | undefined): number {
  if (!ins) return 0
  switch (a.optimization_goal) {
    case 'OFFSITE_CONVERSIONS':
      switch (a.promoted_object?.custom_event_type) {
        case 'PURCHASE':              return pickAction(ins.actions, ...ACTION_COMPRA)
        case 'LEAD':                  return pickAction(ins.actions, ...ACTION_LEAD)
        case 'COMPLETE_REGISTRATION': return pickAction(ins.actions, ...ACTION_REGISTRO)
        case 'CONTACT':               return pickAction(ins.actions, ...ACTION_CONTATO)
        default: {
          // custom_event_type OTHER/ausente = conversão PERSONALIZADA. O insight
          // reporta como 'offsite_conversion.custom.<id>' — contamos exatamente o
          // evento que o conjunto otimiza (na conta: 12 adsets assim, verificado
          // 2026-07-01). Antes caía em COMPRA, evento que esses conjuntos nem otimizam.
          const ccid = a.promoted_object?.custom_conversion_id
          if (ccid) return pickAction(ins.actions, `offsite_conversion.custom.${ccid}`)
          return pickAction(ins.actions, ...ACTION_COMPRA)
        }
      }
    case 'PROFILE_VISIT':
    case 'VISIT_INSTAGRAM_PROFILE': return parseInt(ins.instagram_profile_visits ?? '0') || 0
    case 'POST_ENGAGEMENT':         return pickAction(ins.actions, ...ACTION_POST_ENGAGEMENT)
    case 'THRUPLAY':                return pickAction(ins.video_thruplay_watched_actions, 'video_view')
    case 'LANDING_PAGE_VIEWS':      return pickAction(ins.actions, ...ACTION_PAGEVIEW)
    case 'LINK_CLICKS':             return parseInt(ins.inline_link_clicks ?? '0') || 0
    case 'IMPRESSIONS':             return parseInt(ins.impressions ?? '0') || 0
    case 'REACH':                   return parseInt(ins.reach ?? '0') || 0
    default:                        return 0
  }
}

// Unidade do resultado — o EVENTO contado, mais fino que o rótulo do objetivo:
// 'Conversões' (OFFSITE_CONVERSIONS) cobre purchase, lead, registro, contato e
// conversões personalizadas. A linha de totais só pode somar Resultados de MESMA
// unidade; comparar só o rótulo deixava passar compras+leads somados.
function unidadeDoAdset(a: MetaAdsetGoal): string {
  if (a.optimization_goal !== 'OFFSITE_CONVERSIONS') return a.optimization_goal ?? '—'
  switch (a.promoted_object?.custom_event_type) {
    case 'PURCHASE':              return 'purchase'
    case 'LEAD':                  return 'lead'
    case 'COMPLETE_REGISTRATION': return 'registro'
    case 'CONTACT':               return 'contato'
    default: {
      const ccid = a.promoted_object?.custom_conversion_id
      return ccid ? `custom.${ccid}` : 'purchase'
    }
  }
}

export async function getResultadoPorCampanha(since: string, until: string): Promise<Map<string, { resultado: number; objetivo: string; unidade: string }>> {
  const conta = accountPath()
  const [adsets, insights] = await Promise.all([
    metaGetAll<MetaAdsetGoal>(`${conta}/adsets`, { fields: 'id,campaign_id,optimization_goal,promoted_object', limit: '500' }, 5),
    metaGetAll<MetaAdsetInsightResultado>(`${conta}/insights`, {
      fields: 'adset_id,impressions,inline_link_clicks,reach,instagram_profile_visits,actions,video_thruplay_watched_actions',
      level: 'adset',
      time_range: JSON.stringify({ since, until }),
      limit: '500',
    }, 5),
  ])

  const insByAdset = new Map(insights.map(i => [i.adset_id, i]))
  const acc = new Map<string, { resultado: number; objetivos: Set<string>; unidades: Set<string> }>()
  for (const a of adsets) {
    const ins = insByAdset.get(a.id)
    const r = resultadoDoAdset(a, ins)
    const cur = acc.get(a.campaign_id) ?? { resultado: 0, objetivos: new Set<string>(), unidades: new Set<string>() }
    cur.resultado += r
    // Só adsets COM entrega no período carimbam objetivo/unidade — um conjunto
    // pausado desde sempre não pode transformar a campanha em 'Misto'.
    if (ins && a.optimization_goal) {
      cur.objetivos.add(GOAL_LABEL[a.optimization_goal] ?? a.optimization_goal)
      cur.unidades.add(unidadeDoAdset(a))
    }
    acc.set(a.campaign_id, cur)
  }

  const out = new Map<string, { resultado: number; objetivo: string; unidade: string }>()
  for (const [cid, v] of acc) {
    const objetivo = v.objetivos.size === 0 ? '—' : v.objetivos.size === 1 ? [...v.objetivos][0] : 'Misto'
    const unidade = v.unidades.size === 0 ? '—' : v.unidades.size === 1 ? [...v.unidades][0] : 'misto'
    out.set(cid, { resultado: v.resultado, objetivo, unidade })
  }
  return out
}

export async function getCampanhasComMetricas(since: string, until: string): Promise<CampanhaComMetricas[]> {
  const [campanhas, insights, resultados] = await Promise.all([
    getCampanhasReal(),
    getCampanhaInsights(since, until),
    // null (não Map vazio) quando falha: Map vazio viraria "Resultado 0" em toda
    // campanha — dado falso com cara de real ao lado de Investimento/Compras reais
    getResultadoPorCampanha(since, until).catch(() => null),
  ])

  return campanhas.map(c => {
    const ins = insights.get(c.metaCampanhaId)
    const res = resultados?.get(c.metaCampanhaId)

    const gasto      = ins ? parseFloat(ins.spend) || 0 : 0
    const impressoes = ins ? parseInt(ins.impressions) || 0 : 0
    const cliques    = ins ? parseInt(ins.inline_link_clicks) || 0 : 0

    const pageView    = ins ? pickAction(ins.actions, ...ACTION_PAGEVIEW) : 0
    const viewContent = ins ? pickAction(ins.actions, ...ACTION_VIEW_CONTENT) : 0
    const leads       = ins ? pickAction(ins.actions, ...ACTION_LEAD) : 0
    const checkout    = ins ? pickAction(ins.actions, ...ACTION_CHECKOUT) : 0
    const compras     = ins ? pickAction(ins.actions, ...ACTION_COMPRA) : 0
    const valorGerado = ins ? pickAction(ins.action_values, ...ACTION_COMPRA) : 0
    const seguidores  = ins ? pickAction(ins.actions, ...ACTION_SEGUIDOR) : 0

    // Derivadas da fonte única — uma fórmula só (ver lib/metrics/derivar.ts)
    const d = derivarMetricas({
      gasto, impressoes, cliques, pageView, leads,
      inicioCheckout: checkout, compras, valorGerado, seguidores,
    })

    return {
      id:           c.id,
      nome:         c.nome,
      temperatura:  c.temperatura,
      tag:          c.tag,
      ativa:        c.ativa,
      impressoes,
      cpm:          d.cpm,
      ctr:          d.ctr,
      cpc:          d.cpc,
      cliques,
      connectRate:  d.connectRate,
      pctCheckout:  d.pctCheckout,   // início de checkout ÷ pageView (decisão João)
      pctCompras:   d.taxaConvIC,    // compras ÷ início de checkout
      compras,
      valorGerado,
      investimento: gasto,
      roas:         d.roas,
      cac:          d.cac,
      seguidores,
      pageView,
      viewContent,
      leads,
      inicioCheckout: checkout,
      resultado:    resultados ? (res?.resultado ?? 0) : null,
      objetivo:     res?.objetivo ?? '—',
      unidadeResultado: res?.unidade ?? '—',
    }
  })
}

export async function getEstruturaCampanhas(): Promise<Record<string, EstruturaCampanha>> {
  const conta = accountPath()

  const [adsets, ads] = await Promise.all([
    metaGetAll<MetaAdsetRaw>(`${conta}/adsets`, {
      fields: 'id,name,status,campaign_id',
      limit: '500',
    }),
    metaGetAll<MetaAdRaw>(`${conta}/ads`, {
      fields: 'id,name,status,adset_id,campaign_id',
      limit: '500',
    }),
  ])

  const estrutura: Record<string, EstruturaCampanha> = {}
  const grupo = (campaignId: string): EstruturaCampanha =>
    estrutura[campaignId] ??= { conjuntos: [], anuncios: [] }

  for (const a of adsets) {
    grupo(a.campaign_id).conjuntos.push({ id: a.id, nome: a.name, ativo: a.status === 'ACTIVE' })
  }
  for (const a of ads) {
    grupo(a.campaign_id).anuncios.push({ id: a.id, nome: a.name, ativo: a.status === 'ACTIVE', conjuntoId: a.adset_id })
  }

  return estrutura
}

// Métricas diárias por campanha — permite que KPIs, funil e gráfico da Visão
// Geral sejam recalculados a partir do mesmo recorte de campanhas filtradas
// pelo filtro inteligente, em vez de usar agregados de conta independentes.
function cacheRowToCampanhaMetricaDia(row: CacheRow): CampanhaMetricaDia {
  return {
    campanhaId:   row.entity_id,
    campanhaNome: row.entity_name ?? '',
    data:         row.date_start,
    gasto:      row.spend,
    impressoes: row.impressions,
    cliques:    row.inline_link_clicks,
    sessoes:    pickAction(row.actions ?? [], ...ACTION_PAGEVIEW),
    leads:      pickAction(row.actions ?? [], ...ACTION_LEAD),
    checkout:   pickAction(row.actions ?? [], ...ACTION_CHECKOUT),
    vendas:     pickAction(row.actions ?? [], ...ACTION_COMPRA),
    receita:    pickAction(row.action_values ?? [], ...ACTION_COMPRA),
    seguidores: pickAction(row.actions ?? [], ...ACTION_SEGUIDOR),
  }
}

async function fetchCampanhaInsightsDiarios(since: string, until: string): Promise<MetaCampanhaInsightDiario[]> {
  const rows: MetaCampanhaInsightDiario[] = []
  // Sequencial de propósito: janelas em paralelo estouram o rate limit da conta
  for (const janela of fatiarPeriodo(since, until)) {
    const parte = await metaGetAll<MetaCampanhaInsightDiario>(
      `${accountPath()}/insights`,
      {
        fields: ['campaign_id', 'campaign_name', 'spend', 'impressions', 'inline_link_clicks', 'actions', 'action_values'].join(','),
        level: 'campaign',
        time_increment: '1',
        time_range: JSON.stringify(janela),
        limit: '500',
      },
      30,
    )
    rows.push(...parte)
  }
  return rows
}

function campanhaApiRowToCacheRow(accountId: string, r: MetaCampanhaInsightDiario): CacheRow {
  return {
    account_id:                     accountId,
    level:                          'campaign' as const,
    entity_id:                      r.campaign_id,
    entity_name:                    r.campaign_name,
    date_start:                     r.date_start,
    spend:                          parseFloat(r.spend) || 0,
    impressions:                    parseInt(r.impressions) || 0,
    inline_link_clicks:             parseInt(r.inline_link_clicks) || 0,
    reach:                          0,
    ctr:                            0,
    cpm:                            0,
    instagram_profile_visits:       0,
    actions:                        r.actions ?? null,
    action_values:                  r.action_values ?? null,
    video_p25_watched_actions:      null,
    video_p75_watched_actions:      null,
    video_p95_watched_actions:      null,
    video_thruplay_watched_actions: null,
  }
}

export async function getCampanhaMetricasDiarias(since: string, until: string): Promise<CampanhaMetricaDia[]> {
  const accountId = accountPath()
  const corte     = cutoffDate(90)

  // ONTEM e HOJE nunca saem do cache: o cron grava o dia corrente parcial às 3h
  // e `cacheCompleto` só confere a EXISTÊNCIA da data — sem este corte, a tela
  // servia o número congelado das 3h o dia inteiro (e ontem ainda recebe
  // conversões de atribuição tardia). O rabo fresco vem sempre da API, que de
  // passagem re-grava o cache com o valor atualizado.
  const fimCache  = until < subDias(2) ? until : subDias(2)   // cacheável até anteontem
  const iniFresco = since > subDias(1) ? since : subDias(1)   // ontem em diante = sempre API

  const frescoApi = iniFresco <= until ? await fetchCampanhaInsightsDiarios(iniFresco, until) : []
  const frescoRows = frescoApi.map(r => campanhaApiRowToCacheRow(accountId, r))
  if (frescoRows.length) await upsertCache(frescoRows).catch(e => console.error('[campanhas] upsert falhou:', e))
  const fresco = frescoRows.map(cacheRowToCampanhaMetricaDia)

  // Período pedido é só ontem/hoje — não há trecho cacheável
  if (since > fimCache) return fresco

  if (since >= corte) {
    const datesNoCache = await getDatesInCache(accountId, 'campaign', since, fimCache)
    if (cacheCompleto(datesNoCache, since, fimCache)) {
      const cached = await readCache(accountId, 'campaign', since, fimCache)
      return [...cached.map(cacheRowToCampanhaMetricaDia), ...fresco]
    }
    // Cache incompleto → busca da API e salva
    const apiRows = await fetchCampanhaInsightsDiarios(since, fimCache)
    const cacheRows = apiRows.map(r => campanhaApiRowToCacheRow(accountId, r))
    await upsertCache(cacheRows).catch(e => console.error('[campanhas] upsert falhou:', e))
    return [...cacheRows.map(cacheRowToCampanhaMetricaDia), ...fresco]
  }

  // Período além de 90 dias → API direta + salva parte recente no cache
  const apiRows = await fetchCampanhaInsightsDiarios(since, fimCache)
  const todas = apiRows.map(r => campanhaApiRowToCacheRow(accountId, r))
  await upsertCache(todas.filter(r => r.date_start >= corte))
    .catch(e => console.error('[campanhas] upsert falhou:', e))

  return [...todas.map(cacheRowToCampanhaMetricaDia), ...fresco]
}
