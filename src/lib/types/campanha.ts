export type Temperatura = 'fundo' | 'quente' | 'neutro'

export interface Campanha {
  id: string
  contaMetaId: string
  metaCampanhaId: string
  nome: string
  temperatura: Temperatura
  tag: '[F]' | '[Q]' | null
  ativa: boolean
  criadoEm: string
}

export interface Adset {
  id: string
  campanhaId: string
  metaAdsetId: string
  nome: string
  ativo: boolean
}

// Classificação relativa à média do conjunto (não a metas absolutas inventadas).
// 'novo' = sem amostra suficiente pra julgar — ver lib/utils/classificacao.ts
export type QuadranteCriativo = 'acima' | 'abaixo' | 'novo'

export interface CriativoMetricas {
  id: string
  nome: string
  tipo: string
  duracao?: string
  quadrante: QuadranteCriativo
  thumbColor: string
  thumbUrl?: string | null
  videoUrl?: string | null
  permalinkUrl?: string | null
  gasto: number
  impressoes: number
  cliques: number      // inline_link_clicks — real, vindo do insight do anúncio
  pageView: number     // landing_page_view — real (base de Connect Rate / Conv. LP→Venda)
  viewContent: number  // ViewContent do pixel — métrica PRÓPRIA, nunca fallback de pageView
  cpm: number
  ctr: number
  cpc: number
  hookRate: number
  retencao75: number
  cpv75: number
  compras: number
  cac: number
  roas: number
  valorGerado: number
  seguidores: number
  cpv95?: number
  // Engajamento — contagens (opcionais; nem toda origem coleta). Os custos
  // (gasto ÷ contagem) são derivados na biblioteca. Ver config/metrics.ts.
  video3sViews?: number
  profileVisits?: number
  postEngagement?: number
  reactions?: number
  comments?: number
  shares?: number
  saves?: number
  thruplays?: number
  // Conv. 75% — % de quem assistiu 75% do vídeo que converteu (varia por evento)
  conv75Lead?: number
  conv75Venda?: number
  conv75Seguidor?: number
  ativo: boolean
  campanhaNome: string
}

export interface Criativo {
  id: string
  adsetId: string
  metaAdId: string
  nome: string
  thumbUrl: string | null
  videoUrl: string | null
  permalinkUrl?: string | null
  quadrante: QuadranteCriativo
  ativo: boolean
  criadoEm: string
}
