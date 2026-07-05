'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  createMetricId,
  evaluateFormula,
  FORMULA_FIELDS,
  formatMetricValue,
  METRIC_LIBRARY_EVENT,
  type CustomMetricDefinition,
  type MetricFormat,
  type MetricScope,
  readMetricLibrary,
  validateFormula,
  writeMetricLibrary,
} from '@/lib/metrics/library'

const formatos: { value: MetricFormat; label: string }[] = [
  { value: 'number', label: 'Número' },
  { value: 'currency', label: 'Moeda' },
  { value: 'percent', label: 'Percentual' },
  { value: 'ratio', label: 'Multiplicador' },
]

const escopos: { value: MetricScope; label: string }[] = [
  { value: 'global', label: 'Todas' },
  { value: 'criativos', label: 'Criativos' },
  { value: 'campanhas', label: 'Campanhas' },
  { value: 'diaria', label: 'Diária' },
  { value: 'tendencias', label: 'Tendências' },
  { value: 'posicionamento', label: 'Posicionamento' },
  { value: 'publicos', label: 'Públicos' },
  { value: 'faturamento', label: 'Faturamento' },
  { value: 'listas', label: 'Listas' },
]

const sampleRow: Record<string, number> = {
  gasto: 1200,
  investimento: 1200,
  valorGerado: 4800,
  receita: 4800,
  compras: 12,
  vendas: 12,
  conversoes: 12,
  impressoes: 42000,
  cliques: 620,
  leads: 180,
  sessoes: 2400,
  ctr: 1.48,
  cpc: 1.94,
  cpm: 28.57,
  cac: 100,
  cpl: 6.67,
  roas: 4,
  hookRate: 22,
  retencao75: 31,
  cpv75: 3.2,
  ticketMedio: 400,
  taxaConversao: 6.67,
  // evaluateFormula devolve null para campo AUSENTE — sem estes, o preview de
  // fórmulas com pageView/engajamento etc. mostrava "Resultado teste: -"
  resultado: 12,
  seguidores: 350,
  pageView: 2400,
  viewContent: 1800,
  cpv95: 4.1,
  taxaConversaoClique: 1.94,
  connectRate: 74,
  custoPorPageView: 0.5,
  video3sViews: 9200,
  profileVisits: 300,
  postEngagement: 1500,
  reactions: 800,
  comments: 90,
  shares: 60,
  saves: 45,
  thruplays: 4100,
}
// Rede de segurança: campo novo em FORMULA_FIELDS nunca derruba o preview pra '-'
for (const f of FORMULA_FIELDS) if (sampleRow[f.key] == null) sampleRow[f.key] = 1

interface FormState {
  id: string | null
  name: string
  formula: string
  format: MetricFormat
  group: string
  scope: MetricScope
  invertido: boolean
}

const emptyForm: FormState = {
  id: null,
  name: '',
  formula: '',
  format: 'number',
  group: 'Customizadas',
  scope: 'global',
  invertido: false,
}

export function useMetricLibrary() {
  const [metrics, setMetrics] = useState<CustomMetricDefinition[]>([])

  useEffect(() => {
    const sync = () => setMetrics(readMetricLibrary())
    sync()
    window.addEventListener(METRIC_LIBRARY_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(METRIC_LIBRARY_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return metrics
}

export function MetricLibraryPanel() {
  const metrics = useMetricLibrary()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return metrics
    return metrics.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.formula.toLowerCase().includes(q) ||
      m.group.toLowerCase().includes(q),
    )
  }, [metrics, query])

  const formulaError = validateFormula(form.formula)
  const previewValue = formulaError ? null : evaluateFormula(form.formula, sampleRow)
  // Nome duplicado criaria entradas homônimas nos seletores de coluna das telas
  const nomeDuplicado = metrics.some(m => m.name.trim().toLowerCase() === form.name.trim().toLowerCase() && m.id !== form.id)
  const nameError = form.name.trim() && nomeDuplicado ? 'Já existe uma métrica com esse nome.' : null

  function insertToken(token: string) {
    setForm(prev => ({ ...prev, formula: prev.formula ? `${prev.formula} ${token}` : token }))
  }

  function saveMetric() {
    const name = form.name.trim()
    const formula = form.formula.trim()
    const error = validateFormula(formula)
    const duplicado = metrics.some(m => m.name.trim().toLowerCase() === name.toLowerCase() && m.id !== form.id)
    if (!name || error || duplicado) return

    const now = new Date().toISOString()
    const nextMetric: CustomMetricDefinition = {
      id: form.id ?? createMetricId(),
      name,
      formula,
      format: form.format,
      group: form.group.trim() || 'Customizadas',
      scope: form.scope,
      invertido: form.invertido,
      createdAt: metrics.find(m => m.id === form.id)?.createdAt ?? now,
      updatedAt: now,
    }

    // `existe` protege a edição órfã: se a métrica em edição foi excluída em
    // outra aba, o .map não acharia ninguém e o salvamento SUMIA em silêncio —
    // agora ela é re-inserida com o mesmo id.
    const existe = form.id !== null && metrics.some(m => m.id === form.id)
    writeMetricLibrary(
      existe
        ? metrics.map(m => m.id === form.id ? nextMetric : m)
        : [nextMetric, ...metrics],
    )
    setForm(emptyForm)
  }

  function editMetric(metric: CustomMetricDefinition) {
    setForm({
      id: metric.id,
      name: metric.name,
      formula: metric.formula,
      format: metric.format,
      group: metric.group,
      scope: metric.scope,
      invertido: metric.invertido,
    })
  }

  function deleteMetric(id: string) {
    writeMetricLibrary(metrics.filter(m => m.id !== id))
    if (form.id === id) setForm(emptyForm)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Biblioteca de métricas"
        style={{
          position: 'fixed',
          right: '1rem',
          bottom: '1rem',
          zIndex: 35,
          width: '46px',
          height: '46px',
          borderRadius: '50%',
          border: '1px solid var(--color-border-subtle)',
          backgroundColor: 'var(--color-bg-secondary)',
          color: 'var(--color-text-primary)',
          fontFamily: 'var(--font-body)',
          fontSize: '1rem',
          fontWeight: 800,
          cursor: 'pointer',
          boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
        }}
      >
        ƒ
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 60, backdropFilter: 'blur(4px)' }} />
          <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(760px, 96vw)', backgroundColor: 'var(--color-bg-secondary)', borderLeft: '1px solid var(--color-border-subtle)', zIndex: 61, display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(300px, 1.1fr)', boxShadow: '-24px 0 60px rgba(0,0,0,0.5)' }}>
            <section style={{ minWidth: 0, borderRight: '1px solid var(--color-border-subtle)', display: 'flex', flexDirection: 'column' }}>
              <header style={{ padding: '1rem 1.1rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                  <div>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>Biblioteca de métricas</p>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>{metrics.length} salvas</p>
                  </div>
                  <button type="button" onClick={() => setOpen(false)} style={{ width: '32px', height: '32px', borderRadius: '50%', border: '1px solid var(--color-border-subtle)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '1rem' }}>×</button>
                </div>
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar"
                  style={{ marginTop: '0.8rem', width: '100%', height: '36px', padding: '0 0.7rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)', fontSize: '0.78rem', outline: 'none' }}
                />
              </header>

              <div style={{ flex: 1, overflowY: 'auto', padding: '0.8rem' }}>
                {filtered.length === 0 && (
                  <p style={{ fontFamily: 'var(--font-body)', color: 'var(--color-text-muted)', fontSize: '0.78rem', padding: '0.8rem' }}>Nenhuma métrica salva</p>
                )}
                {filtered.map(metric => (
                  <article key={metric.id} style={{ padding: '0.75rem', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-bg-card)', marginBottom: '0.55rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 800, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{metric.name}</p>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>{metric.group} · {escopos.find(s => s.value === metric.scope)?.label}</p>
                      </div>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-ponto-conversao)', fontWeight: 800 }}>{formatMetricValue(evaluateFormula(metric.formula, sampleRow), metric.format)}</span>
                    </div>
                    <code style={{ display: 'block', marginTop: '0.55rem', padding: '0.45rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(0,0,0,0.22)', color: 'var(--color-text-secondary)', fontFamily: 'monospace', fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{metric.formula}</code>
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.65rem' }}>
                      <button type="button" onClick={() => editMetric(metric)} style={smallButtonStyle}>Editar</button>
                      <button type="button" onClick={() => deleteMetric(metric.id)} style={{ ...smallButtonStyle, color: 'var(--color-signal-red)' }}>Excluir</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <header style={{ padding: '1rem 1.1rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>{form.id ? 'Editar métrica' : 'Calculadora'}</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>Resultado teste: {formatMetricValue(previewValue, form.format)}</p>
              </header>

              <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.1rem' }}>
                <label style={labelStyle}>Nome</label>
                <input value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Ex: ROAS líquido" style={inputStyle} />
                {nameError && <p style={{ marginTop: '0.3rem', fontFamily: 'var(--font-body)', fontSize: '0.66rem', color: 'var(--color-signal-red)' }}>{nameError}</p>}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem', marginTop: '0.75rem' }}>
                  <div>
                    <label style={labelStyle}>Formato</label>
                    <select value={form.format} onChange={e => setForm(prev => ({ ...prev, format: e.target.value as MetricFormat }))} style={inputStyle}>
                      {formatos.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Escopo</label>
                    <select value={form.scope} onChange={e => setForm(prev => ({ ...prev, scope: e.target.value as MetricScope }))} style={inputStyle}>
                      {escopos.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ marginTop: '0.75rem' }}>
                  <label style={labelStyle}>Grupo</label>
                  <input value={form.group} onChange={e => setForm(prev => ({ ...prev, group: e.target.value }))} style={inputStyle} />
                </div>

                <div style={{ marginTop: '0.75rem' }}>
                  <label style={labelStyle}>Fórmula</label>
                  <textarea value={form.formula} onChange={e => setForm(prev => ({ ...prev, formula: e.target.value }))} placeholder="valorGerado / gasto" style={{ ...inputStyle, height: '92px', paddingTop: '0.65rem', resize: 'vertical' }} />
                  <p style={{ minHeight: '18px', marginTop: '0.3rem', fontFamily: 'var(--font-body)', fontSize: '0.66rem', color: formulaError ? 'var(--color-signal-red)' : 'var(--color-text-muted)' }}>{formulaError ?? 'Fórmula válida'}</p>
                  {/* Convenção do app: percentuais circulam na escala 0–100 (CTR 2.14 = 2,14%).
                      Razão 0–1 sem o ×100 renderizaria "0.0%" em todas as telas. */}
                  {form.format === 'percent' && (
                    <p style={{ marginTop: '0.15rem', fontFamily: 'var(--font-body)', fontSize: '0.64rem', lineHeight: 1.5, color: !formulaError && previewValue !== null && previewValue !== 0 && Math.abs(previewValue) < 1 ? 'var(--color-signal-yellow)' : 'var(--color-text-muted)' }}>
                      {!formulaError && previewValue !== null && previewValue !== 0 && Math.abs(previewValue) < 1
                        ? `⚠ Resultado ${previewValue.toFixed(4)} será exibido como "${previewValue.toFixed(1)}%". Se a fórmula é uma razão (ex.: cliques / impressoes), multiplique por 100.`
                        : 'Formato % exibe o valor como está (2.14 → "2.1%"). Razão 0–1? Inclua × 100 na fórmula.'}
                    </p>
                  )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.4rem' }}>
                  {['+', '-', '*', '/', '(', ')'].map(op => (
                    <button key={op} type="button" onClick={() => insertToken(op)} style={chipStyle}>{op}</button>
                  ))}
                </div>

                <p style={{ ...labelStyle, marginTop: '1rem' }}>Campos</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                  {FORMULA_FIELDS.map(field => (
                    <button key={field.key} type="button" onClick={() => insertToken(field.key)} title={field.label} style={chipStyle}>{field.key}</button>
                  ))}
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '1rem', fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                  <input type="checkbox" checked={form.invertido} onChange={e => setForm(prev => ({ ...prev, invertido: e.target.checked }))} />
                  Menor é melhor
                </label>
              </div>

              <footer style={{ display: 'flex', gap: '0.6rem', padding: '0.85rem 1.1rem', borderTop: '1px solid var(--color-border-subtle)' }}>
                <button type="button" onClick={() => setForm(emptyForm)} style={{ ...actionButtonStyle, backgroundColor: 'transparent', color: 'var(--color-text-muted)' }}>Limpar</button>
                <button type="button" onClick={saveMetric} disabled={!form.name.trim() || !!formulaError || !!nameError} style={{ ...actionButtonStyle, flex: 1, opacity: !form.name.trim() || formulaError || nameError ? 0.45 : 1, cursor: !form.name.trim() || formulaError || nameError ? 'default' : 'pointer' }}>Salvar métrica</button>
              </footer>
            </section>
          </aside>
        </>
      )}
    </>
  )
}

const labelStyle: CSSProperties = {
  display: 'block',
  marginBottom: '0.35rem',
  fontFamily: 'var(--font-body)',
  fontSize: '0.64rem',
  fontWeight: 800,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

const inputStyle: CSSProperties = {
  width: '100%',
  minHeight: '38px',
  padding: '0 0.65rem',
  backgroundColor: 'var(--color-bg-card)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-body)',
  fontSize: '0.78rem',
  outline: 'none',
}

const chipStyle: CSSProperties = {
  padding: '0.32rem 0.5rem',
  backgroundColor: 'var(--color-bg-card)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-secondary)',
  fontFamily: 'var(--font-body)',
  fontSize: '0.7rem',
  cursor: 'pointer',
}

const smallButtonStyle: CSSProperties = {
  padding: '0.28rem 0.55rem',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  backgroundColor: 'transparent',
  color: 'var(--color-text-muted)',
  fontFamily: 'var(--font-body)',
  fontSize: '0.68rem',
  cursor: 'pointer',
}

const actionButtonStyle: CSSProperties = {
  minHeight: '38px',
  padding: '0 0.9rem',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  backgroundColor: 'var(--color-ponto-conversao)',
  color: 'white',
  fontFamily: 'var(--font-body)',
  fontSize: '0.78rem',
  fontWeight: 800,
}
