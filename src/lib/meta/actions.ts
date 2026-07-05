// Action types da Graph API — fonte única para todas as métricas do dashboard.
// Referência: https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/

export interface MetaAction {
  action_type: string
  value: string
}

export const ACTION_COMPRA = ['purchase', 'offsite_conversion.fb_pixel_purchase'] as const
export const ACTION_LEAD = ['lead', 'offsite_conversion.fb_pixel_lead'] as const
// Decisão João 2026-07-02: "viewcontent = viewcontent, pageview = pageview".
// Page View = SÓ landing_page_view (página de destino carregada); ViewContent é
// MÉTRICA PRÓPRIA (evento de pixel, dispara em qualquer página configurada) —
// como fallback um do outro, inflava Connect Rate/Conv. LP.
export const ACTION_PAGEVIEW = ['landing_page_view'] as const
export const ACTION_VIEW_CONTENT = ['offsite_conversion.fb_pixel_view_content', 'view_content'] as const
export const ACTION_CHECKOUT = ['initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout'] as const
export const ACTION_REGISTRO = ['complete_registration', 'offsite_conversion.fb_pixel_complete_registration'] as const
// CONTACT é evento customizado do pixel — confirmado na conta (2026-06-15) como fb_pixel_custom
export const ACTION_CONTATO = ['offsite_conversion.fb_pixel_custom'] as const

// Seguidores: a API de Insights ainda não expõe a métrica "Seguidores do Instagram"
// do Gerenciador (verificado jun/2026 e confirmado 2026-06-14 em v21–v25 + Instagram
// Graph API — follows existe na UI desde jul/2025 mas não na Insights API). Estes
// tipos ficam aqui para a métrica passar a funcionar sozinha quando a Meta liberar.
// IMPORTANTE: "like" NÃO entra nesta lista — é curtida de página, não seguidor.
export const ACTION_SEGUIDOR = ['onsite_conversion.follow_instagram_account', 'follow'] as const

// ─── Engajamento ──────────────────────────────────────────────────────────────
// Action types confirmados na conta real (2026-06-14) — ver docs/metricas-catalogo.md.
// "3s views" é o action `video_view` (NÃO existe `video_3_sec_watched_actions`).
export const ACTION_VIDEO_3S = ['video_view'] as const
export const ACTION_POST_ENGAGEMENT = ['post_engagement'] as const
export const ACTION_REACTION = ['post_reaction'] as const          // todas as reações (curtidas)
export const ACTION_COMMENT = ['comment'] as const
export const ACTION_SHARE = ['post'] as const                       // compartilhamentos
export const ACTION_SAVE = ['onsite_conversion.post_save'] as const

// Extrai o valor numérico do primeiro action type presente, na ordem dada
export function pickAction(arr: MetaAction[] | undefined, ...types: readonly string[]): number {
  if (!arr) return 0
  for (const t of types) {
    const found = arr.find(a => a.action_type === t)
    if (found) return parseFloat(found.value) || 0
  }
  return 0
}
