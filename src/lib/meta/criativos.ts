import type { Criativo, CriativoMetricas } from '@/lib/types'
import { classificarPorMedia, ctrMedioPonderado, MIN_IMPRESSOES_AMOSTRA } from '@/lib/utils/classificacao'
import { MetaAPIError, metaGet, metaGetAll, accountPath } from './client'
import { pickAction, ACTION_COMPRA, ACTION_LEAD, ACTION_PAGEVIEW, ACTION_VIEW_CONTENT, ACTION_SEGUIDOR, ACTION_VIDEO_3S, ACTION_POST_ENGAGEMENT, ACTION_REACTION, ACTION_COMMENT, ACTION_SHARE, ACTION_SAVE } from './actions'
import { derivarMetricas } from '@/lib/metrics/derivar'

// ─── Tipos brutos da API ──────────────────────────────────────────────────────

interface MetaAd {
  id: string
  name: string
  status: string
  adset_id: string
  campaign_id?: string
  campaign?: { id: string; name: string }
  created_time: string
  creative?: {
    id: string
    thumbnail_url?: string
    image_url?: string
    video_id?: string
    instagram_permalink_url?: string
    object_story_spec?: {
      video_data?: {
        video_id?: string
        image_url?: string
      }
      link_data?: {
        picture?: string
      }
      photo_data?: {
        url?: string
      }
      template_data?: {
        picture?: string
      }
    }
  }
}

interface MetaAdInsight {
  ad_id: string
  ad_name: string
  spend: string
  impressions: string
  inline_link_clicks: string
  ctr: string
  cpm: string
  actions?: { action_type: string; value: string }[]
  action_values?: { action_type: string; value: string }[]
  video_p25_watched_actions?: { action_type: string; value: string }[]
  video_p75_watched_actions?: { action_type: string; value: string }[]
  video_p95_watched_actions?: { action_type: string; value: string }[]
  video_thruplay_watched_actions?: { action_type: string; value: string }[]
  instagram_profile_visits?: string
}

interface MetaVideo {
  source?: string
  picture?: string
  permalink_url?: string
  length?: number
}

type MetaCreative = NonNullable<MetaAd['creative']>

// ─── Helpers ──────────────────────────────────────────────────────────────────

const THUMB_COLORS = [
  'linear-gradient(135deg, #5F8A3C 0%, #3F5320 100%)',
  'linear-gradient(135deg, #5C79C9 0%, #36497E 100%)',
  'linear-gradient(135deg, #9A86D6 0%, #5E4B99 100%)',
  'linear-gradient(135deg, #7D68C0 0%, #46356E 100%)',
  'linear-gradient(135deg, #8DB82F 0%, #5F8A3C 100%)',
  'linear-gradient(135deg, #D9805C 0%, #A85434 100%)',
  'linear-gradient(135deg, #46619E 0%, #26385E 100%)',
  'linear-gradient(135deg, #6E6E66 0%, #3E3E38 100%)',
]

function deriveTipo(nome: string): string {
  const n = nome.toLowerCase()
  if (n.includes('carrossel') || n.includes('carousel')) return 'carrossel'
  if (n.includes('static') || n.includes('imagem') || n.includes('banner')) return 'imagem'
  return 'vídeo'
}

// ─── Fetch ads ────────────────────────────────────────────────────────────────

async function getAds(): Promise<MetaAd[]> {
  return metaGetAll<MetaAd>(
    `${accountPath()}/ads`,
    {
      fields: [
        'id',
        'name',
        'status',
        'adset_id',
        'campaign{id,name}',
        'created_time',
        'creative{thumbnail_url,image_url,video_id,instagram_permalink_url}',
      ].join(','),
      thumbnail_width: '600',
      thumbnail_height: '600',
      limit: '100',
    },
    1,
  )
}

async function getAdsByIds(adIds: string[]): Promise<MetaAd[]> {
  // SEM teto de 100: o corte silencioso fazia anúncios além do 100º (com gasto
  // real) sumirem da tela. Os lotes de 8 sequenciais já diluem o rate limit.
  const unique = Array.from(new Set(adIds.filter(Boolean)))
  const ads: MetaAd[] = []

  for (let i = 0; i < unique.length; i += 8) {
    const batch = unique.slice(i, i + 8)
    const batchAds = await Promise.all(
      batch.map(async id => {
        try {
          return await metaGet<MetaAd>(id, {
            fields: [
              'id',
              'name',
              'status',
              'adset_id',
              'created_time',
              'creative{thumbnail_url,image_url,video_id,instagram_permalink_url}',
            ].join(','),
            thumbnail_width: '600',
            thumbnail_height: '600',
          })
        } catch {
          return null
        }
      }),
    )
    ads.push(...batchAds.filter((ad): ad is MetaAd => !!ad))
  }

  return ads
}

async function getCreativeDetails(creativeIds: string[]): Promise<Map<string, Partial<MetaCreative>>> {
  const unique = Array.from(new Set(creativeIds.filter(Boolean))).slice(0, 80)
  const map = new Map<string, Partial<MetaCreative>>()

  for (let i = 0; i < unique.length; i += 8) {
    const batch = unique.slice(i, i + 8)
    const entries = await Promise.all(
      batch.map(async id => {
        try {
          const creative = await metaGet<Partial<MetaCreative>>(id, {
            fields: 'object_story_spec',
          })
          return [id, creative] as const
        } catch {
          return [id, null] as const
        }
      }),
    )

    for (const [id, creative] of entries) {
      if (creative) map.set(id, creative)
    }
  }

  return map
}

// ─── Fetch ad-level insights ──────────────────────────────────────────────────

async function getAdInsights(since: string, until: string): Promise<Map<string, MetaAdInsight>> {
  const time_range = JSON.stringify({ since, until })
  const fetchInsights = (fields: string[], maxPages = 4) => metaGetAll<MetaAdInsight>(
    `${accountPath()}/insights`,
    {
      fields: fields.join(','),
      level: 'ad',
      time_range,
      limit: '100',
    },
    maxPages,
  )

  const baseFields = [
    'ad_id',
    'ad_name',
    'spend',
    'impressions',
    'inline_link_clicks',
    'ctr',
    'cpm',
  ]
  const completeFields = [
    ...baseFields,
    'actions',
    'action_values',
    'video_p25_watched_actions',
    'video_p75_watched_actions',
    'video_p95_watched_actions',
    'video_thruplay_watched_actions',
    'instagram_profile_visits',
  ]

  let rows: MetaAdInsight[]
  try {
    rows = await fetchInsights(completeFields)
  } catch (error) {
    const metaError = error instanceof MetaAPIError ? error : null
    const code = (metaError?.body as { error?: { code?: number } })?.error?.code
    if (code !== 1) throw error
    rows = await fetchInsights(baseFields, 3)
  }

  const map = new Map<string, MetaAdInsight>()
  for (const row of rows) {
    map.set(row.ad_id, row)
  }
  return map
}

async function getVideos(videoIds: string[]): Promise<Map<string, MetaVideo>> {
  const unique = Array.from(new Set(videoIds.filter(Boolean))).slice(0, 80)
  const entries: (readonly [string, MetaVideo | null])[] = []

  for (let i = 0; i < unique.length; i += 8) {
    const batch = unique.slice(i, i + 8)
    const batchEntries = await Promise.all(
      batch.map(async id => {
      try {
        const video = await metaGet<MetaVideo>(id, {
          fields: 'source,picture,permalink_url,length',
        })
        return [id, video] as const
      } catch {
        return [id, null] as const
      }
      }),
    )
    entries.push(...batchEntries)
  }

  const map = new Map<string, MetaVideo>()
  for (const [id, video] of entries) {
    if (video) map.set(id, video)
  }
  return map
}

// ─── Combinar em CriativoMetricas ─────────────────────────────────────────────

export interface CriativoComMetricas {
  criativo: Criativo
  metricas: CriativoMetricas
}

function padrao14Dias(): { since: string; until: string } {
  const until = new Date()
  const since = new Date()
  since.setDate(until.getDate() - 13)
  return { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) }
}

export async function getCriativosComMetricas(
  since?: string,
  until?: string,
): Promise<CriativoComMetricas[]> {
  const intervalo = since && until ? { since, until } : padrao14Dias()
  const insights = await getAdInsights(intervalo.since, intervalo.until)
  const adsComInsight = await getAdsByIds(Array.from(insights.keys()))
  const ads = adsComInsight.length > 0 ? adsComInsight : await getAds()

  const videoAds = ads
    .filter(ad => {
      const ins = insights.get(ad.id)
      return !ins || (parseFloat(ins.spend) || 0) > 0 || (parseInt(ins.impressions) || 0) > 0
    })
    .sort((a, b) => {
      const aSpend = parseFloat(insights.get(a.id)?.spend ?? '0') || 0
      const bSpend = parseFloat(insights.get(b.id)?.spend ?? '0') || 0
      return bSpend - aSpend
    })
  const creativeDetails = await getCreativeDetails(
    videoAds.map(ad => ad.creative?.id).filter((id): id is string => !!id),
  )

  const adsComDetalhes = ads.map(ad => {
    const details = ad.creative?.id ? creativeDetails.get(ad.creative.id) : undefined
    return details
      ? { ...ad, creative: { ...ad.creative, ...details } }
      : ad
  })

  const videos = await getVideos(adsComDetalhes.flatMap(ad => {
    const creativeVideoId = ad.creative?.video_id
    const specVideoId = ad.creative?.object_story_spec?.video_data?.video_id
    return [creativeVideoId, specVideoId].filter((id): id is string => !!id)
  }))

  // Régua relativa: CTR médio (ponderado por impressões) dos criativos com
  // amostra. Cada criativo fica "acima" ou "abaixo" dessa média — sem meta fixa.
  const mediaCtr = ctrMedioPonderado(
    adsComDetalhes.map(ad => {
      const ins = insights.get(ad.id)
      const impressoes = ins ? parseInt(ins.impressions) || 0 : 0
      const cliques = ins ? parseInt(ins.inline_link_clicks) || 0 : 0
      return { ctr: impressoes > 0 ? (cliques / impressoes) * 100 : 0, impressoes }
    }),
  )

  return adsComDetalhes.map((ad, idx) => {
    const ins = insights.get(ad.id)
    // Tipo pelo DADO quando existe (creative.video_id = vídeo de verdade); o
    // nome é só fallback — um vídeo chamado "banner-v3" era classificado como
    // imagem e zerava hook rate/retenção reais
    const temVideo = Boolean(ad.creative?.video_id || ad.creative?.object_story_spec?.video_data?.video_id)
    const tipo = temVideo ? 'vídeo' : deriveTipo(ad.name)

    const gasto      = ins ? parseFloat(ins.spend) || 0 : 0
    const impressoes = ins ? parseInt(ins.impressions) || 0 : 0
    const cliques    = ins ? parseInt(ins.inline_link_clicks) || 0 : 0
    const compras    = ins ? pickAction(ins.actions, ...ACTION_COMPRA) : 0
    const valorGerado = ins ? pickAction(ins.action_values, ...ACTION_COMPRA) : 0
    const leads      = ins ? pickAction(ins.actions, ...ACTION_LEAD) : 0
    const seguidores = ins ? pickAction(ins.actions, ...ACTION_SEGUIDOR) : 0
    // landing_page_view vem no MESMO payload de actions — sem coletar, as colunas
    // Page View/Connect Rate/Conv. LP→Venda mostravam 0 falso em todo anúncio
    const pageView    = ins ? pickAction(ins.actions, ...ACTION_PAGEVIEW) : 0
    const viewContent = ins ? pickAction(ins.actions, ...ACTION_VIEW_CONTENT) : 0

    // Vídeo (só faz sentido pra criativo de vídeo). 3s = action 'video_view'.
    const ehVideo  = tipo === 'vídeo'
    const video3s  = ins && ehVideo ? pickAction(ins.actions, ...ACTION_VIDEO_3S) : 0
    const p75views = ins && ehVideo ? pickAction(ins.video_p75_watched_actions, 'video_view') : 0
    const p95views = ins && ehVideo ? pickAction(ins.video_p95_watched_actions, 'video_view') : 0

    // Engajamento (action types confirmados na conta + campos diretos)
    const profileVisits  = ins ? parseInt(ins.instagram_profile_visits ?? '0') || 0 : 0
    const postEngagement = ins ? pickAction(ins.actions, ...ACTION_POST_ENGAGEMENT) : 0
    const reactions      = ins ? pickAction(ins.actions, ...ACTION_REACTION) : 0
    const comments       = ins ? pickAction(ins.actions, ...ACTION_COMMENT) : 0
    const shares         = ins ? pickAction(ins.actions, ...ACTION_SHARE) : 0
    const saves          = ins ? pickAction(ins.actions, ...ACTION_SAVE) : 0
    const thruplays      = ins && ehVideo ? pickAction(ins.video_thruplay_watched_actions, 'video_view') : 0

    // Todas as derivadas vêm da fonte única — uma fórmula só (lib/metrics/derivar.ts)
    const d = derivarMetricas({
      gasto, impressoes, cliques, pageView, compras, valorGerado, leads, seguidores,
      video3sViews: video3s, p75: p75views, p95: p95views,
    })
    const { ctr, cpm, cpc, roas, cac, hookRate, retencao75, cpv75 } = d

    const temAmostra = impressoes >= MIN_IMPRESSOES_AMOSTRA
    const quadrante = classificarPorMedia(ctr, mediaCtr, temAmostra)
    const spec = ad.creative?.object_story_spec
    const videoCandidates = [
      spec?.video_data?.video_id,
      ad.creative?.video_id,
    ].filter((id): id is string => !!id)
    const video = videoCandidates.map(id => videos.get(id)).find(v => v?.source) ?? videoCandidates.map(id => videos.get(id)).find(Boolean)
    const thumbUrl =
      spec?.video_data?.image_url ??
      ad.creative?.image_url ??
      spec?.link_data?.picture ??
      spec?.photo_data?.url ??
      spec?.template_data?.picture ??
      video?.picture ??
      ad.creative?.thumbnail_url ??
      null
    const videoUrl = video?.source ?? null
    const permalinkUrl = ad.creative?.instagram_permalink_url ?? video?.permalink_url ?? null

    const criativo: Criativo = {
      id:             ad.id,
      adsetId:        ad.adset_id,
      metaAdId:       ad.id,
      nome:           ad.name,
      thumbUrl,
      videoUrl,
      permalinkUrl,
      quadrante,
      ativo:          ad.status === 'ACTIVE',
      criadoEm:       ad.created_time,
    }

    const metricas: CriativoMetricas = {
      id:          ad.id,
      nome:        ad.name,
      tipo,
      quadrante,
      thumbColor:  THUMB_COLORS[idx % THUMB_COLORS.length],
      thumbUrl,
      videoUrl,
      permalinkUrl,
      duracao:     video?.length ? `${Math.round(video.length)}s` : undefined,
      gasto,
      impressoes,
      cliques,
      pageView,
      viewContent,
      cpm,
      ctr,
      cpc,
      hookRate,
      retencao75,
      cpv75,
      compras,
      cac,
      roas,
      valorGerado,
      seguidores,
      cpv95:        d.cpv95,
      video3sViews: video3s,
      profileVisits,
      postEngagement,
      reactions,
      comments,
      shares,
      saves,
      thruplays,
      conv75Lead:     d.conv75Lead,
      conv75Venda:    d.conv75Venda,
      conv75Seguidor: d.conv75Seguidor,
      ativo:        ad.status === 'ACTIVE',
      campanhaNome: ad.campaign?.name ?? '',
    }

    return { criativo, metricas }
  })
}
