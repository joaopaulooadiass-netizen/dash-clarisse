import type { MetricasCampanhaDia } from '@/lib/types'
import { metaGetAll, accountPath, fatiarPeriodo } from './client'
import { pickAction, ACTION_COMPRA, ACTION_SEGUIDOR, type MetaAction } from './actions'
import {
  readCache, upsertCache, getDatesInCache, cacheCompleto, cutoffDate,
  type CacheRow,
} from '@/lib/supabase/meta-cache'
import { subDias } from '@/lib/utils/data'

// ─── Tipos brutos da API ──────────────────────────────────────────────────────

interface MetaInsightRow {
  spend: string
  impressions: string
  inline_link_clicks: string
  reach?: string
  actions?: MetaAction[]
  action_values?: MetaAction[]
  ctr: string
  cpm: string
  date_start: string
  date_stop: string
}

// ─── Conversão cache → MetricasCampanhaDia ────────────────────────────────────

function cacheRowToMetricaDia(row: CacheRow): MetricasCampanhaDia {
  const gasto      = row.spend
  const impressoes = row.impressions
  const cliques    = row.inline_link_clicks

  // SÓ compras — a versão antiga caía em lead quando não havia purchase no dia,
  // e a métrica mudava de espécie conforme o dia (regra do projeto: nunca misturar)
  const conversoes = pickAction(row.actions ?? [], ...ACTION_COMPRA)
  const receita    = pickAction(row.action_values ?? [], ...ACTION_COMPRA)
  const ctr        = row.ctr

  return {
    campanhaId:    'conta-meta',
    data:          row.date_start,
    gasto,
    impressoes,
    cliques,
    conversoes,
    receita,
    seguidores:    pickAction(row.actions ?? [], ...ACTION_SEGUIDOR),
    ctr,
    cpl:           conversoes > 0 ? gasto / conversoes : 0,
    roas:          gasto > 0      ? receita / gasto    : 0,
    taxaConversao: cliques > 0    ? (conversoes / cliques) * 100 : 0,
  }
}

// ─── Fetch da API → cache row ─────────────────────────────────────────────────

async function fetchAccountInsights(accountId: string, since: string, until: string): Promise<CacheRow[]> {
  const conta = accountPath()
  const rows: MetaInsightRow[] = []

  for (const janela of fatiarPeriodo(since, until)) {
    const parte = await metaGetAll<MetaInsightRow>(
      `${conta}/insights`,
      {
        fields: 'spend,impressions,inline_link_clicks,reach,ctr,cpm,actions,action_values',
        time_increment: '1',
        level: 'account',
        time_range: JSON.stringify(janela),
        limit: '500',
      },
    )
    rows.push(...parte)
  }

  return rows.map(r => ({
    account_id:                     accountId,
    level:                          'account' as const,
    entity_id:                      accountId,
    entity_name:                    null,
    date_start:                     r.date_start,
    spend:                          parseFloat(r.spend) || 0,
    impressions:                    parseInt(r.impressions) || 0,
    inline_link_clicks:             parseInt(r.inline_link_clicks) || 0,
    reach:                          parseInt(r.reach ?? '0') || 0,
    ctr:                            parseFloat(r.ctr) || 0,
    cpm:                            parseFloat(r.cpm) || 0,
    instagram_profile_visits:       0,
    actions:                        r.actions ?? null,
    action_values:                  r.action_values ?? null,
    video_p25_watched_actions:      null,
    video_p75_watched_actions:      null,
    video_p95_watched_actions:      null,
    video_thruplay_watched_actions: null,
  }))
}

// ─── Insights de conta (agregado diário) ─────────────────────────────────────

// Estratégia:
// 1. ONTEM e HOJE: sempre API (o cron grava o dia corrente parcial às 3h e
//    `cacheCompleto` só confere existência — sem isso a tela servia o número
//    congelado das 3h o dia inteiro; ontem ainda recebe atribuição tardia).
// 2. Datas até anteontem dentro da janela de 90 dias: cache-first.
// 3. Datas além de 90 dias: API (e salva a parte recente no cache).
export async function getMetricasDiarias(
  de: string,
  ate: string,
): Promise<MetricasCampanhaDia[]> {
  const accountId = accountPath()
  const corte     = cutoffDate(90)

  const fimCache  = ate < subDias(2) ? ate : subDias(2)   // cacheável até anteontem
  const iniFresco = de > subDias(1) ? de : subDias(1)     // ontem em diante = sempre API

  const frescoRows = iniFresco <= ate ? await fetchAccountInsights(accountId, iniFresco, ate) : []
  if (frescoRows.length) await upsertCache(frescoRows).catch(e => console.error('[insights] upsert falhou:', e))

  // Período pedido é só ontem/hoje
  if (de > fimCache) return frescoRows.map(cacheRowToMetricaDia)

  // Período inteiramente dentro da janela de cache
  if (de >= corte) {
    const datesNoCache = await getDatesInCache(accountId, 'account', de, fimCache)
    if (cacheCompleto(datesNoCache, de, fimCache)) {
      const cached = await readCache(accountId, 'account', de, fimCache)
      return [...cached, ...frescoRows].map(cacheRowToMetricaDia)
    }
    // Cache incompleto → busca da API e atualiza
    const apiRows = await fetchAccountInsights(accountId, de, fimCache)
    await upsertCache(apiRows).catch(e => console.error('[insights] upsert falhou:', e))
    return [...apiRows, ...frescoRows].map(cacheRowToMetricaDia)
  }

  // Período misto: parte antiga (API) + meio (cache) + rabo fresco (API)
  const [apiRows, cachedRows] = await Promise.all([
    fetchAccountInsights(accountId, de, corte),
    readCache(accountId, 'account', corte, fimCache),
  ])
  // Salva a parte nova da API no cache
  await upsertCache(apiRows.filter(r => r.date_start >= corte))
    .catch(e => console.error('[insights] upsert falhou:', e))

  // Dedup por data: o dia-fronteira `corte` vinha da API (until inclusivo) E do
  // cache (gte corte) — aparecia DUPLICADO e o Faturamento somava o gasto 2×.
  // Ordem do overwrite: cache < API antiga < fresco (mais recente vence).
  const porData = new Map<string, CacheRow>()
  for (const r of [...cachedRows, ...apiRows, ...frescoRows]) porData.set(r.date_start, r)
  return Array.from(porData.values())
    .sort((a, b) => a.date_start.localeCompare(b.date_start))
    .map(cacheRowToMetricaDia)
}
