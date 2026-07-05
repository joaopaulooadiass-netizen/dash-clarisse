import {
  FORMULA_FIELDS,
  safeNumber,
  type MetricFormat,
  type MetricScope,
} from '@/lib/config/metrics'

export type { MetricFormat, MetricScope } from '@/lib/config/metrics'

export interface CustomMetricDefinition {
  id: string
  name: string
  formula: string
  format: MetricFormat
  group: string
  scope: MetricScope
  invertido: boolean
  createdAt: string
  updatedAt: string
}

export const METRIC_LIBRARY_STORAGE_KEY = 'cqv.metric-library.v1'
export const METRIC_LIBRARY_EVENT = 'metric-library:update'

export { FORMULA_FIELDS, formatMetricValue } from '@/lib/config/metrics'

const FIELD_KEYS = new Set(FORMULA_FIELDS.map(f => f.key))

export function readMetricLibrary(): CustomMetricDefinition[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(METRIC_LIBRARY_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isCustomMetricDefinition)
  } catch {
    return []
  }
}

export function writeMetricLibrary(metrics: CustomMetricDefinition[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(METRIC_LIBRARY_STORAGE_KEY, JSON.stringify(metrics))
  window.dispatchEvent(new CustomEvent(METRIC_LIBRARY_EVENT))
}

export function createMetricId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `metric_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function isCustomMetricDefinition(value: unknown): value is CustomMetricDefinition {
  const metric = value as Partial<CustomMetricDefinition>
  return Boolean(
    metric &&
    typeof metric.id === 'string' &&
    typeof metric.name === 'string' &&
    typeof metric.formula === 'string' &&
    ['number', 'currency', 'percent', 'ratio'].includes(metric.format ?? '') &&
    typeof metric.group === 'string' &&
    typeof metric.scope === 'string' &&
    typeof metric.invertido === 'boolean',
  )
}

// Gramática: operandos (campo/número) intercalados por operadores, parênteses
// balanceados. Sem isso, "gasto investimento" (sem operador) passava na regex e
// o eval CONCATENAVA os dígitos — 1200 e 1200 viravam 12.001.200 na tela.
function erroSequencia(tokens: string[]): string | null {
  let esperaOperando = true
  let depth = 0
  for (const token of tokens) {
    if (token === '(') {
      if (!esperaOperando) return 'Falta operador antes de "("'
      depth++
      continue
    }
    if (token === ')') {
      if (esperaOperando) return 'Parêntese fechado sem valor dentro'
      depth--
      if (depth < 0) return 'Parêntese fechado sem abrir'
      continue
    }
    if (['+', '-', '*', '/'].includes(token)) {
      if (esperaOperando) {
        if (token === '-') continue // menos unário (ex.: -1 * gasto)
        return `Operador "${token}" sem valor antes`
      }
      esperaOperando = true
      continue
    }
    // operando (campo ou número)
    if (!esperaOperando) return 'Faltou operador entre dois valores (ex.: gasto / cliques)'
    esperaOperando = false
  }
  if (depth !== 0) return 'Parênteses desbalanceados'
  if (esperaOperando) return 'Fórmula termina em operador'
  return null
}

export function validateFormula(formula: string): string | null {
  if (!formula.trim()) return 'Digite uma fórmula.'
  const tokens = formula.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:[.,]\d+)?|[()+\-*/]/g) ?? []
  const rebuilt = tokens.join('').toLowerCase()
  const compact = formula.replace(/\s+/g, '').toLowerCase()
  if (rebuilt !== compact) return 'Use apenas campos, números, +, -, *, / e parênteses.'

  for (const token of tokens) {
    if (/^[A-Za-z_]/.test(token) && !FIELD_KEYS.has(token)) {
      return `Campo não encontrado: ${token}`
    }
  }

  const seq = erroSequencia(tokens)
  if (seq) return seq

  try {
    const test = evaluateFormula(formula, Object.fromEntries(FORMULA_FIELDS.map(f => [f.key, 1])))
    if (test === null) return 'Fórmula inválida.'
  } catch {
    return 'Fórmula inválida.'
  }

  return null
}

// Sinônimos de campo — as telas guardam a MESMA grandeza sob nomes diferentes
// (Criativos usa `gasto`, Campanhas usa `investimento`...). Sem isso, a mesma
// fórmula custom funcionava numa tela e dava 0 silencioso na outra.
const FIELD_SYNONYMS: [string, string][] = [
  ['gasto', 'investimento'],
  ['receita', 'valorGerado'],
  ['vendas', 'compras'],
  ['conversoes', 'compras'],
  ['resultado', 'compras'],
  ['sessoes', 'pageView'],
]

export function withFormulaAliases(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row }
  for (const [a, b] of FIELD_SYNONYMS) {
    if (out[a] == null && out[b] != null) out[a] = out[b]
    if (out[b] == null && out[a] != null) out[b] = out[a]
  }
  return out
}

export function evaluateFormula(formula: string, row: Record<string, unknown>): number | null {
  const tokens = formula.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:[.,]\d+)?|[()+\-*/]/g) ?? []
  if (!tokens.length) return null
  // Mesma guarda do validateFormula: fórmula malformada salva ANTES do validador
  // existir (ex.: "gasto investimento") concatenaria dígitos aqui → null honesto
  if (erroSequencia(tokens)) return null

  // Campo que a tela NÃO coleta (ausente na row, ex.: cpv75 em Campanhas) torna a
  // fórmula incalculável → null → '-'. Convertê-lo em 0 fabricava "R$ 0,00" em
  // fórmulas aditivas ("cpv75 + cpv95") enquanto a coluna nativa mostrava '—'.
  // Campo presente com 0 continua 0 — dado real.
  let campoAusente = false
  const expression = tokens.map(token => {
    if (/^[A-Za-z_]/.test(token)) {
      if (row[token] == null) campoAusente = true
      return String(safeNumber(row[token]))
    }
    if (/^\d/.test(token)) return token.replace(',', '.')
    return token
  }).join('')
  if (campoAusente) return null

  if (!/^[\d.+\-*/() ]+$/.test(expression)) return null

  try {
    const result = Function(`"use strict"; return (${expression})`)() as unknown
    const value = typeof result === 'number' ? result : Number(result)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}
