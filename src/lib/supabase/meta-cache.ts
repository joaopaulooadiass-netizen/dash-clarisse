import { getSupabaseServer } from './server'
export { supabaseConfigurado } from './server'
import type { MetaAction } from '@/lib/meta/actions'
import { subDias } from '@/lib/utils/data'

// ─── Tipo da linha no banco ───────────────────────────────────────────────────

export interface CacheRow {
  account_id: string
  level: 'account' | 'campaign' | 'adset' | 'ad'
  entity_id: string
  entity_name: string | null
  date_start: string        // 'YYYY-MM-DD'
  spend: number
  impressions: number
  inline_link_clicks: number
  reach: number
  ctr: number
  cpm: number
  instagram_profile_visits: number
  actions: MetaAction[] | null
  action_values: MetaAction[] | null
  video_p25_watched_actions: MetaAction[] | null
  video_p75_watched_actions: MetaAction[] | null
  video_p95_watched_actions: MetaAction[] | null
  video_thruplay_watched_actions: MetaAction[] | null
}

// ─── Leitura ──────────────────────────────────────────────────────────────────

export async function readCache(
  accountId: string,
  level: CacheRow['level'],
  since: string,
  until: string,
): Promise<CacheRow[]> {
  const sb = getSupabaseServer()
  if (!sb) return [] // sem Supabase → cache sempre vazio, callers caem na API

  const { data, error } = await sb
    .from('meta_insights_cache')
    .select('*')
    .eq('account_id', accountId)
    .eq('level', level)
    .gte('date_start', since)
    .lte('date_start', until)
    .order('date_start')

  if (error) {
    console.error('[meta-cache] readCache error:', error.message)
    return []
  }
  return (data ?? []) as CacheRow[]
}

// Retorna o conjunto de datas (YYYY-MM-DD) já presentes no cache para o range
export async function getDatesInCache(
  accountId: string,
  level: CacheRow['level'],
  since: string,
  until: string,
): Promise<Set<string>> {
  const sb = getSupabaseServer()
  if (!sb) return new Set() // cache "incompleto" → força busca na API

  const { data, error } = await sb
    .from('meta_insights_cache')
    .select('date_start')
    .eq('account_id', accountId)
    .eq('level', level)
    .gte('date_start', since)
    .lte('date_start', until)

  if (error) {
    console.error('[meta-cache] getDatesInCache error:', error.message)
    return new Set()
  }
  return new Set((data ?? []).map(r => r.date_start as string))
}

// ─── Escrita ──────────────────────────────────────────────────────────────────

export async function upsertCache(rows: CacheRow[]): Promise<void> {
  if (rows.length === 0) return

  const sb = getSupabaseServer()
  if (!sb) return // sem Supabase → gravação é no-op silencioso

  const { error } = await sb
    .from('meta_insights_cache')
    .upsert(
      rows.map(r => ({ ...r, synced_at: new Date().toISOString() })),
      { onConflict: 'account_id,level,entity_id,date_start' },
    )

  if (error) {
    console.error('[meta-cache] upsertCache error:', error.message)
    throw new Error(`Falha ao gravar cache: ${error.message}`)
  }
}

// ─── Helpers de data ──────────────────────────────────────────────────────────

// Data de corte: hoje menos N dias (YYYY-MM-DD, fuso America/Sao_Paulo — a
// versão antiga usava toISOString/UTC e errava a fronteira à noite)
export function cutoffDate(dias = 90): string {
  return subDias(dias)
}

// Dias esperados entre since e until (inclusive)
export function expectedDays(since: string, until: string): number {
  const diff = new Date(until).getTime() - new Date(since).getTime()
  return Math.round(diff / 86_400_000) + 1
}

// Cache é considerado completo se tiver ≥ 90% dos dias esperados
export function cacheCompleto(datesInCache: Set<string>, since: string, until: string): boolean {
  const esperado = expectedDays(since, until)
  return datesInCache.size >= Math.floor(esperado * 0.9)
}
