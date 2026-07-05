// ─── Fonte ÚNICA de cálculo das métricas derivadas ───────────────────────────
// Toda métrica que é uma CONTA (ctr, roas, cac, taxas, custos...) nasce aqui, com
// UMA fórmula só. As camadas Meta (server) e as telas (client, após filtro/agregação)
// chamam esta mesma função — é o que garante que CTR é CTR em qualquer lugar.
//
// Regra de ouro: nada de meta absoluta inventada. As decisões de fórmula foram
// revisadas com o João (2026-06-13/14) e estão documentadas em docs/metricas-catalogo.md.
//
// IMPORTANTE: só os campos BRUTOS (somáveis) entram aqui. Quem soma o recorte
// (período, filtro, grupo) é a camada/tela; depois passa a soma pra cá.

// Campos brutos vindos da Graph API (action types e campos confirmados na conta real).
export interface MetricasBase {
  gasto: number
  impressoes: number
  cliques: number          // inline_link_clicks (clique no link)
  pageView: number         // landing_page_view
  leads: number            // lead
  inicioCheckout: number   // initiate_checkout
  compras: number          // purchase
  valorGerado: number      // action_values.purchase (receita do pixel)
  seguidores: number       // follow — API ainda não expõe (fica 0); ver actions.ts
  // ── Engajamento (confirmado na conta: ver docs/metricas-catalogo.md Parte 4) ──
  video3sViews: number     // action 'video_view' = 3-second views
  profileVisits: number    // campo 'instagram_profile_visits'
  postEngagement: number   // action 'post_engagement'
  reactions: number        // action 'post_reaction' (todas as reações = curtidas)
  comments: number         // action 'comment'
  shares: number           // action 'post' (compartilhamentos)
  saves: number            // action 'onsite_conversion.post_save'
  thruplays: number        // campo 'video_thruplay_watched_actions'
  // ── Retenção de vídeo ──
  p25: number              // video_p25_watched_actions
  p75: number              // video_p75_watched_actions
  p95: number              // video_p95_watched_actions
}

export interface MetricasDerivadas {
  // Veiculação
  ctr: number
  cpm: number
  cpc: number
  // Veiculação — qualidade do vídeo (decisão João: estas são VEICULAÇÃO, não engajamento)
  hookRate: number         // 3s views ÷ impressões
  retencao75: number       // 75% views ÷ impressões
  cpv75: number
  cpv95: number
  // Página
  connectRate: number
  custoPorPageView: number
  // Conversão
  roas: number
  cac: number
  cpl: number
  ticketMedio: number      // valorGerado ÷ vendas(compras)
  pctCheckout: number      // início de checkout ÷ pageView
  // Taxas de conversão (renomeadas — variam por evento)
  taxaConvVendaLP: number  // compra ÷ pageView
  taxaConvLeadLP: number   // lead ÷ pageView
  taxaConvIC: number       // compra ÷ início de checkout
  taxaConvClique: number   // compra ÷ clique
  // Conversão a partir de quem assistiu 75% do vídeo (varia por evento)
  conv75Lead: number       // lead ÷ 75% views
  conv75Venda: number      // compra ÷ 75% views
  conv75Seguidor: number   // seguidor ÷ 75% views
  // Engajamento — custos (gasto ÷ contagem). A contagem em si fica no MetricasBase.
  custoSeguidor: number
  custoProfileVisit: number
  custoEngajamento: number // por engajamento com o post
  custoReaction: number    // por reação/curtida
  custoComment: number
  custoShare: number
  custoSave: number
  custoThruplay: number
  custo3sView: number
}

// Divisão protegida — denominador <= 0 vira 0 (vazio honesto, nunca NaN/Infinity).
function div(numerador: number, denominador: number): number {
  return denominador > 0 ? numerador / denominador : 0
}

const n = (x: number | undefined) => (Number.isFinite(x) ? (x as number) : 0)

// Recebe os campos brutos JÁ SOMADOS do recorte e devolve todas as derivadas.
// Aceita Partial: camadas que não coletam certo campo (ex.: conta sem vídeo)
// passam só o que têm; o ausente conta como 0.
export function derivarMetricas(base: Partial<MetricasBase>): MetricasDerivadas {
  const gasto = n(base.gasto)
  const impressoes = n(base.impressoes)
  const cliques = n(base.cliques)
  const pageView = n(base.pageView)
  const leads = n(base.leads)
  const checkout = n(base.inicioCheckout)
  const compras = n(base.compras)
  const valorGerado = n(base.valorGerado)
  const seguidores = n(base.seguidores)
  const video3s = n(base.video3sViews)
  const profileVisits = n(base.profileVisits)
  const postEngagement = n(base.postEngagement)
  const reactions = n(base.reactions)
  const comments = n(base.comments)
  const shares = n(base.shares)
  const saves = n(base.saves)
  const thruplays = n(base.thruplays)
  const p75 = n(base.p75)
  const p95 = n(base.p95)

  return {
    // Veiculação
    ctr: div(cliques, impressoes) * 100,
    cpm: div(gasto, impressoes) * 1000,
    cpc: div(gasto, cliques),
    hookRate: div(video3s, impressoes) * 100,
    retencao75: div(p75, impressoes) * 100,
    cpv75: div(gasto, p75),
    cpv95: div(gasto, p95),
    // Página
    connectRate: div(pageView, cliques) * 100,
    custoPorPageView: div(gasto, pageView),
    // Conversão
    roas: div(valorGerado, gasto),
    cac: div(gasto, compras),
    cpl: div(gasto, leads),
    ticketMedio: div(valorGerado, compras),
    pctCheckout: div(checkout, pageView) * 100,
    // Taxas de conversão
    taxaConvVendaLP: div(compras, pageView) * 100,
    taxaConvLeadLP: div(leads, pageView) * 100,
    taxaConvIC: div(compras, checkout) * 100,
    taxaConvClique: div(compras, cliques) * 100,
    // Conv. 75%
    conv75Lead: div(leads, p75) * 100,
    conv75Venda: div(compras, p75) * 100,
    conv75Seguidor: div(seguidores, p75) * 100,
    // Custos de engajamento
    custoSeguidor: div(gasto, seguidores),
    custoProfileVisit: div(gasto, profileVisits),
    custoEngajamento: div(gasto, postEngagement),
    custoReaction: div(gasto, reactions),
    custoComment: div(gasto, comments),
    custoShare: div(gasto, shares),
    custoSave: div(gasto, saves),
    custoThruplay: div(gasto, thruplays),
    custo3sView: div(gasto, video3s),
  }
}
