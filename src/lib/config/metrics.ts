export type MetricFormat = 'number' | 'currency' | 'percent' | 'ratio'
export type MetricScope = 'global' | 'criativos' | 'campanhas' | 'diaria' | 'tendencias' | 'faturamento' | 'listas' | 'posicionamento' | 'publicos' | 'funil'
export type MetricKey = string

export interface MetricDefinition<T = Record<string, unknown>> {
  key: MetricKey
  label: string
  group: string
  scope: MetricScope[]
  format: MetricFormat
  invertido?: boolean
  cor?: string
  defaultVisible?: Partial<Record<MetricScope, boolean>>
  colorized?: Partial<Record<MetricScope, boolean>>
  getValue: (row: T) => number
}

export interface FormulaField {
  key: string
  label: string
}

export const FORMULA_FIELDS: FormulaField[] = [
  { key: 'gasto', label: 'Gasto' },
  { key: 'investimento', label: 'Investimento' },
  { key: 'valorGerado', label: 'Valor gerado' },
  { key: 'receita', label: 'Receita' },
  { key: 'compras', label: 'Compras' },
  { key: 'vendas', label: 'Vendas' },
  { key: 'resultado', label: 'Resultado' },
  { key: 'conversoes', label: 'Conversões' },
  { key: 'impressoes', label: 'Impressões' },
  { key: 'cliques', label: 'Cliques' },
  { key: 'leads', label: 'Leads' },
  { key: 'seguidores', label: 'Seguidores' },
  { key: 'sessoes', label: 'Sessões' },
  { key: 'pageView', label: 'Page View' },
  { key: 'viewContent', label: 'View Content' },
  { key: 'ctr', label: 'CTR' },
  { key: 'cpc', label: 'CPC' },
  { key: 'cpm', label: 'CPM' },
  { key: 'cac', label: 'CAC' },
  { key: 'cpl', label: 'CPL' },
  { key: 'roas', label: 'ROAS' },
  { key: 'hookRate', label: 'Hook Rate' },
  { key: 'retencao75', label: 'Retenção 75%' },
  { key: 'cpv75', label: 'CPV 75%' },
  { key: 'cpv95', label: 'CPV 95%' },
  { key: 'ticketMedio', label: 'Ticket médio' },
  { key: 'taxaConversao', label: 'Taxa conversão' },
  { key: 'taxaConversaoClique', label: 'Tx. conv. clique' },
  { key: 'connectRate', label: 'Connect Rate' },
  { key: 'custoPorPageView', label: 'Custo/Page View' },
  { key: 'video3sViews', label: '3s Views' },
  { key: 'profileVisits', label: 'Visita ao Perfil' },
  { key: 'postEngagement', label: 'Engaj. c/ Post' },
  { key: 'reactions', label: 'Reações' },
  { key: 'comments', label: 'Comentários' },
  { key: 'shares', label: 'Compartilhamentos' },
  { key: 'saves', label: 'Salvamentos' },
  { key: 'thruplays', label: 'ThruPlays' },
]

export const DASHBOARD_METRICS: MetricDefinition[] = [
  // "Gasto" e "Investimento" são a mesma coisa — uma métrica só, que lê qualquer
  // um dos dois campos e se apresenta como "Gasto" na tela de Criativos (alias)
  metric('investimento', 'Investimento', 'Veiculação', 'currency', ['global', 'campanhas', 'diaria', 'tendencias', 'faturamento'], row => firstNumber(row, 'investimento', 'gasto'), { defaultScopes: ['campanhas', 'diaria', 'tendencias', 'criativos'], neutral: true }),
  metric('impressoes', 'Impressões', 'Veiculação', 'number', ['global', 'criativos', 'campanhas', 'diaria', 'funil'], row => numberValue(row, 'impressoes'), { defaultScopes: ['campanhas', 'diaria'], cor: '#6E6E66' }),
  metric('cpm', 'CPM', 'Veiculação', 'currency', ['global', 'criativos', 'campanhas', 'diaria', 'tendencias'], row => numberValue(row, 'cpm'), { defaultScopes: ['campanhas', 'diaria'], colorScopes: ['campanhas'], invertido: true }),
  metric('ctr', 'CTR', 'Veiculação', 'percent', ['global', 'criativos', 'campanhas', 'diaria', 'tendencias'], row => numberValue(row, 'ctr'), { defaultScopes: ['criativos', 'campanhas', 'diaria'], colorScopes: ['criativos', 'campanhas', 'diaria'], }),
  metric('cliques', 'Cliques', 'Veiculação', 'number', ['global', 'campanhas', 'diaria', 'funil'], row => numberValue(row, 'cliques'), { defaultScopes: ['campanhas', 'diaria'], cor: '#5C79C9' }),
  // Fallback de divisão: rows sem 'cpc' pronto (ex.: campanhas) derivam das bases
  // — sem isso a coluna mostrava R$ 0,00 em toda célula com total real embaixo
  metric('cpc', 'CPC', 'Veiculação', 'currency', ['global', 'criativos', 'diaria'], row => numberValue(row, 'cpc') || divide(firstNumber(row, 'investimento', 'gasto'), numberValue(row, 'cliques')), { defaultScopes: ['diaria'], invertido: true }),
  // Qualidade do anúncio (vídeo) — são métricas de VEICULAÇÃO (decisão João).
  // Escopo só 'criativos': é a única fonte que coleta video3sViews — como métrica
  // global, as outras telas fabricavam "0.0%" numa base que não existe
  metric('hookRate', 'Hook Rate', 'Veiculação', 'percent', ['criativos'], row => numberValue(row, 'hookRate'), { defaultScopes: ['criativos'] }),
  metric('retencao75', 'Retenção 75%', 'Veiculação', 'percent', ['global', 'criativos', 'campanhas', 'diaria'], row => numberValue(row, 'retencao75')),
  metric('cpv75', 'CPV 75%', 'Veiculação', 'currency', ['global', 'criativos', 'campanhas', 'diaria'], row => numberValue(row, 'cpv75'), { invertido: true }),
  metric('cpv95', 'CPV 95%', 'Veiculação', 'currency', ['global', 'campanhas', 'diaria'], row => numberValue(row, 'cpv95'), { invertido: true }),
  metric('connectRate', 'Connect Rate', 'Página', 'percent', ['global', 'campanhas', 'diaria'], row => derivedConnectRate(row), { defaultScopes: ['campanhas'], colorScopes: ['campanhas'] }),
  metric('pageView', 'Page View', 'Página', 'number', ['global', 'campanhas', 'diaria', 'funil'], row => numberValue(row, 'pageView'), { cor: '#8FA0DC' }),
  // ViewContent = métrica PRÓPRIA (decisão João 2026-07-02) — evento do pixel,
  // nunca fallback de Page View. Escopo só onde o campo é coletado (campanhas/criativos).
  metric('viewContent', 'View Content', 'Página', 'number', ['campanhas', 'criativos'], row => numberValue(row, 'viewContent'), { cor: '#9A86D6' }),
  metric('custoPorPageView', 'Custo/Page View', 'Página', 'currency', ['global', 'campanhas', 'diaria'], row => firstNumber(row, 'custoPorPageView') || divide(firstNumber(row, 'investimento', 'gasto'), numberValue(row, 'pageView')), { invertido: true }),
  // Contagens do funil: Início de Checkout e Leads existem como etapa de funil e
  // entram em outras telas quando os dados delas trouxerem esses campos
  metric('inicioCheckout', 'Início de Checkout', 'Conversão', 'number', ['funil'], row => firstNumber(row, 'inicioCheckout', 'checkout'), { cor: '#E8BE0B' }),
  metric('compras', 'Compras', 'Conversão', 'number', ['global', 'criativos', 'campanhas', 'tendencias', 'funil'], row => firstNumber(row, 'compras', 'vendas', 'conversoes'), { defaultScopes: ['criativos', 'campanhas'], cor: '#5F8A3C' }),
  metric('leads', 'Leads', 'Conversão', 'number', ['funil'], row => numberValue(row, 'leads'), { cor: '#9A86D6' }),
  // "Resultado" = evento que a campanha otimiza (dinâmico, vem pré-calculado em
  // 'resultado'); fora de campanhas cai pra vendas/compras. Ver getResultadoPorCampanha.
  metric('vendas', 'Resultado', 'Conversão', 'number', ['global', 'campanhas', 'diaria', 'faturamento'], row => firstNumber(row, 'resultado', 'vendas', 'compras', 'conversoes'), { defaultScopes: ['diaria', 'campanhas'] }),
  metric('valorGerado', 'Valor Gerado', 'Conversão', 'currency', ['global', 'criativos', 'campanhas', 'diaria', 'tendencias'], row => firstNumber(row, 'valorGerado', 'receita'), { defaultScopes: ['campanhas'] }),
  metric('receita', 'Receita', 'Conversão', 'currency', ['global', 'tendencias', 'faturamento'], row => firstNumber(row, 'receita', 'valorGerado')),
  metric('roas', 'ROAS', 'Conversão', 'ratio', ['global', 'criativos', 'campanhas', 'diaria', 'tendencias'], row => numberValue(row, 'roas') || divide(firstNumber(row, 'valorGerado', 'receita'), firstNumber(row, 'investimento', 'gasto')), { defaultScopes: ['criativos'], colorScopes: ['campanhas', 'diaria'] }),
  metric('cac', 'CAC', 'Conversão', 'currency', ['global', 'criativos', 'campanhas', 'diaria', 'tendencias'], row => numberValue(row, 'cac') || divide(firstNumber(row, 'investimento', 'gasto'), firstNumber(row, 'compras', 'vendas', 'conversoes')), { defaultScopes: ['criativos', 'diaria'], colorScopes: ['campanhas', 'diaria'], invertido: true }),
  metric('ticketMedio', 'Ticket Médio', 'Conversão', 'currency', ['global', 'diaria', 'faturamento'], row => numberValue(row, 'ticketMedio') || divide(firstNumber(row, 'valorGerado', 'receita'), firstNumber(row, 'compras', 'vendas', 'conversoes'))),
  metric('pctCheckout', '% Checkout', 'Conversão', 'percent', ['campanhas'], row => numberValue(row, 'pctCheckout'), { defaultScopes: ['campanhas'], colorScopes: ['campanhas'] }),
  metric('pctCompras', 'Conv. do IC', 'Conversão', 'percent', ['campanhas'], row => numberValue(row, 'pctCompras'), { defaultScopes: ['campanhas'], colorScopes: ['campanhas'] }),
  metric('taxaConversao', 'Conv. LP → Venda', 'Conversão', 'percent', ['global', 'campanhas', 'diaria', 'listas'], row => numberValue(row, 'taxaConversao') || divide(firstNumber(row, 'compras', 'vendas'), numberValue(row, 'pageView')) * 100),
  metric('taxaConvLead', 'Conv. LP → Lead', 'Conversão', 'percent', ['global', 'campanhas', 'diaria'], row => numberValue(row, 'taxaConvLead') || divide(numberValue(row, 'leads'), numberValue(row, 'pageView')) * 100),
  metric('taxaConversaoClique', 'Conv. Clique → Venda', 'Conversão', 'percent', ['global'], row => numberValue(row, 'taxaConversaoClique') || divide(firstNumber(row, 'compras', 'vendas', 'conversoes'), numberValue(row, 'cliques')) * 100),
  metric('seguidores', 'Seguidores', 'Engajamento', 'number', ['global', 'criativos', 'campanhas', 'diaria', 'funil'], row => firstNumber(row, 'seguidores'), { defaultScopes: ['campanhas'], colorScopes: ['campanhas'], cor: '#F3850C' }),
  metric('custoSeguidores', 'Custo/Seguidor', 'Engajamento', 'currency', ['global', 'criativos', 'campanhas', 'diaria'], row => divide(firstNumber(row, 'investimento', 'gasto'), numberValue(row, 'seguidores')), { invertido: true }),

  // ── Engajamento (criativos) — contagens confirmadas na conta + custos derivados ──
  // Custos = gasto ÷ contagem (menor é melhor). Ver docs/metricas-catalogo.md Parte 4.
  metric('video3sViews', '3s Views', 'Engajamento', 'number', ['criativos'], row => numberValue(row, 'video3sViews')),
  metric('profileVisits', 'Visita ao Perfil', 'Engajamento', 'number', ['criativos'], row => numberValue(row, 'profileVisits'), { defaultScopes: ['criativos'] }),
  metric('postEngagement', 'Engaj. c/ Post', 'Engajamento', 'number', ['criativos'], row => numberValue(row, 'postEngagement')),
  metric('reactions', 'Reações', 'Engajamento', 'number', ['criativos'], row => numberValue(row, 'reactions')),
  metric('comments', 'Comentários', 'Engajamento', 'number', ['criativos'], row => numberValue(row, 'comments')),
  metric('shares', 'Compartilhamentos', 'Engajamento', 'number', ['criativos'], row => numberValue(row, 'shares')),
  metric('saves', 'Salvamentos', 'Engajamento', 'number', ['criativos'], row => numberValue(row, 'saves')),
  metric('thruplays', 'ThruPlays', 'Engajamento', 'number', ['criativos'], row => numberValue(row, 'thruplays')),
  metric('custoProfileVisit', 'Custo/Visita Perfil', 'Engajamento', 'currency', ['criativos'], row => divide(firstNumber(row, 'investimento', 'gasto'), numberValue(row, 'profileVisits')), { invertido: true }),
  metric('custoEngajamento', 'Custo/Engaj.', 'Engajamento', 'currency', ['criativos'], row => divide(firstNumber(row, 'investimento', 'gasto'), numberValue(row, 'postEngagement')), { invertido: true }),
  metric('custoReaction', 'Custo/Reação', 'Engajamento', 'currency', ['criativos'], row => divide(firstNumber(row, 'investimento', 'gasto'), numberValue(row, 'reactions')), { invertido: true }),
  metric('custoComment', 'Custo/Comentário', 'Engajamento', 'currency', ['criativos'], row => divide(firstNumber(row, 'investimento', 'gasto'), numberValue(row, 'comments')), { invertido: true }),
  metric('custoShare', 'Custo/Compart.', 'Engajamento', 'currency', ['criativos'], row => divide(firstNumber(row, 'investimento', 'gasto'), numberValue(row, 'shares')), { invertido: true }),
  metric('custoSave', 'Custo/Salvamento', 'Engajamento', 'currency', ['criativos'], row => divide(firstNumber(row, 'investimento', 'gasto'), numberValue(row, 'saves')), { invertido: true }),
  metric('custoThruplay', 'Custo/ThruPlay', 'Engajamento', 'currency', ['criativos'], row => divide(firstNumber(row, 'investimento', 'gasto'), numberValue(row, 'thruplays')), { invertido: true }),

  // Conv. 75% — converteu a partir de quem assistiu 75% do vídeo (varia por evento)
  metric('conv75Venda', 'Conv. 75% → Venda', 'Conversão', 'percent', ['criativos'], row => numberValue(row, 'conv75Venda')),
  metric('conv75Lead', 'Conv. 75% → Lead', 'Conversão', 'percent', ['criativos'], row => numberValue(row, 'conv75Lead')),
  metric('conv75Seguidor', 'Conv. 75% → Seguidor', 'Conversão', 'percent', ['criativos'], row => numberValue(row, 'conv75Seguidor')),
]

export const CRIATIVOS_DEFAULT_METRIC_KEYS = ['compras', 'cac', 'roas', 'hookRate', 'ctr', 'investimento']
export const CAMPANHAS_DEFAULT_METRIC_KEYS = ['nome', 'impressoes', 'cpm', 'ctr', 'cliques', 'connectRate', 'pctCheckout', 'pctCompras', 'vendas', 'compras', 'valorGerado', 'investimento']
export const DIARIA_DEFAULT_METRIC_KEYS = ['investimento', 'vendas', 'cac', 'impressoes', 'cpm', 'ctr', 'cliques', 'cpc']
export const TENDENCIAS_LINE_METRIC_KEYS = ['investimento', 'valorGerado', 'roas', 'cac', 'ctr', 'cpm', 'compras']
export const TENDENCIAS_HEATMAP_METRIC_KEYS = ['investimento', 'roas', 'compras', 'ctr', 'cac']
export const TENDENCIAS_REGION_METRIC_KEYS = ['investimento', 'roas', 'compras', 'ctr']

export const METRIC_ALIASES: Record<string, Partial<Record<MetricScope, string>>> = {
  cac: { tendencias: 'CPA' },
  valorGerado: { tendencias: 'Receita' },
  // Na Diária o dado da coluna 'vendas' são COMPRAS puras (ACTION_COMPRA) — o
  // rótulo "Resultado" (evento otimizado, dinâmico) fica só na tabela de
  // campanhas, onde o dado é de fato o resultado dinâmico.
  vendas: { diaria: 'Compras' },
  taxaConversao: { posicionamento: 'Conv. Página → Venda' },
  investimento: { criativos: 'Gasto' },
  cliques: { funil: 'Cliques no Link' },
}

export function getMetricByKey(key: string) {
  return DASHBOARD_METRICS.find(metric => metric.key === key)
}

export function getMetricsForScope(scope: MetricScope) {
  return DASHBOARD_METRICS.filter(metric => metric.scope.includes('global') || metric.scope.includes(scope))
}

// Etapas elegíveis para o funil: só contagens marcadas explicitamente com o escopo
// 'funil' (sem o fallback 'global' — taxa tipo CTR não é etapa de funil; ela nasce
// da razão entre duas etapas consecutivas)
export function getFunnelMetrics() {
  return DASHBOARD_METRICS.filter(metric => metric.scope.includes('funil'))
}

export function getDefaultMetricKeys(scope: MetricScope) {
  if (scope === 'criativos') return CRIATIVOS_DEFAULT_METRIC_KEYS
  if (scope === 'campanhas') return CAMPANHAS_DEFAULT_METRIC_KEYS
  if (scope === 'diaria') return DIARIA_DEFAULT_METRIC_KEYS
  if (scope === 'tendencias') return TENDENCIAS_LINE_METRIC_KEYS
  return getMetricsForScope(scope).filter(metric => metric.defaultVisible?.[scope]).map(metric => metric.key)
}

export function getMetricLabel(metric: Pick<MetricDefinition, 'key' | 'label'>, scope?: MetricScope) {
  return scope ? METRIC_ALIASES[metric.key]?.[scope] ?? metric.label : metric.label
}

export function formatMetricValue(value: number | null | undefined, format: MetricFormat): string {
  if (value == null || !Number.isFinite(value)) return '-'
  if (format === 'currency') {
    // Valor EXATO sempre, com centavos (decisão João 2026-07-01: R$ 1.705,97,
    // nunca R$ 1.706 — arredondar escondia os centavos reais da conta)
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (format === 'percent') return `${value.toFixed(1)}%`
  if (format === 'ratio') return `${value.toFixed(2)}x`
  if (Math.abs(value) >= 1000 || Number.isInteger(value)) return value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
  return value.toFixed(2)
}

export function safeNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

// Para no primeiro campo PRESENTE, mesmo que valha 0 — a cadeia é de sinônimos
// entre telas, não de fallback de valor. Com `!== 0`, uma campanha de leads com
// resultado 0 real pulava para `compras` e a coluna Resultado mostrava compras
// de carona (unidade errada). 0 presente é dado real, não ausência.
export function firstNumber(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (row[key] != null) return safeNumber(row[key])
  }
  return 0
}

export function divide(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0
}

function numberValue(row: Record<string, unknown>, key: string) {
  return safeNumber(row[key])
}

function derivedConnectRate(row: Record<string, unknown>) {
  const explicit = numberValue(row, 'connectRate')
  if (explicit) return explicit
  return divide(numberValue(row, 'pageView'), numberValue(row, 'cliques')) * 100
}

function metric(
  key: string,
  label: string,
  group: string,
  format: MetricFormat,
  scope: MetricScope[],
  getValue: (row: Record<string, unknown>) => number,
  options: {
    invertido?: boolean
    cor?: string
    defaultScopes?: MetricScope[]
    colorScopes?: MetricScope[]
    neutral?: boolean
  } = {},
): MetricDefinition {
  return {
    key,
    label,
    group,
    scope,
    format,
    getValue,
    invertido: options.invertido,
    cor: options.cor,
    defaultVisible: Object.fromEntries((options.defaultScopes ?? []).map(s => [s, true])),
    colorized: Object.fromEntries((options.colorScopes ?? []).map(s => [s, true])),
  }
}
