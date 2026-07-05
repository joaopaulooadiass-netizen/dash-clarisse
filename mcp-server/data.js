// Dados reais — busca direto na Graph API do Meta Ads.
// Mesmas regras canônicas de src/lib/meta/ (actions.ts é a referência das
// cadeias de conversão), portadas para rodar fora do Next.js.
//
// Princípios (ver CLAUDE.md):
// - NUNCA inventar dados: sem benchmarks fictícios, sem misturar compra com lead
// - Conta multi-objetivo: filtro por tag ([VENDAS], [LEADS], [C1]...) em toda tool
// - receita_pixel = compras rastreadas pelo pixel; a receita oficial virá da Hubla

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v21.0'
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

// ─── Cadeias canônicas de action_types (espelho de src/lib/meta/actions.ts) ──

const ACTION_COMPRA = ['purchase', 'offsite_conversion.fb_pixel_purchase']
const ACTION_LEAD = ['lead', 'offsite_conversion.fb_pixel_lead']
// SÓ landing_page_view — ViewContent removido (decisão João 2026-07-02), espelha actions.ts
const ACTION_PAGEVIEW = ['landing_page_view']
// "like" NÃO entra: é curtida de página, não seguidor (regra do projeto)
const ACTION_SEGUIDOR = ['onsite_conversion.follow_instagram_account', 'follow']

function pickAction(arr, types) {
  if (!arr) return 0
  for (const t of types) {
    const found = arr.find(a => a.action_type === t)
    if (found) return parseFloat(found.value) || 0
  }
  return 0
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

function accountPath() {
  const id = process.env.META_AD_ACCOUNT_ID
  if (!id) throw new Error('META_AD_ACCOUNT_ID não definido em .env')
  return id.startsWith('act_') ? id : `act_${id}`
}

async function metaGet(path, params = {}) {
  const token = process.env.META_ACCESS_TOKEN
  if (!token) throw new Error('META_ACCESS_TOKEN não definido em .env')

  const url = new URL(`${BASE}/${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  // Token no header (não na URL) para não vazar em logs
  const doFetch = () => fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  })

  let res = await doFetch()

  // Uma nova tentativa em erro transitório (rate limit / instabilidade da Meta),
  // mesma política do src/lib/meta/client.ts
  if (res.status === 429 || res.status >= 500) {
    await new Promise(r => setTimeout(r, 1500))
    res = await doFetch()
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message ?? `Meta API ${res.status}`)
  }
  return res.json()
}

async function metaGetAll(path, params = {}, maxPages = 10) {
  const rows = []
  let after
  for (let page = 0; page < maxPages; page++) {
    const resp = await metaGet(path, after ? { ...params, after } : params)
    rows.push(...(resp.data ?? []))
    after = resp.paging?.cursors?.after
    if (!after || !resp.paging?.next) break
  }
  return rows
}

// ─── Cache em memória (30 min) ───────────────────────────────────────────────
// A cota de chamadas da Meta é POR CONTA e compartilhada com o dashboard —
// sem cache, uma conversa longa no Claude pode derrubar as duas coisas.

const CACHE_TTL_MS = 30 * 60 * 1000
const cache = new Map()

async function cacheado(chave, fn) {
  const hit = cache.get(chave)
  if (hit && Date.now() - hit.criadoEm < CACHE_TTL_MS) return hit.valor
  const valor = await fn()
  cache.set(chave, { valor, criadoEm: Date.now() })
  return valor
}

// ─── Janelas de período ──────────────────────────────────────────────────────
// A Meta rejeita série diária por campanha em períodos longos (erro genérico
// code 1 — verificado: 365d falha, 180d passa). Fatiamos em janelas de 90 dias.

// Hoje no fuso do negócio (BRT) — new Date()/toISOString é UTC e entre 21h e
// 23h59 de Brasília já aponta pra AMANHÃ, encurtando o período analisado
function hojeBRT() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

function janelasPeriodo(dias, tamanho = 90) {
  const fim = new Date(`${hojeBRT()}T12:00:00Z`)
  const inicio = new Date(fim)
  inicio.setUTCDate(fim.getUTCDate() - dias + 1)

  const janelas = []
  let cursor = new Date(inicio)
  while (cursor <= fim) {
    const fimJanela = new Date(cursor)
    fimJanela.setDate(fimJanela.getDate() + tamanho - 1)
    const ate = fimJanela < fim ? fimJanela : fim
    janelas.push({
      since: cursor.toISOString().slice(0, 10),
      until: ate.toISOString().slice(0, 10),
    })
    cursor = new Date(ate)
    cursor.setDate(cursor.getDate() + 1)
  }
  return janelas
}

// ─── Filtro por tag de campanha (convenção [VENDAS], [LEADS], [C1]...) ───────

export const FILTRO_TAGS = ['todas', 'VENDAS', 'LEADS', 'CPT', 'C1', 'C2', 'C3']

function passaTag(nome, tag) {
  if (!tag || tag === 'todas') return true
  return (nome ?? '').toUpperCase().includes(`[${tag}]`)
}

function deriveTemperatura(nome) {
  const n = (nome ?? '').toUpperCase()
  if (n.includes('[F]')) return 'fundo'
  if (n.includes('[Q]')) return 'quente'
  return 'neutro'
}

function deriveTipo(nome) {
  const n = (nome ?? '').toLowerCase()
  if (n.includes('carrossel') || n.includes('carousel')) return 'carrossel'
  if (n.includes('static') || n.includes('imagem') || n.includes('banner')) return 'imagem'
  return 'vídeo'
}

// ─── Fetchers cacheados (sem filtro — os filtros derivam em memória) ─────────

function mapearMetricas(row) {
  return {
    gasto: parseFloat(row.spend) || 0,
    impressoes: parseInt(row.impressions) || 0,
    cliques: parseInt(row.inline_link_clicks) || 0,
    pageViews: pickAction(row.actions, ACTION_PAGEVIEW),
    compras: pickAction(row.actions, ACTION_COMPRA),
    receitaPixel: pickAction(row.action_values, ACTION_COMPRA),
    leads: pickAction(row.actions, ACTION_LEAD),
    seguidores: pickAction(row.actions, ACTION_SEGUIDOR),
  }
}

// Linhas diárias por campanha — base de quase todas as tools
async function diariasPorCampanha(dias) {
  return cacheado(`diarias:${dias}`, async () => {
    const rows = []
    for (const janela of janelasPeriodo(dias)) {
      const parte = await metaGetAll(`${accountPath()}/insights`, {
        fields: 'campaign_id,campaign_name,spend,impressions,inline_link_clicks,actions,action_values',
        level: 'campaign',
        time_increment: '1',
        time_range: JSON.stringify(janela),
        limit: '500',
      }, 15)
      rows.push(...parte)
    }
    return rows.map(row => ({
      data: row.date_start,
      campanhaId: row.campaign_id,
      campanhaNome: row.campaign_name ?? '',
      ...mapearMetricas(row),
    }))
  })
}

async function cadastroCampanhas() {
  return cacheado('cadastro', () =>
    metaGetAll(`${accountPath()}/campaigns`, { fields: 'id,name,status', limit: '200' })
  )
}

async function insightsAnuncios(dias) {
  return cacheado(`anuncios:${dias}`, () =>
    metaGetAll(`${accountPath()}/insights`, {
      fields: 'ad_id,ad_name,spend,impressions,inline_link_clicks,actions,action_values',
      level: 'ad',
      time_range: JSON.stringify(janelasPeriodo(dias, dias)[0]),
      limit: '500',
    })
  )
}

// ─── Agregação ────────────────────────────────────────────────────────────────

function somar(linhas) {
  const t = { gasto: 0, impressoes: 0, cliques: 0, pageViews: 0, compras: 0, receitaPixel: 0, leads: 0, seguidores: 0 }
  for (const l of linhas) {
    t.gasto += l.gasto; t.impressoes += l.impressoes; t.cliques += l.cliques
    t.pageViews += l.pageViews; t.compras += l.compras; t.receitaPixel += l.receitaPixel
    t.leads += l.leads; t.seguidores += l.seguidores
  }
  return t
}

const r2 = v => Math.round(v * 100) / 100

function derivadas(t) {
  return {
    ctr: t.impressoes > 0 ? r2((t.cliques / t.impressoes) * 100) : 0,
    cpc: t.cliques > 0 ? r2(t.gasto / t.cliques) : 0,
    cpm: t.impressoes > 0 ? r2((t.gasto / t.impressoes) * 1000) : 0,
    cpl: t.leads > 0 ? r2(t.gasto / t.leads) : 0,
    cac: t.compras > 0 ? r2(t.gasto / t.compras) : 0,
    roas_pixel: t.gasto > 0 ? r2(t.receitaPixel / t.gasto) : 0,
    custo_por_seguidor: t.seguidores > 0 ? r2(t.gasto / t.seguidores) : 0,
  }
}

function formatarTotais(t) {
  return {
    gasto: r2(t.gasto),
    impressoes: t.impressoes,
    cliques: t.cliques,
    page_views: Math.round(t.pageViews),
    compras: Math.round(t.compras),
    receita_pixel: r2(t.receitaPixel),
    leads: Math.round(t.leads),
    seguidores: Math.round(t.seguidores),
    ...derivadas(t),
  }
}

// ─── Métricas diárias ─────────────────────────────────────────────────────────

export async function getMetricasDiarias(dias = 30, filtroTag = 'todas') {
  const linhas = (await diariasPorCampanha(dias)).filter(l => passaTag(l.campanhaNome, filtroTag))

  const porDia = new Map()
  for (const l of linhas) {
    if (!porDia.has(l.data)) porDia.set(l.data, [])
    porDia.get(l.data).push(l)
  }

  return Array.from(porDia.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([data, doDia]) => ({ data, ...formatarTotais(somar(doDia)) }))
}

// ─── Resumo do período ────────────────────────────────────────────────────────

export async function getResumoPeriodo(dias = 30, filtroTag = 'todas') {
  const diarias = await getMetricasDiarias(dias, filtroTag)
  const total = somar(diarias.map(d => ({
    gasto: d.gasto, impressoes: d.impressoes, cliques: d.cliques, pageViews: d.page_views,
    compras: d.compras, receitaPixel: d.receita_pixel, leads: d.leads, seguidores: d.seguidores,
  })))

  // Anomalia = dia com gasto muito acima/abaixo da média do período.
  // O dia CORRENTE fica de fora: ainda está rodando (parcial), então de manhã
  // ele sempre pareceria "queda" — alarme falso em toda consulta.
  const hoje = hojeBRT()
  const fechados = diarias.filter(d => d.data !== hoje)
  const mediaGasto = fechados.length ? fechados.reduce((s, d) => s + d.gasto, 0) / fechados.length : 0
  const anomalias = fechados
    .filter(d => mediaGasto > 0 && (d.gasto > mediaGasto * 1.8 || d.gasto < mediaGasto * 0.3))
    .map(d => ({ data: d.data, tipo: d.gasto > mediaGasto ? 'spike' : 'queda' }))

  return {
    periodo_dias: dias,
    filtro: filtroTag,
    ...formatarTotais(total),
    anomalias,
    contexto: 'Conta multi-objetivo: julgue cada corredor pela métrica própria — '
      + '[VENDAS] → CAC/compras, [LEADS] → CPL, [C1] atração → custo_por_seguidor, '
      + '[C2] distribuição → CPM/impressões. receita_pixel cobre só o que o pixel '
      + 'rastreia; a receita oficial virá da integração Hubla.',
  }
}

// ─── Campanhas ────────────────────────────────────────────────────────────────

export async function getCampanhas(dias = 30, filtroTag = 'todas') {
  const [cadastro, linhas] = await Promise.all([cadastroCampanhas(), diariasPorCampanha(dias)])

  const porCampanha = new Map()
  for (const l of linhas) {
    if (!porCampanha.has(l.campanhaId)) porCampanha.set(l.campanhaId, [])
    porCampanha.get(l.campanhaId).push(l)
  }

  return cadastro
    .filter(c => passaTag(c.name, filtroTag))
    .map(c => {
      const m = somar(porCampanha.get(c.id) ?? [])
      return {
        id: c.id,
        nome: c.name,
        temperatura: deriveTemperatura(c.name),
        ativa: c.status === 'ACTIVE',
        ...formatarTotais(m),
      }
    })
    .sort((a, b) => b.gasto - a.gasto)
}

export async function getTopCampanhas(limite = 5, criterio = 'gasto', dias = 30) {
  const campanhas = await getCampanhas(dias)
  return campanhas
    .filter(c => c.ativa)
    .sort((a, b) => (Number(b[criterio]) || 0) - (Number(a[criterio]) || 0))
    .slice(0, limite)
}

// ─── Criativos (nível anúncio) ────────────────────────────────────────────────
// Sem vereditos tipo "Matar/Ideal": eram régua de e-commerce aplicada a uma
// conta multi-objetivo. A IA que consome julga com o contexto do corredor.

export async function getCriativos(dias = 14, tipo = 'todos') {
  const rows = await insightsAnuncios(dias)

  const porAnuncio = new Map()
  for (const row of rows) {
    const atual = porAnuncio.get(row.ad_id)
    const m = mapearMetricas(row)
    if (!atual) {
      porAnuncio.set(row.ad_id, { nome: row.ad_name ?? '', ...m })
    } else {
      for (const k of Object.keys(m)) atual[k] += m[k]
    }
  }

  return Array.from(porAnuncio.entries())
    .map(([id, a]) => ({
      id,
      nome: a.nome,
      tipo: deriveTipo(a.nome),
      ...formatarTotais(a),
    }))
    .filter(c => tipo === 'todos' || c.tipo === tipo)
    .sort((a, b) => b.gasto - a.gasto)
}
