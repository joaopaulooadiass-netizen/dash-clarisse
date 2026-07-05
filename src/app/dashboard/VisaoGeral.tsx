'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import { SeletorPeriodo } from '@/components/ui/SeletorPeriodo'
import { TabelaCampanhas } from '@/components/dashboard/TabelaCampanhas'
import type { CampanhaComMetricas, EstruturaCampanha, CampanhaMetricaDia } from '@/lib/meta/campanhas'
import { FiltroFunil, type FiltroState, FILTRO_PADRAO } from '@/components/dashboard/FiltroFunil'
import { getMetricByKey, getMetricLabel, getFunnelMetrics } from '@/lib/config/metrics'
import { derivarMetricas } from '@/lib/metrics/derivar'
// Fonte única BRT — a cópia local usava new Date().toISOString() (UTC): entre
// 21h e 23h59 de Brasília, maxData virava AMANHÃ e o calendário liberava data futura
import { hoje, subDias, difDias } from '@/lib/utils/data'

interface Props {
  campanhas: CampanhaComMetricas[]
  estrutura?: Record<string, EstruturaCampanha>
  metricasDiarias: CampanhaMetricaDia[]
  metaFalhou?: boolean // fetch da Meta falhou (rate limit) — zeros da tela não são dado real
  de?: string
  ate?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function brlFull(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
}
function num(v: number) { return v.toLocaleString('pt-BR') }
function pct(v: number) { return `${v.toFixed(2)}%` }
function fmt(data: string) { const [, m, d] = data.split('-'); return `${d}/${m}` }

function delta(atual: number, anterior: number): { txt: string; positivo: boolean } | null {
  if (!anterior) return null
  const v = ((atual - anterior) / anterior) * 100
  return { txt: `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`, positivo: v >= 0 }
}

// ─── KPI Banda ────────────────────────────────────────────────────────────────

type Sinal = 'bom' | 'ok' | 'ruim' | 'neutro'

const SINAL_COLOR: Record<Sinal, string> = {
  bom:    'var(--color-signal-green)',
  ok:     'var(--color-signal-yellow)',
  ruim:   'var(--color-signal-red)',
  neutro: 'transparent',
}

function KpiCard({
  label, valor, comparacao, sinal = 'neutro', inverteDelta = false, destaque = false,
}: {
  label: string
  valor: string
  comparacao?: { txt: string; positivo: boolean } | null
  sinal?: Sinal
  inverteDelta?: boolean
  destaque?: boolean
}) {
  const corDelta = comparacao
    ? (comparacao.positivo !== inverteDelta ? 'var(--color-signal-green)' : 'var(--color-signal-red)')
    : undefined

  return (
    <div style={{
      flex: 1,
      backgroundColor: destaque ? 'var(--color-green-soft)' : 'var(--color-bg-secondary)',
      borderRight: '1px solid rgba(28,28,26,0.06)',
      borderBottom: sinal !== 'neutro' ? `2px solid ${SINAL_COLOR[sinal]}` : '2px solid transparent',
      padding: '1rem 1.5rem',
      display: 'flex', flexDirection: 'column', gap: '0.3rem',
    }}>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>
        {label}
      </p>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '1.6rem', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1 }}>
        {valor}
      </p>
      {comparacao && (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 600, color: corDelta, marginTop: '0.1rem' }}>
          {comparacao.txt} <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>vs ant.</span>
        </p>
      )}
    </div>
  )
}

// ─── Funil ────────────────────────────────────────────────────────────────────
// As etapas vêm da biblioteca de métricas (escopo 'funil' em lib/config/metrics.ts):
// label, cor e leitura do valor são da biblioteca — nada de catálogo próprio aqui.
// Regra: taxa = métrica atual ÷ métrica anterior (automático)
// Nomes das taxas entre etapas:
//   cliques/impressoes       → CTR
//   pageView/cliques         → Connect Rate
//   inicioCheckout/pageView  → IC Rate
//   compras/inicioCheckout   → Taxa de Compra
//   qualquer/pageView        → Conv. da Página
//   qualquer/impressoes      → Conv. do Funil

const ETAPAS_FUNIL = getFunnelMetrics()
const FUNIL_PADRAO = ['impressoes', 'cliques', 'pageView', 'inicioCheckout', 'compras']
const FUNIL_STORAGE_KEY = 'cqv.funil-etapas.v1'
const COR_ETAPA_FALLBACK = '#8A8A7E'

const TAXA_LABEL: Record<string, Record<string, string>> = {
  cliques:        { impressoes: 'CTR' },
  pageView:       { cliques: 'Connect Rate' },
  inicioCheckout: { pageView: 'IC Rate' },
  compras:        { inicioCheckout: 'Taxa de Compra', pageView: 'Conv. da Página', cliques: 'Conv. do Funil' },
  leads:          { cliques: 'Taxa de Lead', pageView: 'Conv. da Página' },
  seguidores:     { cliques: 'Taxa Seguidor' },
}

function getTaxaLabel(atual: string, anterior: string): string {
  return TAXA_LABEL[atual]?.[anterior] ?? `${atual}/${anterior}`
}

// Label de métrica vinda da biblioteca — fonte única de nomenclatura (KPIs, funil)
function labelMetrica(key: string): string {
  const m = getMetricByKey(key)
  return m ? getMetricLabel(m) : key
}

function FunilLinha({ label, valor, taxa, taxaLabel, cor, topo, cpm, cpmVal, isLast }: {
  label: string; valor: number; taxa?: string; taxaLabel?: string
  cor: string; topo: number; cpm?: boolean; cpmVal?: number; isLast?: boolean
}) {
  // Largura em escala logarítmica relativa ao topo do funil (primeira etapa ativa).
  // Impressões é sempre ordens de grandeza maior que o resto — escala linear ou em raiz
  // deixa todo o resto achatado em ~0%, ilegível. Log comprime essa diferença de forma
  // que cada etapa fique visível e ainda proporcional (ex: 37mil → 64% → 7% → 0%),
  // mostrando o tamanho da queda sem apagar as etapas menores do mapa.
  const w = topo > 1 && valor > 0 ? (Math.log(valor + 1) / Math.log(topo + 1)) * 100 : 0
  return (
    <div style={{ paddingBottom: isLast ? 0 : '0.6rem', borderBottom: isLast ? 'none' : '1px solid rgba(28,28,26,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ flex: '0 0 130px', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{label}</div>
        <div style={{ flex: 1, height: '6px', backgroundColor: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-pill)', minWidth: 0 }}>
          <div style={{ height: '100%', width: `${w}%`, backgroundColor: cor, borderRadius: 'var(--radius-pill)' }} />
        </div>
        <div style={{ flex: '0 0 72px', textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '0.84rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
          {num(valor)}
        </div>
        <div style={{ flex: '0 0 100px', textAlign: 'right' }}>
          {taxa && (
            <>
              {taxaLabel && <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.58rem', color: 'var(--color-text-muted)', lineHeight: 1.2 }}>{taxaLabel}</div>}
              <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 700, color: 'var(--color-text-secondary)' }}>{taxa}</div>
            </>
          )}
        </div>
      </div>
      {cpm && cpmVal !== undefined && cpmVal > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-tertiary)', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-pill)' }}>
            CPM {brl(cpmVal)}
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Gráfico Card (seletor de métricas) ──────────────────────────────────────

// A série amarela plota COMPRAS puras (ACTION_COMPRA) — não o "Resultado"
// dinâmico da tabela de campanhas (evento que cada conjunto otimiza). Rótulos
// diferentes de propósito: mesmo nome com dois significados confundia a leitura.
const METRICAS_GRAFICO = [
  { metricKey: 'investimento', key: 'Investimento', label: 'Investimento', cor: '#5C79C9', eixo: 'R$' },
  { metricKey: 'receita',      key: 'Receita',      label: 'Receita',      cor: '#5F8A3C', eixo: 'R$' },
  { metricKey: 'compras',      key: 'Compras',      label: 'Compras',      cor: '#E8BE0B', eixo: 'n'  },
]

type MetricaGraficoKey = typeof METRICAS_GRAFICO[number]['key']

function GraficoCard({ dias, dados }: { dias: number; dados: Record<string, number | string>[] }) {
  const [ativas, setAtivas] = useState<Set<MetricaGraficoKey>>(new Set(['Investimento', 'Receita']))

  function toggle(k: MetricaGraficoKey) {
    setAtivas(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }

  const gradients: Record<MetricaGraficoKey, string> = { Investimento: '#5C79C9', Receita: '#5F8A3C', Compras: '#E8BE0B' }

  return (
    <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-secondary)', letterSpacing: '0.08em' }}>
          GRAFICO — {dias}d
        </p>
        {/* Toggles de métricas */}
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {METRICAS_GRAFICO.map(m => (
            <button key={m.key} onClick={() => toggle(m.key)} style={{
              display: 'flex', alignItems: 'center', gap: '0.3rem',
              padding: '0.2rem 0.55rem',
              fontFamily: 'var(--font-body)', fontSize: '0.72rem',
              border: `1px solid ${ativas.has(m.key) ? m.cor : 'var(--color-border-subtle)'}`,
              borderRadius: 'var(--radius-pill)', cursor: 'pointer',
              backgroundColor: ativas.has(m.key) ? `${m.cor}20` : 'transparent',
              color: ativas.has(m.key) ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: ativas.has(m.key) ? m.cor : 'var(--color-text-muted)' }} />
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={dados} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            {METRICAS_GRAFICO.map(m => (
              <linearGradient key={m.key} id={`grad${m.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={m.cor} stopOpacity={0.2} />
                <stop offset="95%" stopColor={m.cor} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(28,28,26,0.04)" />
          <XAxis dataKey="data" tick={{ fontFamily: 'var(--font-body)', fontSize: 10, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          {/* Eixo esquerdo — R$ (Investimento, Receita) */}
          <YAxis yAxisId="brl" tick={{ fontFamily: 'var(--font-body)', fontSize: 10, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} width={55} tickFormatter={v => { const n = v as number; return n >= 1000 ? `R$${(n/1000).toFixed(0)}k` : `R$${Math.round(n)}` }} />
          {/* Eixo direito — unidades (Resultado) */}
          <YAxis yAxisId="n" orientation="right" tick={{ fontFamily: 'var(--font-body)', fontSize: 10, fill: '#E8BE0B' }} axisLine={false} tickLine={false} width={30} />
          <Tooltip
            contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)', borderRadius: '8px', fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--color-text-primary)' }}
            formatter={(v, name) => name === 'Compras' ? [Number(v), name] : [brlFull(Number(v)), name]}
          />
          {METRICAS_GRAFICO.filter(m => ativas.has(m.key)).map(m => (
            <Area key={m.key} yAxisId={m.eixo === 'n' ? 'n' : 'brl'} type="monotone" dataKey={m.key} stroke={gradients[m.key]} strokeWidth={2} fill={`url(#grad${m.key})`} dot={false} activeDot={{ r: 3 }} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Funil Card ───────────────────────────────────────────────────────────────

function FunilCard({
  dias, totalImp, totalCliq, totalPV, totalLeads, totalChk, totalVendas, totalSeg, cpm,
}: {
  dias: number; totalImp: number; totalCliq: number; totalPV: number; totalLeads: number
  totalChk: number; totalVendas: number; totalSeg: number; cpm: number
}) {
  const [ativas, setAtivas] = useState(FUNIL_PADRAO)
  const [config, setConfig] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  // Etapas e ordem persistem no navegador (mesmo padrão cqv.*.v1 das outras telas)
  useEffect(() => {
    try {
      const salvo = localStorage.getItem(FUNIL_STORAGE_KEY)
      if (!salvo) return
      const ids = (JSON.parse(salvo) as string[]).filter(id => ETAPAS_FUNIL.some(m => m.key === id))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (ids.length > 0) setAtivas(ids)
    } catch { /* estado padrão */ }
  }, [])

  function persistir(novas: string[]) {
    setAtivas(novas)
    try { localStorage.setItem(FUNIL_STORAGE_KEY, JSON.stringify(novas)) } catch { /* sem storage */ }
  }

  // Linha de totais lida pelos getValue da biblioteca — cada etapa busca seu valor
  const linhaTotais: Record<string, number> = {
    impressoes:     totalImp,
    cliques:        totalCliq,
    pageView:       totalPV,     // landing_page_view real da Meta
    inicioCheckout: totalChk,
    compras:        totalVendas,
    leads:          totalLeads,
    seguidores:     totalSeg,
  }
  const VALS: Record<string, number> = Object.fromEntries(ETAPAS_FUNIL.map(m => [m.key, m.getValue(linhaTotais)]))

  function removeEtapa(id: string) { persistir(ativas.filter(e => e !== id)) }
  function addEtapa(id: string) { persistir([...ativas, id]) }
  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return
    const arr = [...ativas]
    const from = arr.indexOf(dragId); const to = arr.indexOf(targetId)
    arr.splice(from, 1); arr.splice(to, 0, dragId)
    persistir(arr)
    setDragId(null); setDragOver(null)
  }

  // Calcular resumo: conv. da página (última/pageView) e conv. do funil (última/cliques)
  const ultima = ativas[ativas.length - 1]
  const ultimaVal = VALS[ultima] ?? 0
  const pvIdx = ativas.indexOf('pageView')
  const pvVal = pvIdx >= 0 ? VALS['pageView'] : 0
  const convPagina = pvVal > 0 ? (ultimaVal / pvVal) * 100 : 0
  const convFunil  = totalCliq > 0 ? (ultimaVal / totalCliq) * 100 : 0
  const hasPV = ativas.includes('pageView')

  const disponiveis = ETAPAS_FUNIL.filter(m => !ativas.includes(m.key))

  return (
    <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-secondary)', letterSpacing: '0.08em' }}>FUNIL — {dias}d</p>
        <button onClick={() => setConfig(!config)} style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: config ? 'white' : 'var(--color-text-muted)', backgroundColor: config ? 'var(--color-ponto-conversao)' : 'transparent', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', padding: '0.22rem 0.55rem', cursor: 'pointer' }}>
          ⚙ Editar funil
        </button>
      </div>

      {/* Painel de edição */}
      {config && (
        <div style={{ backgroundColor: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Ordem das etapas — arraste para reordenar</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {ativas.map(id => {
              const met = ETAPAS_FUNIL.find(m => m.key === id)!
              return (
                <div key={id} draggable
                  onDragStart={() => setDragId(id)}
                  onDragOver={e => { e.preventDefault(); setDragOver(id) }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={() => onDrop(id)}
                  onDragEnd={() => { setDragId(null); setDragOver(null) }}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0.5rem', backgroundColor: dragOver === id ? 'rgba(95,138,60,0.1)' : 'var(--color-bg-card)', border: `1px solid ${dragOver === id ? 'var(--color-ponto-conversao)' : 'var(--color-border-subtle)'}`, borderRadius: 'var(--radius-sm)', cursor: 'grab', opacity: dragId === id ? 0.4 : 1 }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem', userSelect: 'none' }}>⠿</span>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: met.cor ?? COR_ETAPA_FALLBACK, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--color-text-primary)', flex: 1 }}>{getMetricLabel(met, 'funil')}</span>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                    {num(VALS[id] ?? 0)}
                  </span>
                  <button onClick={() => removeEtapa(id)} style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                </div>
              )
            })}
          </div>
          {disponiveis.length > 0 && (
            <>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Adicionar etapa</p>
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                {disponiveis.map(m => {
                  const cor = m.cor ?? COR_ETAPA_FALLBACK
                  return (
                    <button key={m.key} onClick={() => addEtapa(m.key)}
                      style={{ padding: '0.2rem 0.55rem', fontFamily: 'var(--font-body)', fontSize: '0.72rem', cursor: 'pointer', border: `1px solid ${cor}`, borderRadius: 'var(--radius-pill)', backgroundColor: `${cor}18`, color: 'var(--color-text-secondary)' }}>
                      + {getMetricLabel(m, 'funil')}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Linhas — taxa auto calculada entre etapas consecutivas, barra dimensionada
          pelo volume de cada etapa relativo ao topo do funil (primeira etapa ativa) */}
      {ativas.map((id, i) => {
        const met = ETAPAS_FUNIL.find(m => m.key === id)!
        const valor = VALS[id] ?? 0
        const ant = i > 0 ? ativas[i - 1] : null
        const antVal = ant ? (VALS[ant] ?? 0) : 0
        const taxa = ant && antVal > 0 ? pct((valor / antVal) * 100) : undefined
        const taxaLabel = ant ? getTaxaLabel(id, ant) : undefined
        const mostraCpm = id === 'impressoes'  // CPM acompanha a etapa de impressões
        return (
          <FunilLinha key={id} label={getMetricLabel(met, 'funil')} valor={valor}
            taxa={taxa} taxaLabel={taxaLabel}
            cor={met.cor ?? COR_ETAPA_FALLBACK} topo={VALS[ativas[0]] ?? 0}
            cpm={mostraCpm} cpmVal={mostraCpm ? cpm : undefined}
            isLast={i === ativas.length - 1}
          />
        )
      })}

      {/* Resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', paddingTop: '0.25rem', borderTop: '1px solid rgba(28,28,26,0.06)' }}>
        {/* Se Page View É a última etapa, "Conv. da Página" seria PV÷PV = 100% (sem sentido) */}
        {hasPV && ultima !== 'pageView' && (
          <div style={{ padding: '0.5rem 0.65rem', backgroundColor: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: 'var(--color-text-muted)', marginBottom: '2px' }}>Conv. da Página</p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-signal-green)' }}>{pct(convPagina)}</p>
          </div>
        )}
        <div style={{ padding: '0.5rem 0.65rem', backgroundColor: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: 'var(--color-text-muted)', marginBottom: '2px' }}>Conv. do Funil</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-signal-green)' }}>{pct(convFunil)}</p>
        </div>
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function VisaoGeral({ campanhas, estrutura, metricasDiarias, metaFalhou = false, de: deInicial, ate: ateInicial }: Props) {
  const router = useRouter()
  const minData = subDias(364)
  const maxData = hoje()

  const [de,  setDe]            = useState(deInicial ?? subDias(6))
  const [ate, setAte]           = useState(ateInicial ?? hoje())
  const [filtro, setFiltro]     = useState<FiltroState>(FILTRO_PADRAO)
  const [filtroTemp, setFiltroTemp] = useState('todas')

  // Mudou o período → atualiza a URL, o que dispara um novo fetch no servidor
  // (a página é force-dynamic e busca as métricas de campanha direto na Graph API com o intervalo escolhido).
  useEffect(() => {
    if (!de || !ate || (de === deInicial && ate === ateInicial)) return
    const params = new URLSearchParams({ de, ate })
    router.push(`/dashboard?${params.toString()}`)
  }, [de, ate, deInicial, ateInicial, router])

  const dias = difDias(de, ate) + 1

  // Período anterior: mesma QUANTIDADE de dias imediatamente antes do início.
  // Ex.: atual 01→07/06 (7d) → anterior 25→31/05 (7d). A versão antiga subtraía
  // a partir do `ate` e produzia ~2× dias, fabricando quedas nos deltas dos KPIs.
  const deAnt  = subDias(dias, de)
  const ateAnt = subDias(1, de)

  // Campanhas filtradas (métricas reais, já calculadas no servidor para o período selecionado).
  // Esse mesmo recorte de campanhas é a base de tudo: KPIs, funil, gráfico,
  // temperatura e tabela — o filtro inteligente afeta a tela inteira.
  // Dois recortes: a TABELA corta "teve veiculação" (impressões do período ATUAL);
  // a base do "vs ant." não pode usar esse corte — campanha pausada agora, com
  // gasto real na janela anterior, sumia da comparação e inflava os deltas.
  const { campMetricas, idsComparacao } = useMemo(() => {
    const passa = (c: CampanhaComMetricas, exigirVeiculacao: boolean): boolean => {
      const nome = c.nome.toUpperCase()

      // Temperatura
      if (filtroTemp !== 'todas' && c.temperatura !== filtroTemp) return false

      // Corredor polonês: C1, C2, C3 no nome
      if (filtro.corredor.length > 0 && !filtro.corredor.some(tag => nome.includes(`[${tag}]`))) return false

      // Objetivo: VENDAS, LEADS, CPT no nome
      if (filtro.objetivo.length > 0 && !filtro.objetivo.some(tag => nome.includes(`[${tag}]`))) return false

      // Status
      if (filtro.ativoCampanha && !c.ativa) return false
      if (exigirVeiculacao && filtro.teveVeiculacao && !(c.impressoes > 0)) return false

      // Conjunto/anúncio ativo: a campanha precisa ter ≥1 ativo na estrutura.
      // Só filtra se a estrutura chegou (o fetch pode degradar para vazio).
      const temEstrutura = estrutura && Object.keys(estrutura).length > 0
      if (temEstrutura && filtro.ativoConjunto && !estrutura[c.id]?.conjuntos.some(cj => cj.ativo)) return false
      if (temEstrutura && filtro.ativoAnuncio && !estrutura[c.id]?.anuncios.some(an => an.ativo)) return false

      // Personalizado
      if (filtro.exatamente) return nome === filtro.exatamente.toUpperCase()
      if (filtro.contem && !nome.includes(filtro.contem.toUpperCase())) return false
      if (filtro.naoContem && nome.includes(filtro.naoContem.toUpperCase())) return false

      return true
    }
    return {
      campMetricas: campanhas.filter(c => passa(c, true)),
      idsComparacao: new Set(campanhas.filter(c => passa(c, false)).map(c => c.id)),
    }
  }, [campanhas, filtroTemp, filtro, estrutura])

  const diariasFiltradas = useMemo(
    () => metricasDiarias.filter(d => idsComparacao.has(d.campanhaId)),
    [metricasDiarias, idsComparacao],
  )

  const slice    = useMemo(() => diariasFiltradas.filter(d => d.data >= de && d.data <= ate), [diariasFiltradas, de, ate])
  const sliceAnt = useMemo(() => diariasFiltradas.filter(d => d.data >= deAnt && d.data <= ateAnt), [diariasFiltradas, deAnt, ateAnt])

  // Período atual
  const totalInv     = slice.reduce((s, d) => s + d.gasto, 0)
  const totalReceita = slice.reduce((s, d) => s + d.receita, 0)
  const totalVendas  = slice.reduce((s, d) => s + d.vendas, 0)
  const totalImp     = slice.reduce((s, d) => s + d.impressoes, 0)
  const totalCliq    = slice.reduce((s, d) => s + d.cliques, 0)
  const totalPV      = slice.reduce((s, d) => s + d.sessoes, 0)
  const totalLeads   = slice.reduce((s, d) => s + d.leads, 0)
  const totalChk     = slice.reduce((s, d) => s + d.checkout, 0)
  const totalSeg     = slice.reduce((s, d) => s + d.seguidores, 0)
  // Derivadas da fonte única — mesma fórmula de todas as telas (lib/metrics/derivar.ts)
  const { roas, cac, ctr, ticketMedio, cpm } = derivarMetricas({
    gasto: totalInv, impressoes: totalImp, cliques: totalCliq,
    compras: totalVendas, valorGerado: totalReceita,
    pageView: totalPV, leads: totalLeads, inicioCheckout: totalChk, seguidores: totalSeg,
  })

  // Período anterior (para comparação)
  const invAnt      = sliceAnt.reduce((s, d) => s + d.gasto, 0)
  const vendasAnt   = sliceAnt.reduce((s, d) => s + d.vendas, 0)
  const receitaAnt  = sliceAnt.reduce((s, d) => s + d.receita, 0)
  const impAnt      = sliceAnt.reduce((s, d) => s + d.impressoes, 0)
  const cliqAnt     = sliceAnt.reduce((s, d) => s + d.cliques, 0)
  const { roas: roasAnt, cac: cacAnt, ctr: ctrAnt, ticketMedio: ticketMedioAnt } = derivarMetricas({
    gasto: invAnt, impressoes: impAnt, cliques: cliqAnt, compras: vendasAnt, valorGerado: receitaAnt,
  })

  // Donut temperatura — calculado sobre o mesmo recorte filtrado
  const tempData = [
    { name: 'Frio',   value: campMetricas.filter(c => c.temperatura === 'fundo').length,  color: '#5C79C9' },
    { name: 'Quente', value: campMetricas.filter(c => c.temperatura === 'quente').length, color: '#E8BE0B' },
    { name: 'Não Identificado', value: campMetricas.filter(c => c.temperatura === 'neutro').length, color: '#6E6E66' },
  ]
  const totalTemp = tempData.reduce((s, t) => s + t.value, 0)

  // Gráfico — agrega por dia as métricas das campanhas filtradas
  const dadosGrafico = useMemo(() => {
    const porDia = new Map<string, { gasto: number; receita: number; vendas: number }>()
    for (const d of slice) {
      const acc = porDia.get(d.data) ?? { gasto: 0, receita: 0, vendas: 0 }
      acc.gasto   += d.gasto
      acc.receita += d.receita
      acc.vendas  += d.vendas
      porDia.set(d.data, acc)
    }
    return Array.from(porDia.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([data, v]) => ({
        data: fmt(data),
        // Sem Math.round: o tooltip mostra o valor exato do dia (centavos reais)
        'Investimento': v.gasto,
        'Receita':      v.receita,
        'Compras':      v.vendas,
      }))
  }, [slice])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-bg-primary)', minHeight: '100%' }}>

      {/* Falha da Meta ≠ conta sem gasto: sem o aviso, os KPIs zerados pareciam dado real */}
      {metaFalhou && (
        <div style={{ margin: '1.25rem 2rem 0', padding: '0.7rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(224,57,47,0.45)', backgroundColor: 'rgba(224,57,47,0.08)', fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: '#B3372A', fontWeight: 600 }}>
          ⚠ Dados da Meta indisponíveis agora (provável rate limit). Os números abaixo estão incompletos — recarregue em alguns minutos.
        </div>
      )}

      {/* ── Header + período ──────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 2rem 0', gap: '1rem' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '0.03em' }}>
          VISAO GERAL
        </h1>

        <SeletorPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} atalhos={[7, 14, 30, 90]} minData={minData} maxData={maxData} />
      </div>

      {/* ── KPIs ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(28,28,26,0.06)' }}>
        <KpiCard
          label={labelMetrica('investimento')} valor={brl(totalInv)}
          comparacao={delta(totalInv, invAnt)}
          sinal="neutro" destaque
        />
        <KpiCard
          label={labelMetrica('valorGerado')} valor={brl(totalReceita)}
          comparacao={delta(totalReceita, receitaAnt)}
          sinal="neutro"
        />
        <KpiCard
          label={labelMetrica('roas')} valor={`${roas.toFixed(2)}x`}
          comparacao={delta(roas, roasAnt)}
          sinal="neutro"
        />
        <KpiCard
          label={labelMetrica('compras')} valor={num(totalVendas)}
          comparacao={delta(totalVendas, vendasAnt)}
          sinal="neutro"
        />
        <KpiCard
          label={labelMetrica('cac')} valor={cac > 0 ? brl(cac) : '—'}
          comparacao={cac > 0 && cacAnt > 0 ? delta(cac, cacAnt) : null}
          sinal="neutro"
          inverteDelta
        />
        <KpiCard
          label={labelMetrica('ctr')} valor={pct(ctr)}
          comparacao={delta(ctr, ctrAnt)}
          sinal="neutro"
        />
        <KpiCard
          label={labelMetrica('ticketMedio')} valor={ticketMedio > 0 ? brl(ticketMedio) : '—'}
          comparacao={ticketMedio > 0 && ticketMedioAnt > 0 ? delta(ticketMedio, ticketMedioAnt) : null}
          sinal="neutro"
        />
      </div>

      {/* ── Filtros ───────────────────────────────────────────────── */}
      <div style={{ padding: '1.25rem 2rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <FiltroFunil filtro={filtro} onChange={setFiltro} isAdmin />
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={filtroTemp} onChange={e => setFiltroTemp(e.target.value)} style={{
            backgroundColor: 'var(--color-bg-card)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-body)', fontSize: '0.78rem',
            padding: '0.38rem 0.7rem', outline: 'none', cursor: 'pointer',
          }}>
            <option value="todas">Temperatura: Todas</option>
            <option value="fundo">Frio</option>
            <option value="quente">Quente</option>
            <option value="neutro">Não Identificado</option>
          </select>
        </div>
      </div>

      {/* ── Funil (esquerda) + Gráfico/Temperatura (direita empilhados) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', padding: '0 2rem 1.5rem', alignItems: 'stretch' }}>

        {/* FUNIL */}
        <FunilCard
          dias={dias}
          totalImp={totalImp}
          totalCliq={totalCliq}
          totalPV={totalPV}
          totalLeads={totalLeads}
          totalChk={totalChk}
          totalVendas={totalVendas}
          totalSeg={totalSeg}
          cpm={cpm}
        />

        {/* Direita: Gráfico + Temperatura empilhados */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>

          {/* Gráfico com seletor de métricas */}
          <div style={{ flex: 1 }}><GraficoCard dias={dias} dados={dadosGrafico} /></div>

          {/* Temperatura */}
          <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
            <div style={{ flex: '0 0 120px' }}>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-secondary)', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>TEMPERATURA</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {tempData.map(t => (
                  <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: t.color, flexShrink: 0 }} />
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)', flex: 1 }}>{t.name}</span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                      {totalTemp > 0 ? pct((t.value / totalTemp) * 100) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <ResponsiveContainer width="100%" height={100}>
                <PieChart>
                  <Pie data={tempData} cx="50%" cy="50%" innerRadius={30} outerRadius={46} dataKey="value" strokeWidth={0}>
                    {tempData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip formatter={(v) => [`${v} campanhas`, '']} contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)', borderRadius: '8px', fontFamily: 'var(--font-body)', fontSize: '0.72rem' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>
      </div>

      {/* ── Tabela de campanhas ────────────────────────────────────── */}
      <div style={{ padding: '0 2rem 2rem' }}>
        <TabelaCampanhas campanhas={campMetricas} estrutura={estrutura} isAdmin />
      </div>

    </div>
  )
}
