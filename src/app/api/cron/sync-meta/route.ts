import { NextRequest, NextResponse } from 'next/server'
import { metaGetAll, accountPath, fatiarPeriodo } from '@/lib/meta/client'
import { upsertCache, cutoffDate, type CacheRow } from '@/lib/supabase/meta-cache'
import { hoje, subDias } from '@/lib/utils/data'
import type { MetaAction } from '@/lib/meta/actions'

// ─── Tipos brutos da API ──────────────────────────────────────────────────────

interface RawAccountInsight {
  spend: string
  impressions: string
  inline_link_clicks: string
  reach?: string
  ctr: string
  cpm: string
  actions?: MetaAction[]
  action_values?: MetaAction[]
  date_start: string
}

interface RawCampaignInsight {
  campaign_id: string
  campaign_name: string
  spend: string
  impressions: string
  inline_link_clicks: string
  ctr?: string
  cpm?: string
  actions?: MetaAction[]
  action_values?: MetaAction[]
  date_start: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function autenticado(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  // Vercel Cron envia o secret no header; chamadas manuais podem usar Bearer
  const authHeader = req.headers.get('authorization') ?? ''
  const queryKey = new URL(req.url).searchParams.get('key') ?? ''
  return authHeader === `Bearer ${secret}` || queryKey === secret
}

// ─── Sync account level ───────────────────────────────────────────────────────

async function syncAccount(accountId: string, since: string, until: string): Promise<number> {
  const conta = accountPath()
  const rows: RawAccountInsight[] = []

  for (const janela of fatiarPeriodo(since, until)) {
    const parte = await metaGetAll<RawAccountInsight>(
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

  const cacheRows: CacheRow[] = rows.map(r => ({
    account_id:                     accountId,
    level:                          'account',
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

  await upsertCache(cacheRows)
  return cacheRows.length
}

// ─── Sync campaign level ──────────────────────────────────────────────────────

async function syncCampaign(accountId: string, since: string, until: string): Promise<number> {
  const conta = accountPath()
  const rows: RawCampaignInsight[] = []

  for (const janela of fatiarPeriodo(since, until)) {
    const parte = await metaGetAll<RawCampaignInsight>(
      `${conta}/insights`,
      {
        fields: 'campaign_id,campaign_name,spend,impressions,inline_link_clicks,ctr,cpm,actions,action_values',
        time_increment: '1',
        level: 'campaign',
        time_range: JSON.stringify(janela),
        limit: '500',
      },
      30,
    )
    rows.push(...parte)
  }

  const cacheRows: CacheRow[] = rows.map(r => ({
    account_id:                     accountId,
    level:                          'campaign',
    entity_id:                      r.campaign_id,
    entity_name:                    r.campaign_name,
    date_start:                     r.date_start,
    spend:                          parseFloat(r.spend) || 0,
    impressions:                    parseInt(r.impressions) || 0,
    inline_link_clicks:             parseInt(r.inline_link_clicks) || 0,
    reach:                          0,
    ctr:                            parseFloat(r.ctr ?? '0') || 0,
    cpm:                            parseFloat(r.cpm ?? '0') || 0,
    instagram_profile_visits:       0,
    actions:                        r.actions ?? null,
    action_values:                  r.action_values ?? null,
    video_p25_watched_actions:      null,
    video_p75_watched_actions:      null,
    video_p95_watched_actions:      null,
    video_thruplay_watched_actions: null,
  }))

  await upsertCache(cacheRows)
  return cacheRows.length
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!autenticado(req)) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
  }

  const url = new URL(req.url)
  // mode=backfill → 90 dias completos; mode=daily (padrão) → últimos 7 dias.
  // 7 (e não 2): se uma execução falhar, a próxima re-cobre o buraco sozinha; e
  // conversões atribuídas com atraso (janela de 7d de clique) entram no cache.
  const modo = url.searchParams.get('mode') === 'backfill' ? 'backfill' : 'daily'

  const until = hoje()  // fuso BRT — em UTC, entre 21h e 3h o "hoje" apontava pro dia errado
  const since = modo === 'backfill' ? cutoffDate(90) : subDias(7)

  const accountId = accountPath()

  try {
    const [nAccount, nCampaign] = await Promise.all([
      syncAccount(accountId, since, until),
      syncCampaign(accountId, since, until),
    ])

    return NextResponse.json({
      ok: true,
      modo,
      since,
      until,
      linhas: { account: nAccount, campaign: nCampaign },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron/sync-meta]', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// GET para facilitar trigger manual via browser (com ?key=...)
export async function GET(req: NextRequest) {
  return POST(req)
}
