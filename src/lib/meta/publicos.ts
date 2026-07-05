import type { CriativoMetricas } from '@/lib/types'
import { classificarPorMedia, ctrMedioPonderado, MIN_IMPRESSOES_AMOSTRA } from '@/lib/utils/classificacao'
import { derivarMetricas } from '@/lib/metrics/derivar'
import { metaGetAll, accountPath, fatiarPeriodo } from './client'
import { pickAction, ACTION_COMPRA, ACTION_PAGEVIEW, ACTION_VIEW_CONTENT, ACTION_SEGUIDOR, type MetaAction } from './actions'

// ─── Tipos brutos ─────────────────────────────────────────────────────────────

interface MetaAdset {
  id: string
  name: string
  status: string
  campaign_id: string
  campaign?: { id: string; name: string }
}

interface MetaAdsetInsight {
  adset_id: string
  campaign_id: string
  spend: string
  impressions: string
  inline_link_clicks: string
  ctr: string
  cpm: string
  actions?: MetaAction[]
  action_values?: MetaAction[]
}

interface MetaPlacementInsight {
  date_start: string
  campaign_id: string
  campaign_name: string
  publisher_platform: string
  platform_position: string
  impression_device: string
  spend: string
  impressions: string
  inline_link_clicks: string
  actions?: MetaAction[]
  action_values?: MetaAction[]
}

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export interface PublicoComMetricas {
  id: string
  nome: string
  campanhaId: string
  campanhaNome: string
  ativo: boolean
  impressoes: number
  cliques: number
  ctr: number
  cpm: number
  pageView: number
  connectRate: number
  compras: number
  valorGerado: number
  investimento: number
  roas: number
  cac: number
  seguidores: number
}

export type SistemaOperacional = 'iOS' | 'Android' | 'Desktop' | 'Outro'

// Uma linha por dia × campanha × plataforma × posição × dispositivo. A tela
// deriva tudo daqui: totais, agrupamentos, série temporal, tabela e o filtro
// inteligente (por nome de campanha) — um fetch só.
export interface PlacementDia {
  data: string                  // YYYY-MM-DD
  campanhaId: string
  campanha: string              // nome da campanha (com as tags da convenção)
  plataforma: string            // publisher_platform bruto
  posicao: string               // platform_position bruto
  dispositivo: string           // impression_device bruto (iphone, android_smartphone, ...)
  so: SistemaOperacional
  investimento: number
  impressoes: number
  cliques: number
  pageView: number
  compras: number
  valorGerado: number
  seguidores: number
}

// ─── Labels legíveis (exportados para a UI) ───────────────────────────────────

export const PLATAFORMA_LABEL: Record<string, string> = {
  facebook: 'Facebook', instagram: 'Instagram',
  audience_network: 'Audience Network', messenger: 'Messenger',
  threads: 'Threads', oculus: 'Oculus', whatsapp: 'WhatsApp',
}

// Atenção: chaves distintas precisam de labels distintos — facebook_reels e
// instagram_reels são séries separadas no gráfico; rotular ambos como "Reels"
// torna impossível saber qual linha é qual.
export const POSICAO_LABEL: Record<string, string> = {
  feed: 'Feed', story: 'Stories', reels: 'Reels',
  facebook_reels: 'Reels · FB', facebook_stories: 'Stories · FB',
  instagram_reels: 'Reels · IG', instagram_stories: 'Stories · IG',
  instagram_explore: 'Explorar · IG', instagram_explore_grid_home: 'Explorar Grid · IG',
  instagram_profile_feed: 'Feed Perfil · IG', facebook_profile_feed: 'Feed Perfil · FB',
  threads_feed: 'Feed · Threads',
  video_feeds: 'Video Feeds', right_hand_column: 'Coluna Direita',
  marketplace: 'Marketplace', search: 'Pesquisa',
  instream_video: 'Vídeo Instream', profile_feed: 'Feed Perfil',
}

export const DISPOSITIVO_LABEL: Record<string, string> = {
  iphone: 'iPhone', ipad: 'iPad',
  android_smartphone: 'Android', android_tablet: 'Tablet Android',
  desktop: 'Desktop', other: 'Outro',
}

function sistemaOperacional(dispositivo: string): SistemaOperacional {
  if (dispositivo === 'iphone' || dispositivo === 'ipad') return 'iOS'
  if (dispositivo.startsWith('android')) return 'Android'
  if (dispositivo === 'desktop') return 'Desktop'
  return 'Outro'
}

// ─── Públicos (adset-level) ───────────────────────────────────────────────────

export async function getPublicosComMetricas(since: string, until: string): Promise<PublicoComMetricas[]> {
  const conta = accountPath()
  const time_range = JSON.stringify({ since, until })

  const [adsets, insights] = await Promise.all([
    metaGetAll<MetaAdset>(conta + '/adsets', {
      fields: 'id,name,status,campaign_id,campaign{id,name}',
      limit: '500',
    }),
    metaGetAll<MetaAdsetInsight>(conta + '/insights', {
      fields: ['adset_id', 'campaign_id', 'spend', 'impressions', 'inline_link_clicks', 'ctr', 'cpm', 'actions', 'action_values'].join(','),
      level: 'adset',
      time_range,
      limit: '500',
    }, 10),
  ])

  const insightMap = new Map<string, MetaAdsetInsight>()
  for (const row of insights) insightMap.set(row.adset_id, row)

  return adsets.map(a => {
    const ins = insightMap.get(a.id)
    const gasto      = ins ? parseFloat(ins.spend) || 0 : 0
    const impressoes = ins ? parseInt(ins.impressions) || 0 : 0
    const cliques    = ins ? parseInt(ins.inline_link_clicks) || 0 : 0
    const pageView    = ins ? pickAction(ins.actions, ...ACTION_PAGEVIEW) : 0
    const compras     = ins ? pickAction(ins.actions, ...ACTION_COMPRA) : 0
    const valorGerado = ins ? pickAction(ins.action_values, ...ACTION_COMPRA) : 0
    const seguidores  = ins ? pickAction(ins.actions, ...ACTION_SEGUIDOR) : 0

    const d = derivarMetricas({ gasto, impressoes, cliques, pageView, compras, valorGerado, seguidores })

    return {
      id:           a.id,
      nome:         a.name,
      campanhaId:   a.campaign_id,
      campanhaNome: a.campaign?.name ?? '',
      ativo:        a.status === 'ACTIVE',
      impressoes,
      cliques,
      ctr:          d.ctr,
      cpm:          d.cpm,
      pageView,
      connectRate:  d.connectRate,
      compras,
      valorGerado,
      investimento: gasto,
      roas:         d.roas,
      cac:          d.cac,
      seguidores,
    }
  })
}

// ─── Anúncios (ad-level, leve — sem creative/vídeo) ───────────────────────────
// Versão enxuta para a tela de Públicos: só ads + insights. Evita as dezenas de
// chamadas por anúncio (thumbnails, vídeos, creative details) de getCriativosComMetricas.

interface MetaAdLite {
  id: string
  name: string
  status: string
  campaign_id: string
  campaign?: { id: string; name: string }
}

interface MetaAdInsightLite {
  ad_id: string
  spend: string
  impressions: string
  inline_link_clicks: string
  ctr: string
  cpm: string
  actions?: MetaAction[]
  action_values?: MetaAction[]
}

const THUMB_COLORS_ANUNCIO = [
  'linear-gradient(135deg, #5F8A3C 0%, #3F5320 100%)',
  'linear-gradient(135deg, #5C79C9 0%, #36497E 100%)',
  'linear-gradient(135deg, #9A86D6 0%, #5E4B99 100%)',
  'linear-gradient(135deg, #D9805C 0%, #A85434 100%)',
]

function deriveTipoAnuncio(nome: string): string {
  const n = nome.toLowerCase()
  if (n.includes('carrossel') || n.includes('carousel')) return 'carrossel'
  if (n.includes('static') || n.includes('imagem') || n.includes('banner')) return 'imagem'
  return 'vídeo'
}

export async function getAnunciosComMetricas(since: string, until: string): Promise<CriativoMetricas[]> {
  const conta = accountPath()
  const time_range = JSON.stringify({ since, until })

  const [ads, insights] = await Promise.all([
    metaGetAll<MetaAdLite>(conta + '/ads', {
      fields: 'id,name,status,campaign_id,campaign{id,name}',
      limit: '500',
    }, 5),
    metaGetAll<MetaAdInsightLite>(conta + '/insights', {
      fields: ['ad_id', 'spend', 'impressions', 'inline_link_clicks', 'ctr', 'cpm', 'actions', 'action_values'].join(','),
      level: 'ad',
      time_range,
      limit: '500',
    }, 10),
  ])

  const insightMap = new Map<string, MetaAdInsightLite>()
  for (const row of insights) insightMap.set(row.ad_id, row)

  // Régua relativa: CTR médio (ponderado por impressões) dos anúncios com amostra.
  // CTR aqui é clique no link ÷ impressões (mesma base do CTR exibido).
  const mediaCtr = ctrMedioPonderado(
    ads.map(ad => {
      const ins = insightMap.get(ad.id)
      const impressoes = ins ? parseInt(ins.impressions) || 0 : 0
      const cliques = ins ? parseInt(ins.inline_link_clicks) || 0 : 0
      return { ctr: impressoes > 0 ? (cliques / impressoes) * 100 : 0, impressoes }
    }),
  )

  return ads.map((ad, idx) => {
    const ins = insightMap.get(ad.id)
    const gasto       = ins ? parseFloat(ins.spend) || 0 : 0
    const impressoes  = ins ? parseInt(ins.impressions) || 0 : 0
    const cliques     = ins ? parseInt(ins.inline_link_clicks) || 0 : 0
    const compras     = ins ? pickAction(ins.actions, ...ACTION_COMPRA) : 0
    const valorGerado = ins ? pickAction(ins.action_values, ...ACTION_COMPRA) : 0
    const seguidores  = ins ? pickAction(ins.actions, ...ACTION_SEGUIDOR) : 0
    const pageView    = ins ? pickAction(ins.actions, ...ACTION_PAGEVIEW) : 0
    const viewContent = ins ? pickAction(ins.actions, ...ACTION_VIEW_CONTENT) : 0

    const d = derivarMetricas({ gasto, impressoes, cliques, pageView, compras, valorGerado, seguidores })

    return {
      id:           ad.id,
      nome:         ad.name,
      tipo:         deriveTipoAnuncio(ad.name),
      quadrante:    classificarPorMedia(d.ctr, mediaCtr, impressoes >= MIN_IMPRESSOES_AMOSTRA),
      thumbColor:   THUMB_COLORS_ANUNCIO[idx % THUMB_COLORS_ANUNCIO.length],
      gasto,
      impressoes,
      cliques,
      pageView,
      viewContent,
      cpm:          d.cpm,
      ctr:          d.ctr,
      cpc:          d.cpc,
      hookRate:     0,
      retencao75:   0,
      cpv75:        0,
      compras,
      cac:          d.cac,
      roas:         d.roas,
      valorGerado,
      seguidores,
      ativo:        ad.status === 'ACTIVE',
      campanhaNome: ad.campaign?.name ?? '',
    }
  })
}

// ─── Posicionamento (placement breakdown, série diária) ──────────────────────

export async function getPlacementsDiarios(since: string, until: string): Promise<PlacementDia[]> {
  const rows: MetaPlacementInsight[] = []

  // Os campos de breakdown NÃO entram em `fields` (a Meta rejeita com erro 100) —
  // eles voltam automaticamente na resposta por estarem em `breakdowns`.
  // Sequencial de propósito: janelas em paralelo estouram o rate limit da conta.
  for (const janela of fatiarPeriodo(since, until)) {
    const parte = await metaGetAll<MetaPlacementInsight>(
      accountPath() + '/insights',
      {
        fields: ['campaign_id', 'campaign_name', 'spend', 'impressions', 'inline_link_clicks', 'actions', 'action_values'].join(','),
        level: 'campaign',
        breakdowns: 'publisher_platform,platform_position,impression_device',
        time_increment: '1',
        time_range: JSON.stringify(janela),
        limit: '500',
      },
      15,
    )
    rows.push(...parte)
  }

  return rows
    .map(row => {
      const gasto      = parseFloat(row.spend) || 0
      const impressoes = parseInt(row.impressions) || 0
      return {
        data:        row.date_start,
        campanhaId:  row.campaign_id,
        campanha:    row.campaign_name,
        plataforma:  row.publisher_platform,
        posicao:     row.platform_position,
        dispositivo: row.impression_device,
        so:          sistemaOperacional(row.impression_device),
        investimento: gasto,
        impressoes,
        cliques:     parseInt(row.inline_link_clicks) || 0,
        pageView:    pickAction(row.actions, ...ACTION_PAGEVIEW),
        compras:     pickAction(row.actions, ...ACTION_COMPRA),
        valorGerado: pickAction(row.action_values, ...ACTION_COMPRA),
        seguidores:  pickAction(row.actions, ...ACTION_SEGUIDOR),
      }
    })
    .filter(p => p.investimento > 0 || p.impressoes > 0)
}
