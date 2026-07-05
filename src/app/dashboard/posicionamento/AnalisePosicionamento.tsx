'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import {
  type PlacementDia,
  PLATAFORMA_LABEL, POSICAO_LABEL, DISPOSITIVO_LABEL,
} from '@/lib/meta/publicos'
import { SeletorPeriodo } from '@/components/ui/SeletorPeriodo'
import { FiltroFunil, type FiltroState, FILTRO_VAZIO, temFiltroAtivo, passaFiltroNome } from '@/components/dashboard/FiltroFunil'
import { useMetricLibrary } from '@/components/metrics/MetricLibraryPanel'
import { evaluateFormula, withFormulaAliases } from '@/lib/metrics/library'
import { formatMetricValue, getMetricLabel, getMetricsForScope } from '@/lib/config/metrics'
import { derivarMetricas } from '@/lib/metrics/derivar'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Agrup = 'plataforma' | 'posicao' | 'so' | 'dispositivo'

interface MetricaDef {
  key: string
  label: string
  grupo: string
  formatRaw: (v: number) => string
  getValue: (row: Record<string, number>) => number
  invertido?: boolean
}

// ─── Métricas da biblioteca compartilhada ─────────────────────────────────────

const METRICAS_BASE: MetricaDef[] = getMetricsForScope('posicionamento').map(m => ({
  key: m.key,
  label: getMetricLabel(m, 'posicionamento'),
  grupo: m.group,
  formatRaw: (v: number) => formatMetricValue(v, m.format),
  getValue: (row: Record<string, number>) => m.getValue(row as unknown as Record<string, unknown>),
  invertido: m.invertido,
}))

// Métricas aditivas: faz sentido mostrar % de participação no total
const ADITIVAS = new Set(['investimento', 'gasto', 'impressoes', 'cliques', 'pageView', 'compras', 'vendas', 'conversoes', 'valorGerado', 'receita', 'seguidores'])

// ─── Agregação ────────────────────────────────────────────────────────────────
// Linha agregada com somas brutas + derivadas + aliases — alimenta tanto as
// métricas built-in (getValue) quanto fórmulas customizadas (evaluateFormula).

function agregar(rows: PlacementDia[]): Record<string, number> {
  let investimento = 0, impressoes = 0, cliques = 0, pageView = 0, compras = 0, valorGerado = 0, seguidores = 0
  for (const r of rows) {
    investimento += r.investimento
    impressoes   += r.impressoes
    cliques      += r.cliques
    pageView     += r.pageView
    compras      += r.compras
    valorGerado  += r.valorGerado
    seguidores   += r.seguidores
  }
  // Derivadas da fonte única — uma fórmula só (ver lib/metrics/derivar.ts)
  const d = derivarMetricas({ gasto: investimento, impressoes, cliques, pageView, compras, valorGerado, seguidores })
  return {
    investimento, gasto: investimento,
    impressoes, cliques, pageView,
    compras, vendas: compras, conversoes: compras,
    valorGerado, receita: valorGerado,
    seguidores,
    ctr:                 d.ctr,
    cpm:                 d.cpm,
    cpc:                 d.cpc,
    roas:                d.roas,
    cac:                 d.cac,
    connectRate:         d.connectRate,
    taxaConversao:       d.taxaConvVendaLP,   // compra ÷ pageView
    taxaConversaoClique: d.taxaConvClique,
    ticketMedio:         d.ticketMedio,
    custoPorPageView:    d.custoPorPageView,
    custoSeguidores:     d.custoSeguidor,
  }
}

// ─── Agrupamento e cores ──────────────────────────────────────────────────────

const PLAT_COR: Record<string, string> = {
  facebook: '#1877F2', instagram: '#E1306C',
  audience_network: '#5C79C9', messenger: '#00B2FF',
  threads: '#7D68C0', whatsapp: '#25D366',
}
const SO_COR: Record<string, string> = {
  iOS: '#5C79C9', Android: '#8DB82F', Desktop: '#E8BE0B', Outro: '#8A8A7E',
}
const DEV_COR: Record<string, string> = {
  iphone: '#5C79C9', ipad: '#93C5FD',
  android_smartphone: '#8DB82F', android_tablet: '#6EE7B7',
  desktop: '#E8BE0B', other: '#8A8A7E',
}
// Cores vizinhas precisam contrastar — laranja (#F3850C) ao lado do âmbar
// (#E8BE0B) tornava Reels FB e Stories FB indistinguíveis no gráfico
const PALETA = ['#5F8A3C', '#5C79C9', '#8DB82F', '#E8BE0B', '#9A86D6', '#22D3EE', '#D9805C', '#8A8A7E']

// A Meta usa a chave 'feed' compartilhada entre FB e IG (Reels/Stories já vêm
// separados por plataforma). Aqui isolamos: feed_facebook ≠ feed_instagram.
function chaveDe(r: PlacementDia, agrup: Agrup): string {
  if (agrup === 'plataforma') return r.plataforma
  if (agrup === 'posicao')    return r.posicao === 'feed' ? `feed_${r.plataforma}` : r.posicao
  if (agrup === 'so')         return r.so
  return r.dispositivo
}

// Chave sintética da linha-soma do Feed (FB+IG) — sempre exibida por último
const CHAVE_FEED_SOMA = '__feed_soma'

// Chave sem label conhecido vira texto legível ("threads_feed" → "Threads Feed")
function prettify(chave: string): string {
  return chave.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function labelDe(chave: string, agrup: Agrup): string {
  if (agrup === 'plataforma') return PLATAFORMA_LABEL[chave] ?? prettify(chave)
  if (agrup === 'posicao') {
    if (chave === CHAVE_FEED_SOMA) return 'Feed · FB+IG (soma)'
    if (chave === 'feed_facebook') return 'Feed · FB'
    if (chave === 'feed_instagram') return 'Feed · IG'
    if (chave.startsWith('feed_')) return `Feed · ${prettify(chave.slice(5))}`
    return POSICAO_LABEL[chave] ?? prettify(chave)
  }
  if (agrup === 'so')         return chave
  return DISPOSITIVO_LABEL[chave] ?? prettify(chave)
}

function corDe(chave: string, agrup: Agrup, idx: number): string {
  if (chave === CHAVE_FEED_SOMA) return '#9CA3AF'
  if (agrup === 'plataforma') return PLAT_COR[chave] ?? PALETA[idx % PALETA.length]
  if (agrup === 'so')         return SO_COR[chave] ?? PALETA[idx % PALETA.length]
  if (agrup === 'dispositivo') return DEV_COR[chave] ?? PALETA[idx % PALETA.length]
  return PALETA[idx % PALETA.length]
}

// ─── Semáforo (mesmo padrão estatístico das outras telas) ─────────────────────

interface Estat { media: number; dp: number }

function calcEstat(vals: number[]): Estat {
  const v = vals.filter(x => x > 0)
  if (!v.length) return { media: 0, dp: 0 }
  const media = v.reduce((s, x) => s + x, 0) / v.length
  const dp = Math.sqrt(v.reduce((s, x) => s + (x - media) ** 2, 0) / v.length)
  return { media, dp }
}

function corSemaforo(val: number, e: Estat, invertido?: boolean): string {
  if (e.dp === 0 || val === 0) return 'var(--color-text-primary)'
  const z = (val - e.media) / e.dp
  if (Math.abs(z) > 2) return 'var(--color-signal-yellow)'
  if (invertido) return val <= e.media ? 'var(--color-signal-green)' : 'var(--color-signal-red)'
  return val >= e.media ? 'var(--color-signal-green)' : 'var(--color-signal-red)'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtData(d: string) { return `${d.slice(8, 10)}/${d.slice(5, 7)}` }
function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function num(v: number) { return v.toLocaleString('pt-BR') }

// ─── Popup de métricas (single para gráficos, multi para colunas) ─────────────

function PopupMetricas({ metricas, modo, selecionadas, onPick, onFechar }: {
  metricas: MetricaDef[]
  modo: 'single' | 'multi'
  selecionadas: string[]
  onPick: (key: string) => void
  onFechar: () => void
}) {
  const [busca, setBusca] = useState('')
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return q ? metricas.filter(m => m.label.toLowerCase().includes(q)) : metricas
  }, [metricas, busca])
  const grupos = useMemo(() => [...new Set(filtradas.map(m => m.grupo))], [filtradas])

  return (
    <>
      <div onClick={onFechar} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
      <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50, width: '320px', maxHeight: '420px', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-md)', boxShadow: '0 16px 40px rgba(0,0,0,0.45)' }}>
        <div style={{ padding: '0.6rem 0.6rem 0.4rem' }}>
          <input
            autoFocus
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar métrica"
            style={{ width: '100%', height: '32px', padding: '0 0.6rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)', fontSize: '0.75rem', outline: 'none' }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 0.6rem 0.6rem' }}>
          {grupos.map(grupo => (
            <div key={grupo}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-muted)', margin: '0.55rem 0 0.3rem' }}>{grupo}</p>
              {filtradas.filter(m => m.grupo === grupo).map(m => {
                const ativa = selecionadas.includes(m.key)
                return (
                  <button
                    key={m.key}
                    onClick={() => { onPick(m.key); if (modo === 'single') onFechar() }}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '0.4rem 0.55rem', marginBottom: '2px', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', backgroundColor: ativa ? 'rgba(95,138,60,0.14)' : 'transparent', color: ativa ? 'var(--color-ponto-conversao)' : 'var(--color-text-secondary)', fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: ativa ? 700 : 400, textAlign: 'left' }}
                  >
                    {m.label}
                    {modo === 'multi' && <span style={{ fontSize: '0.7rem', opacity: ativa ? 1 : 0.25 }}>{ativa ? '✓' : '+'}</span>}
                  </button>
                )
              })}
            </div>
          ))}
          {filtradas.length === 0 && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.74rem', color: 'var(--color-text-muted)', padding: '0.6rem' }}>Nenhuma métrica encontrada</p>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Botão que abre o popup ───────────────────────────────────────────────────

function BotaoMetrica({ rotulo, valor, aberto, onAbrir, children }: {
  rotulo: string
  valor: string
  aberto: boolean
  onAbrir: () => void
  children: React.ReactNode
}) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={onAbrir}
        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.32rem 0.7rem', fontFamily: 'var(--font-body)', fontSize: '0.74rem', borderRadius: 'var(--radius-sm)', border: `1px solid ${aberto ? 'var(--color-ponto-conversao)' : 'var(--color-border-subtle)'}`, cursor: 'pointer', backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}
      >
        <span style={{ color: 'var(--color-text-muted)' }}>{rotulo}</span>
        <strong style={{ color: 'var(--color-ponto-conversao)', fontWeight: 700 }}>{valor}</strong>
        <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>▾</span>
      </button>
      {aberto && children}
    </span>
  )
}

// ─── Tooltip do gráfico de linha ──────────────────────────────────────────────

function LinhaTooltip({ active, payload, label, titulo, formatVal, labelPorChave }: {
  active?: boolean
  payload?: { dataKey?: string | number; value?: number; color?: string }[]
  label?: string
  titulo: string
  formatVal: (v: number) => string
  labelPorChave: Record<string, string>
}) {
  if (!active || !payload?.length) return null
  const ordenado = payload
    .filter(p => typeof p.value === 'number')
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  if (!ordenado.length) return null
  return (
    <div style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)', borderRadius: '8px', padding: '0.65rem 0.85rem', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-primary)', minWidth: '180px' }}>
      <p style={{ fontWeight: 700, marginBottom: '0.35rem' }}>{label} · {titulo}</p>
      {ordenado.map(p => (
        <div key={String(p.dataKey)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', paddingBlock: '0.1rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--color-text-muted)' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: p.color, flexShrink: 0 }} />
            {labelPorChave[String(p.dataKey)] ?? String(p.dataKey)}
          </span>
          <span style={{ fontWeight: 600 }}>{formatVal(p.value ?? 0)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── KPI mini ─────────────────────────────────────────────────────────────────

function KpiMini({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', padding: '0.85rem 1.05rem' }}>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.66rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>{label}</p>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>{value}</p>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

const COLS_PADRAO = ['investimento', 'impressoes', 'cpm', 'ctr', 'cliques', 'connectRate', 'pageView', 'taxaConversaoClique', 'compras', 'cac', 'valorGerado', 'roas']

// Colunas fixas da matriz de performance (visão por grupo)
const COLS_MATRIZ = ['investimento', 'cpm', 'ctr', 'connectRate', 'taxaConversaoClique', 'taxaConversao', 'compras', 'cac', 'roas']

export function AnalisePosicionamento({
  placements, campanhasAtivas = {}, de: deInicial, ate: ateInicial,
}: {
  placements: PlacementDia[]
  campanhasAtivas?: Record<string, boolean>
  de?: string
  ate?: string
}) {
  const router = useRouter()
  const [agrup, setAgrup]             = useState<Agrup>('plataforma')
  const [metricaKey, setMetricaKey]   = useState('investimento')
  const [modoLinha, setModoLinha]     = useState<'abs' | 'indice' | 'share'>('abs')
  const [suavizar, setSuavizar]       = useState(false)
  // Começa vazio de propósito: por padrão placement compara entrega inclusive
  // de campanhas pausadas. Mas se o usuário MARCAR "campanha ativa", filtra.
  const [filtroFunil, setFiltroFunil] = useState<FiltroState>(FILTRO_VAZIO)
  const [colsAtivas, setColsAtivas]   = useState<string[]>(COLS_PADRAO)
  const [popup, setPopup]             = useState<'metrica' | 'colunas' | null>(null)
  // Visibilidade das séries: padrão = só grupos relevantes (≥2% do investimento);
  // o usuário sobrepõe clicando no chip
  const [visOverride, setVisOverride] = useState<Record<string, boolean>>({})
  const [sortK, setSortK]             = useState('investimento')
  const [sortD, setSortD]             = useState<'desc' | 'asc'>('desc')
  const [de, setDe]                   = useState(deInicial ?? '')
  const [ate, setAte]                 = useState(ateInicial ?? '')
  const metricasBiblioteca = useMetricLibrary()

  useEffect(() => {
    if (!de || !ate || (de === deInicial && ate === ateInicial)) return
    const params = new URLSearchParams({ de, ate })
    router.push(`/dashboard/posicionamento?${params.toString()}`)
  }, [de, ate, deInicial, ateInicial, router])

  // Biblioteca completa: built-in + customizadas (escopo global ou posicionamento)
  const metricas = useMemo((): MetricaDef[] => {
    const custom = metricasBiblioteca
      .filter(m => m.scope === 'global' || m.scope === 'posicionamento')
      .map((m): MetricaDef => ({
        key: `custom:${m.id}`,
        label: m.name,
        grupo: m.group || 'Customizadas',
        formatRaw: v => formatMetricValue(v, m.format),
        getValue: row => evaluateFormula(m.formula, withFormulaAliases(row)) ?? 0,
        invertido: m.invertido,
      }))
    return [...METRICAS_BASE, ...custom]
  }, [metricasBiblioteca])

  const metrica = useMemo(
    () => metricas.find(m => m.key === metricaKey) ?? metricas[0],
    [metricas, metricaKey],
  )

  // Filtro inteligente aplicado na fonte: tudo abaixo (KPIs, gráfico, variação,
  // quadro, matriz, tabela) enxerga só as campanhas que passam no filtro.
  // "Campanha ativa" só filtra se o mapa de status chegou (o fetch pode degradar)
  const dados = useMemo(() => {
    if (!temFiltroAtivo(filtroFunil)) return placements
    const temStatus = Object.keys(campanhasAtivas).length > 0
    return placements.filter(r => passaFiltroNome(r.campanha, filtroFunil)
      && (!filtroFunil.ativoCampanha || !temStatus || campanhasAtivas[r.campanhaId] === true))
  }, [placements, filtroFunil, campanhasAtivas])

  const totalAgg = useMemo(() => agregar(dados), [dados])

  // ── Grupos (ranking + séries da linha) ──────────────────────────────────────
  const grupos = useMemo(() => {
    const porChave = new Map<string, PlacementDia[]>()
    for (const r of dados) {
      const k = chaveDe(r, agrup)
      if (!porChave.has(k)) porChave.set(k, [])
      porChave.get(k)!.push(r)
    }
    const lista = Array.from(porChave.entries())
      .map(([chave, rows]) => ({ chave, rows, agg: agregar(rows), agregado: false }))

    // Agrupando por posição, o Feed aparece isolado (FB e IG) e também como
    // linha-soma explícita — pedida sempre na ponta direita / fim das listas
    if (agrup === 'posicao') {
      const feedRows = dados.filter(r => r.posicao === 'feed')
      if (feedRows.length > 0) {
        lista.push({ chave: CHAVE_FEED_SOMA, rows: feedRows, agg: agregar(feedRows), agregado: true })
      }
    }

    return lista
      .sort((a, b) => Number(a.agregado) - Number(b.agregado) || b.agg.investimento - a.agg.investimento)
      .map((g, idx) => ({
        ...g,
        label: labelDe(g.chave, agrup),
        cor: corDe(g.chave, agrup, idx),
      }))
  }, [dados, agrup])

  const labelPorChave = useMemo(
    () => Object.fromEntries(grupos.map(g => [g.chave, g.label])),
    [grupos],
  )

  // ── Série temporal (agrega por semana se período > 60 dias) ─────────────────
  const dias = useMemo(() => [...new Set(dados.map(p => p.data))].sort(), [dados])
  const porSemana = dias.length > 60

  const seriePontos = useMemo(() => {
    if (!dias.length) return []
    const d0 = new Date(`${dias[0]}T12:00:00`).getTime()
    const bucketDe = (data: string) =>
      porSemana
        ? Math.floor((new Date(`${data}T12:00:00`).getTime() - d0) / (7 * 86_400_000))
        : dias.indexOf(data)

    // Rótulo de cada bucket = primeiro dia dele
    const inicioBucket = new Map<number, string>()
    for (const d of dias) {
      const b = bucketDe(d)
      const atual = inicioBucket.get(b)
      if (!atual || d < atual) inicioBucket.set(b, d)
    }
    const ids = [...inicioBucket.keys()].sort((a, b) => a - b)

    // Cada grupo contribui com as PRÓPRIAS linhas (g.rows) — isso inclui grupos
    // sintéticos como a linha-soma do Feed, que não existem em chaveDe()
    const porGrupoBucket = new Map<string, Map<number, PlacementDia[]>>()
    for (const g of grupos) {
      const m = new Map<number, PlacementDia[]>()
      for (const r of g.rows) {
        const b = bucketDe(r.data)
        if (!m.has(b)) m.set(b, [])
        m.get(b)!.push(r)
      }
      porGrupoBucket.set(g.chave, m)
    }

    return ids.map(b => {
      const ponto: Record<string, number | string | null> = { rotulo: fmtData(inicioBucket.get(b)!) }
      for (const g of grupos) {
        const rows = porGrupoBucket.get(g.chave)?.get(b)
        // Sem veiculação: aditivas valem 0 de verdade; razões (CPM, CTR...) não
        // têm observação — null vira gap na linha em vez de despencar pra zero
        ponto[g.chave] = rows ? metrica.getValue(agregar(rows)) : ADITIVAS.has(metrica.key) ? 0 : null
      }
      return ponto
    })
  }, [dias, porSemana, grupos, metrica])

  // Share % só faz sentido para métricas aditivas — cai para absoluto nas demais
  const modoEfetivo = modoLinha === 'share' && !ADITIVAS.has(metrica.key) ? 'abs' : modoLinha

  // Aplica o modo de visualização sobre a série absoluta:
  // - indice: cada grupo relativo ao próprio primeiro valor (base 100) — isola a
  //   tendência, como o gráfico de "percentage change" da análise pós-Andromeda
  // - share: participação do grupo no total do bucket (só métricas aditivas)
  const seriePlot = useMemo(() => {
    if (modoEfetivo === 'abs') return seriePontos

    if (modoEfetivo === 'share') {
      // A linha-soma fica fora do denominador (senão o Feed conta em dobro);
      // o share dela é calculado normalmente sobre o total real
      const reais = grupos.filter(g => !g.agregado)
      return seriePontos.map(p => {
        const total = reais.reduce((s, g) => s + ((p[g.chave] as number) || 0), 0)
        const novo: Record<string, number | string | null> = { rotulo: p.rotulo }
        for (const g of grupos) novo[g.chave] = total > 0 ? (((p[g.chave] as number) || 0) / total) * 100 : 0
        return novo
      })
    }

    // indice base 100: primeiro valor não-zero de cada grupo vira 100
    const base: Record<string, number> = {}
    for (const g of grupos) {
      for (const p of seriePontos) {
        const v = (p[g.chave] as number) || 0
        if (v > 0) { base[g.chave] = v; break }
      }
    }
    return seriePontos.map(p => {
      const novo: Record<string, number | string | null> = { rotulo: p.rotulo }
      for (const g of grupos) {
        const v = (p[g.chave] as number) || 0
        novo[g.chave] = base[g.chave] && v > 0 ? (v / base[g.chave]) * 100 : null
      }
      return novo
    })
  }, [seriePontos, modoEfetivo, grupos])

  // Média móvel de 7 buckets (janela para trás) — tira o ruído diário de
  // métricas como CPM em grupos com pouco volume
  // No modo semanal a suavização desliga: 7 buckets = 7 SEMANAS (~49 dias) de
  // média invisível — o botão nem aparece nesse modo, o estado não pode agir.
  const serieFinal = useMemo(() => {
    if (!suavizar || porSemana) return seriePlot
    const JANELA = 7
    return seriePlot.map((p, i) => {
      const novo: Record<string, number | string | null> = { rotulo: p.rotulo }
      for (const g of grupos) {
        const vals: number[] = []
        for (let j = Math.max(0, i - JANELA + 1); j <= i; j++) {
          const v = seriePlot[j][g.chave]
          if (typeof v === 'number') vals.push(v)
        }
        novo[g.chave] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
      }
      return novo
    })
  }, [seriePlot, suavizar, porSemana, grupos])

  // Aditivas em absoluto partem do zero (magnitude importa); razões (CPM, ROAS...)
  // e índice ajustam o eixo ao intervalo dos dados — senão a evolução fica achatada
  const dominioY: [number | string, number | string] =
    modoEfetivo === 'abs' && ADITIVAS.has(metrica.key) ? [0, 'auto'] : ['auto', 'auto']

  const formatLinha = (v: number) =>
    modoEfetivo === 'share' ? `${v.toFixed(1)}%` :
    modoEfetivo === 'indice' ? v.toFixed(0) :
    metrica.formatRaw(v)

  const tituloLinha =
    modoEfetivo === 'share' ? `${metrica.label} (% do total)` :
    modoEfetivo === 'indice' ? `${metrica.label} (índice, início = 100)` :
    metrica.label

  const limiarVolume = totalAgg.investimento * 0.02
  const serieVisivel = (g: { chave: string; agg: Record<string, number> }) =>
    visOverride[g.chave] ?? g.agg.investimento >= limiarVolume
  const seriesVisiveis = grupos.filter(serieVisivel)

  // ── Variação no período: 1ª metade × 2ª metade (na métrica selecionada) ─────
  const variacao = useMemo(() => {
    if (dias.length < 4) return null
    const meio = Math.ceil(dias.length / 2)
    const diasH1 = new Set(dias.slice(0, meio))

    const linhas = grupos.map(g => {
      const v1 = metrica.getValue(agregar(g.rows.filter(r => diasH1.has(r.data))))
      const v2 = metrica.getValue(agregar(g.rows.filter(r => !diasH1.has(r.data))))
      // Aditiva que colapsou a zero na 2ª metade é Δ −100%, não '—' (o quadro ao
      // lado mostra a queda; o card não pode contradizê-lo). Razão com v2=0 segue
      // '—': é "não calculável" (div protegida), não zero real.
      const podeDelta = v1 > 0 && (v2 > 0 || ADITIVAS.has(metrica.key))
      return { ...g, v1, v2, delta: podeDelta ? ((v2 - v1) / v1) * 100 : null }
    })

    return {
      rotuloH1: `${fmtData(dias[0])} – ${fmtData(dias[meio - 1])}`,
      rotuloH2: `${fmtData(dias[meio])} – ${fmtData(dias[dias.length - 1])}`,
      linhas,
    }
  }, [dias, grupos, metrica])

  // ── Tabela: combos plataforma × posição × dispositivo ───────────────────────
  const linhasTabela = useMemo(() => {
    const porCombo = new Map<string, PlacementDia[]>()
    for (const r of dados) {
      const k = `${r.plataforma}|${r.posicao}|${r.dispositivo}`
      if (!porCombo.has(k)) porCombo.set(k, [])
      porCombo.get(k)!.push(r)
    }
    return Array.from(porCombo.entries()).map(([k, rows]) => {
      const [plataforma, posicao, dispositivo] = k.split('|')
      return {
        chave: k,
        plataforma,
        label: [
          PLATAFORMA_LABEL[plataforma] ?? plataforma,
          POSICAO_LABEL[posicao] ?? posicao,
          DISPOSITIVO_LABEL[dispositivo] ?? dispositivo,
        ].join(' · '),
        agg: agregar(rows),
      }
    })
  }, [dados])

  const colsDef = useMemo(
    () => colsAtivas.map(k => metricas.find(m => m.key === k)).filter((m): m is MetricaDef => !!m),
    [colsAtivas, metricas],
  )

  const estats = useMemo(() => {
    const r: Record<string, Estat> = {}
    for (const c of colsDef) r[c.key] = calcEstat(linhasTabela.map(l => c.getValue(l.agg)))
    return r
  }, [colsDef, linhasTabela])

  const tabelaOrdenada = useMemo(() => {
    const def = metricas.find(m => m.key === sortK)
    if (!def) return linhasTabela
    return [...linhasTabela].sort((a, b) => {
      const va = def.getValue(a.agg); const vb = def.getValue(b.agg)
      return sortD === 'desc' ? vb - va : va - vb
    })
  }, [linhasTabela, metricas, sortK, sortD])

  // ── Quadro por período: grupos × semanas (ou meses, em períodos longos) ─────
  const quadro = useMemo(() => {
    if (dias.length < 8) return null
    const mensal = dias.length > 92
    const d0 = new Date(`${dias[0]}T12:00:00`).getTime()
    const idDe = (data: string) =>
      mensal ? data.slice(0, 7) : String(Math.floor((new Date(`${data}T12:00:00`).getTime() - d0) / (7 * 86_400_000)))

    const ids: string[] = []
    const inicioBucket: Record<string, string> = {}
    for (const d of dias) {
      const id = idDe(d)
      if (!(id in inicioBucket)) { ids.push(id); inicioBucket[id] = d }
    }

    const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
    const colunas = ids.map((id, i) => ({
      id,
      label: mensal ? `${MES[parseInt(id.slice(5, 7), 10) - 1]}/${id.slice(2, 4)}` : `Sem ${i + 1}`,
      sub: fmtData(inicioBucket[id]),
    }))

    const linhas = grupos.map(g => {
      const porBucket = new Map<string, PlacementDia[]>()
      for (const r of g.rows) {
        const id = idDe(r.data)
        if (!porBucket.has(id)) porBucket.set(id, [])
        porBucket.get(id)!.push(r)
      }
      const vals = ids.map(id => {
        const rows = porBucket.get(id)
        // Mesma política da série (lá em cima): aditivas valem 0 de verdade —
        // semana com gasto e 0 compras é COLAPSO visível, não célula vazia
        // (e o Δ passa a capturar a queda até zero)
        return rows ? metrica.getValue(agregar(rows)) : ADITIVAS.has(metrica.key) ? 0 : null
      })
      const naoNulos = vals.filter((v): v is number => v !== null)
      const delta = naoNulos.length >= 2 && naoNulos[0] > 0
        ? ((naoNulos[naoNulos.length - 1] - naoNulos[0]) / naoNulos[0]) * 100
        : null
      return { chave: g.chave, label: g.label, cor: g.cor, vals, estat: calcEstat(naoNulos), delta }
    })

    const porBucketConta = new Map<string, PlacementDia[]>()
    for (const r of dados) {
      const id = idDe(r.data)
      if (!porBucketConta.has(id)) porBucketConta.set(id, [])
      porBucketConta.get(id)!.push(r)
    }
    const totais = ids.map(id => {
      const rows = porBucketConta.get(id)
      // Mesma política das linhas: 0 aditivo é dado real, não ausência
      return rows ? metrica.getValue(agregar(rows)) : ADITIVAS.has(metrica.key) ? 0 : null
    })
    const totaisValidos = totais.filter((v): v is number => v !== null)
    const deltaConta = totaisValidos.length >= 2 && totaisValidos[0] > 0
      ? ((totaisValidos[totaisValidos.length - 1] - totaisValidos[0]) / totaisValidos[0]) * 100
      : null

    return { colunas, linhas, totais, deltaConta, mensal }
  }, [dias, grupos, dados, metrica])

  // ── Matriz de performance: grupos × métricas-chave do funil ─────────────────
  const colsMatriz = useMemo(
    () => COLS_MATRIZ.map(k => metricas.find(m => m.key === k)).filter((m): m is MetricaDef => !!m),
    [metricas],
  )

  const estatsMatriz = useMemo(() => {
    // A linha-soma não entra na média do semáforo (distorceria a referência)
    const reais = grupos.filter(g => !g.agregado)
    const r: Record<string, Estat> = {}
    for (const c of colsMatriz) r[c.key] = calcEstat(reais.map(g => c.getValue(g.agg)))
    return r
  }, [colsMatriz, grupos])

  function toggleCol(key: string) {
    setColsAtivas(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }
  function toggleSerie(g: { chave: string; agg: Record<string, number> }) {
    setVisOverride(prev => ({ ...prev, [g.chave]: !serieVisivel(g) }))
  }

  const AGRUPS: [Agrup, string][] = [
    ['plataforma', 'Plataforma'], ['posicao', 'Posição'], ['so', 'iOS / Android'], ['dispositivo', 'Dispositivo'],
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '2rem', minHeight: '100%' }}>

      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
            Posicionamento
          </h1>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Onde seu anúncio roda — plataforma, posição e dispositivo (iOS × Android)
          </p>
        </div>
        <SeletorPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} />
      </div>

      {/* KPIs do período */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.7rem' }}>
        <KpiMini label="Investimento" value={brl(totalAgg.investimento)} />
        <KpiMini label="Impressões"   value={num(totalAgg.impressoes)} />
        <KpiMini label="CTR"          value={totalAgg.ctr > 0 ? `${totalAgg.ctr.toFixed(2)}%` : '—'} />
        <KpiMini label="CPM"          value={totalAgg.cpm > 0 ? brl(totalAgg.cpm) : '—'} />
        <KpiMini label="Compras"      value={num(totalAgg.compras)} />
        <KpiMini label="ROAS"         value={totalAgg.roas > 0 ? `${totalAgg.roas.toFixed(2)}x` : '—'} />
        <KpiMini label="Seguidores"   value={num(totalAgg.seguidores)} />
      </div>

      {/* Controles compartilhados */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <FiltroFunil filtro={filtroFunil} onChange={setFiltroFunil} niveis={['campanha']} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'var(--font-body)', fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>
          <span style={{ marginRight: '0.15rem' }}>Agrupar:</span>
          {AGRUPS.map(([k, l]) => (
            <button key={k} onClick={() => { setAgrup(k); setVisOverride({}) }}
              style={{ padding: '0.32rem 0.7rem', fontFamily: 'var(--font-body)', fontSize: '0.74rem', borderRadius: 'var(--radius-sm)', border: '1px solid', borderColor: agrup === k ? 'var(--color-ponto-conversao)' : 'var(--color-border-subtle)', cursor: 'pointer', backgroundColor: agrup === k ? 'rgba(95,138,60,0.14)' : 'var(--color-bg-tertiary)', color: agrup === k ? 'var(--color-ponto-conversao)' : 'var(--color-text-secondary)', fontWeight: agrup === k ? 700 : 400 }}>
              {l}
            </button>
          ))}
        </div>
        <BotaoMetrica rotulo="Métrica" valor={metrica.label} aberto={popup === 'metrica'} onAbrir={() => setPopup(p => p === 'metrica' ? null : 'metrica')}>
          <PopupMetricas
            metricas={metricas}
            modo="single"
            selecionadas={[metrica.key]}
            onPick={setMetricaKey}
            onFechar={() => setPopup(null)}
          />
        </BotaoMetrica>
      </div>

      {dados.length === 0 ? (
        <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', padding: '4rem 2rem', textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-body)', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            {placements.length === 0 ? 'Sem dados de placement para o período selecionado' : 'Nenhuma campanha passa no filtro atual — ajuste o filtro inteligente'}
          </p>
        </div>
      ) : (
        <>
          {/* Evolução + Ranking lado a lado */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(280px, 1fr)', gap: '1.25rem', alignItems: 'stretch' }}>

            {/* Evolução no tempo */}
            <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-secondary)', margin: 0 }}>
                  Evolução — {tituloLinha}
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {porSemana && (
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.66rem', color: 'var(--color-text-muted)' }}>agregado por semana</span>
                  )}
                  {!porSemana && (
                    <button
                      onClick={() => setSuavizar(s => !s)}
                      title="Média móvel de 7 dias — tira o ruído diário e revela a tendência"
                      style={{ padding: '0.22rem 0.6rem', fontFamily: 'var(--font-body)', fontSize: '0.68rem', borderRadius: 'var(--radius-sm)', border: '1px solid', borderColor: suavizar ? 'var(--color-ponto-conversao)' : 'var(--color-border-subtle)', cursor: 'pointer', backgroundColor: suavizar ? 'rgba(95,138,60,0.14)' : 'var(--color-bg-tertiary)', color: suavizar ? 'var(--color-ponto-conversao)' : 'var(--color-text-secondary)', fontWeight: suavizar ? 700 : 400 }}>
                      Média 7d
                    </button>
                  )}
                  <div style={{ display: 'flex', gap: '2px', backgroundColor: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)', padding: '2px' }}>
                    {([['abs', 'Absoluto'], ['indice', 'Índice 100'], ['share', '% do total']] as ['abs' | 'indice' | 'share', string][]).map(([k, l]) => {
                      const desabilitado = k === 'share' && !ADITIVAS.has(metrica.key)
                      return (
                        <button key={k}
                          onClick={() => !desabilitado && setModoLinha(k)}
                          title={desabilitado ? 'Disponível só para métricas aditivas (ex.: investimento, compras)' : undefined}
                          style={{ padding: '0.22rem 0.55rem', fontFamily: 'var(--font-body)', fontSize: '0.68rem', borderRadius: '4px', border: 'none', cursor: desabilitado ? 'not-allowed' : 'pointer', backgroundColor: modoEfetivo === k ? 'var(--color-bg-card)' : 'transparent', color: desabilitado ? 'var(--color-text-muted)' : modoEfetivo === k ? 'var(--color-ponto-conversao)' : 'var(--color-text-secondary)', fontWeight: modoEfetivo === k ? 700 : 400, opacity: desabilitado ? 0.4 : 1 }}>
                          {l}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Chips de série (clique para ocultar/mostrar) */}
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                {grupos.map(g => {
                  const oculta = !serieVisivel(g)
                  const baixoVolume = g.agg.investimento < limiarVolume
                  return (
                    <button key={g.chave} onClick={() => toggleSerie(g)}
                      title={baixoVolume ? 'Volume baixo (<2% do investimento) — métricas pouco confiáveis' : undefined}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.55rem', fontFamily: 'var(--font-body)', fontSize: '0.7rem', borderRadius: '999px', border: '1px solid var(--color-border-subtle)', cursor: 'pointer', backgroundColor: oculta ? 'transparent' : 'var(--color-bg-tertiary)', color: oculta ? 'var(--color-text-muted)' : 'var(--color-text-secondary)', opacity: oculta ? 0.45 : 1 }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: g.cor }} />
                      {g.label}{baixoVolume ? ' ·' : ''}
                    </button>
                  )
                })}
              </div>

              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={serieFinal} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(28,28,26,0.05)" vertical={false} />
                  <XAxis
                    dataKey="rotulo"
                    tick={{ fill: 'var(--color-text-muted)', fontFamily: 'var(--font-body)', fontSize: 11 }}
                    tickLine={false} axisLine={{ stroke: 'var(--color-border-subtle)' }}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fill: 'var(--color-text-muted)', fontFamily: 'var(--font-body)', fontSize: 11 }}
                    tickLine={false} axisLine={false} width={64}
                    tickFormatter={v => { const s = formatLinha(v as number); return s.length > 10 && Math.abs(v as number) >= 1000 ? `${Math.round((v as number) / 1000)}k` : s }}
                    domain={dominioY}
                  />
                  {modoEfetivo === 'indice' && (
                    <ReferenceLine y={100} stroke="rgba(28,28,26,0.3)" strokeDasharray="4 4" />
                  )}
                  <Tooltip content={<LinhaTooltip titulo={tituloLinha} formatVal={formatLinha} labelPorChave={labelPorChave} />} cursor={{ stroke: 'rgba(28,28,26,0.2)' }} />
                  {seriesVisiveis.map(g => (
                    <Line
                      key={g.chave}
                      type="monotone"
                      dataKey={g.chave}
                      stroke={g.cor}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3.5 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Variação no período: o teste do efeito Andromeda */}
            <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', minWidth: 0 }}>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-secondary)', margin: 0 }}>
                Variação — {metrica.label}
              </h2>
              {variacao ? (
                <>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.66rem', color: 'var(--color-text-muted)', margin: '0.25rem 0 1rem' }}>
                    1ª metade ({variacao.rotuloH1}) → 2ª metade ({variacao.rotuloH2})
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                    {[...variacao.linhas].sort((a, b) => Number(a.agregado) - Number(b.agregado) || (b.delta ?? -Infinity) - (a.delta ?? -Infinity)).map(g => {
                      const melhora = g.delta !== null && (metrica.invertido ? g.delta < 0 : g.delta > 0)
                      const estavel = g.delta !== null && Math.abs(g.delta) < 1
                      const corDelta = g.delta === null ? 'var(--color-text-muted)' : estavel ? 'var(--color-text-secondary)' : melhora ? 'var(--color-signal-green)' : 'var(--color-signal-red)'
                      return (
                        <div key={g.chave} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', padding: '0.45rem 0.55rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--color-bg-tertiary)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontFamily: 'var(--font-body)', fontSize: '0.76rem', color: 'var(--color-text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: g.cor, flexShrink: 0 }} />
                            {g.label}
                          </span>
                          <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', whiteSpace: 'nowrap' }}>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                              {g.v1 > 0 ? metrica.formatRaw(g.v1) : '—'} → {g.v2 > 0 ? metrica.formatRaw(g.v2) : '—'}
                            </span>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 800, color: corDelta, minWidth: '52px', textAlign: 'right' }}>
                              {g.delta === null ? '—' : `${g.delta > 0 ? '+' : ''}${g.delta.toFixed(1)}%`}
                            </span>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.64rem', color: 'var(--color-text-muted)', marginTop: '0.8rem', lineHeight: 1.5 }}>
                    Verde = melhora na métrica{metrica.invertido ? ' (queda, pois menor é melhor)' : ''}. Amplie o período para ver tendências longas.
                  </p>
                </>
              ) : (
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', color: 'var(--color-text-muted)', marginTop: '1rem' }}>
                  Período curto demais para comparar metades — selecione pelo menos 4 dias.
                </p>
              )}
            </div>
          </div>

          {/* Quadro por período: placements × semanas/meses — evolução em tabela */}
          {quadro && (
            <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
              <div style={{ padding: '0.9rem 1rem 0.7rem' }}>
                <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-secondary)', margin: 0 }}>
                  Quadro por período — {metrica.label}
                </h2>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.66rem', color: 'var(--color-text-muted)', margin: '0.25rem 0 0' }}>
                  Agregado por {quadro.mensal ? 'mês' : 'semana'} · cor compara a célula com a média da própria linha · Δ = último vs primeiro período
                </p>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border-default)' }}>
                      <th style={{ padding: '0.5rem 0.9rem', fontFamily: 'var(--font-body)', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>Posicionamento</th>
                      {quadro.colunas.map(c => (
                        <th key={c.id} style={{ padding: '0.4rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right', backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                          {c.label}
                          <span style={{ display: 'block', fontSize: '0.58rem', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{c.sub}</span>
                        </th>
                      ))}
                      <th style={{ padding: '0.5rem 0.9rem', fontFamily: 'var(--font-body)', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right', backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-ponto-conversao)', whiteSpace: 'nowrap' }}>Δ período</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quadro.linhas.map((l, i) => {
                      const melhora = l.delta !== null && (metrica.invertido ? l.delta < 0 : l.delta > 0)
                      const estavel = l.delta !== null && Math.abs(l.delta) < 1
                      return (
                        <tr key={l.chave} style={{ borderBottom: '1px solid var(--color-border-subtle)', backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(28,28,26,0.02)' }}>
                          <td style={{ padding: '0.5rem 0.9rem', fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: l.cor, flexShrink: 0 }} />
                              {l.label}
                            </div>
                          </td>
                          {l.vals.map((v, vi) => (
                            <td key={vi} style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 500, textAlign: 'right', whiteSpace: 'nowrap', color: v === null ? 'var(--color-text-muted)' : corSemaforo(v, l.estat, metrica.invertido) }}>
                              {v === null ? '—' : metrica.formatRaw(v)}
                            </td>
                          ))}
                          <td style={{ padding: '0.5rem 0.9rem', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 800, textAlign: 'right', whiteSpace: 'nowrap', color: l.delta === null ? 'var(--color-text-muted)' : estavel ? 'var(--color-text-secondary)' : melhora ? 'var(--color-signal-green)' : 'var(--color-signal-red)' }}>
                            {l.delta === null ? '—' : `${l.delta > 0 ? '+' : ''}${l.delta.toFixed(1)}%`}
                          </td>
                        </tr>
                      )
                    })}
                    <tr style={{ borderTop: '2px solid var(--color-border-default)', backgroundColor: 'var(--color-bg-tertiary)' }}>
                      <td style={{ padding: '0.55rem 0.9rem', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>CONTA</td>
                      {quadro.totais.map((v, vi) => (
                        <td key={vi} style={{ padding: '0.55rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--color-text-primary)' }}>
                          {v === null ? '—' : metrica.formatRaw(v)}
                        </td>
                      ))}
                      <td style={{ padding: '0.55rem 0.9rem', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 800, textAlign: 'right', whiteSpace: 'nowrap', color: quadro.deltaConta === null ? 'var(--color-text-muted)' : (metrica.invertido ? quadro.deltaConta < 0 : quadro.deltaConta > 0) ? 'var(--color-signal-green)' : 'var(--color-signal-red)' }}>
                        {quadro.deltaConta === null ? '—' : `${quadro.deltaConta > 0 ? '+' : ''}${quadro.deltaConta.toFixed(1)}%`}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Matriz de performance: a "relação" entre as métricas do funil por grupo */}
          <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '0.9rem 1rem 0.7rem' }}>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-secondary)', margin: 0 }}>
                Matriz de performance — {AGRUPS.find(([k]) => k === agrup)?.[1]}
              </h2>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.66rem', color: 'var(--color-text-muted)', margin: '0.25rem 0 0' }}>
                Verde/vermelho = acima/abaixo da média entre os grupos · amarelo = fora da curva
              </p>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border-default)' }}>
                    <th style={{ padding: '0.5rem 0.9rem', fontFamily: 'var(--font-body)', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>Grupo</th>
                    {colsMatriz.map(c => (
                      <th key={c.key} style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right', backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grupos.map((g, i) => (
                    <tr key={g.chave} style={{ borderBottom: '1px solid var(--color-border-subtle)', backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(28,28,26,0.02)' }}>
                      <td style={{ padding: '0.55rem 0.9rem', fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: g.cor, flexShrink: 0 }} />
                          {g.label}
                        </div>
                      </td>
                      {colsMatriz.map(c => {
                        const v = c.getValue(g.agg)
                        if (c.key === 'investimento') {
                          const share = totalAgg.investimento > 0 ? (v / totalAgg.investimento) * 100 : 0
                          return (
                            <td key={c.key} style={{ padding: '0.55rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.8rem', textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--color-text-primary)', fontWeight: 600 }}>
                              {c.formatRaw(v)}
                              <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: '0.4rem', fontSize: '0.68rem' }}>{share.toFixed(0)}%</span>
                            </td>
                          )
                        }
                        return (
                          <td key={c.key} style={{ padding: '0.55rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.8rem', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: corSemaforo(v, estatsMatriz[c.key] ?? { media: 0, dp: 0 }, c.invertido) }}>
                            {v !== 0 ? c.formatRaw(v) : '—'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--color-border-default)', backgroundColor: 'var(--color-bg-tertiary)' }}>
                    <td style={{ padding: '0.55rem 0.9rem', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>CONTA</td>
                    {colsMatriz.map(c => {
                      const v = c.getValue(totalAgg)
                      return (
                        <td key={c.key} style={{ padding: '0.55rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--color-text-primary)' }}>
                          {v !== 0 ? c.formatRaw(v) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Tabela detalhada */}
          <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.9rem 1rem 0.7rem' }}>
              <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-secondary)', margin: 0 }}>
                Detalhamento ({linhasTabela.length} placements)
              </h2>
              <BotaoMetrica rotulo="Colunas" valor={String(colsAtivas.length)} aberto={popup === 'colunas'} onAbrir={() => setPopup(p => p === 'colunas' ? null : 'colunas')}>
                <PopupMetricas
                  metricas={metricas}
                  modo="multi"
                  selecionadas={colsAtivas}
                  onPick={toggleCol}
                  onFechar={() => setPopup(null)}
                />
              </BotaoMetrica>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border-default)' }}>
                    <th style={{ padding: '0.5rem 0.9rem', fontFamily: 'var(--font-body)', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>Placement</th>
                    {colsDef.map(c => {
                      const ativo = sortK === c.key
                      return (
                        <th key={c.key}
                          onClick={() => { if (ativo) setSortD(d => d === 'desc' ? 'asc' : 'desc'); else { setSortK(c.key); setSortD('desc') } }}
                          style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right', backgroundColor: 'var(--color-bg-secondary)', cursor: 'pointer', userSelect: 'none', color: ativo ? 'var(--color-ponto-conversao)' : 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                          {c.label} {ativo ? (sortD === 'desc' ? '↓' : '↑') : <span style={{ opacity: 0.2, fontSize: '0.6rem' }}>↕</span>}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {tabelaOrdenada.map((l, i) => (
                    <tr key={l.chave} style={{ borderBottom: '1px solid var(--color-border-subtle)', backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(28,28,26,0.02)' }}>
                      <td style={{ padding: '0.5rem 0.9rem', fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: PLAT_COR[l.plataforma] ?? 'var(--color-text-muted)', flexShrink: 0 }} />
                          {l.label}
                        </div>
                      </td>
                      {colsDef.map(c => {
                        const v = c.getValue(l.agg)
                        return (
                          <td key={c.key} style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.8rem', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 500, color: corSemaforo(v, estats[c.key] ?? { media: 0, dp: 0 }, c.invertido) }}>
                            {v !== 0 ? c.formatRaw(v) : '—'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--color-border-default)', backgroundColor: 'var(--color-bg-tertiary)' }}>
                    <td style={{ padding: '0.55rem 0.9rem', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 800, color: 'var(--color-text-primary)' }}>TOTAL</td>
                    {colsDef.map(c => {
                      const v = c.getValue(totalAgg)
                      return (
                        <td key={c.key} style={{ padding: '0.55rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--color-text-primary)' }}>
                          {v !== 0 ? c.formatRaw(v) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
