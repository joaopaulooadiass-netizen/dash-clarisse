'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ZAxis,
} from 'recharts'
import type { Criativo, CriativoMetricas } from '@/lib/types'
import { FiltroFunil, type FiltroState, FILTRO_PADRAO, temFiltroAtivo, passaFiltroNome } from '@/components/dashboard/FiltroFunil'
import { useMetricLibrary } from '@/components/metrics/MetricLibraryPanel'
import { SeletorPeriodo } from '@/components/ui/SeletorPeriodo'
import { evaluateFormula, formatMetricValue, withFormulaAliases } from '@/lib/metrics/library'
import { getDefaultMetricKeys, getMetricLabel, getMetricsForScope, type MetricFormat } from '@/lib/config/metrics'
import { corVsMedia, MIN_IMPRESSOES_AMOSTRA } from '@/lib/utils/classificacao'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type MetricKey = string

interface MetricaDef {
  key: MetricKey
  label: string
  grupo: string
  format: (d: CriativoMetricas) => string
  formatRaw: (v: number) => string
  getValue: (d: CriativoMetricas) => number
  invertido?: boolean
}

// ─── Cores ────────────────────────────────────────────────────────────────────

const Q_COR: Record<string, string> = {
  acima: '#5F8A3C', abaixo: '#8A8A7E', novo: '#5C79C9',
}
const Q_LABEL: Record<string, string> = {
  acima: 'Acima da média', abaixo: 'Abaixo da média', novo: 'Novo',
}
// ─── Helpers ──────────────────────────────────────────────────────────────────

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function pct(v: number) { return `${v.toFixed(1)}%` }
function numK(v: number) { return v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(Math.round(v)) }
function valorCampo(d: CriativoMetricas, key: string) {
  const value = (d as unknown as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// ─── Definição de métricas ────────────────────────────────────────────────────

// Custo (currency invertido, ex.: CAC/CPC) com valor 0 = divisor zerado (0 compras,
// 0 cliques...) — é incalculável, não "custo grátis". '—' como painel/modal; a
// tabela chegou a mostrar "R$ 0,00" ao lado do painel '—' para o MESMO criativo.
// Só em CÉLULAS (format): formatRaw rotula régua de eixo, onde 0 é marco real.
const fmtSemCustoZero = (v: number, format: MetricFormat, invertido?: boolean) =>
  format === 'currency' && invertido && v === 0 ? '—' : formatMetricValue(v, format)

const TODAS_METRICAS: MetricaDef[] = getMetricsForScope('criativos').map(m => ({
  key: m.key,
  label: getMetricLabel(m, 'criativos'),
  grupo: m.group,
  format: d => fmtSemCustoZero(m.getValue(d as unknown as Record<string, unknown>), m.format, m.invertido),
  formatRaw: v => formatMetricValue(v, m.format),
  getValue: d => m.getValue(d as unknown as Record<string, unknown>),
  invertido: m.invertido,
}))

const COLS_PADRAO: MetricKey[] = getDefaultMetricKeys('criativos')

// ─── Semáforo ─────────────────────────────────────────────────────────────────

interface Estat { media: number; dp: number; invertido: boolean }

function calcEstat(dados: CriativoMetricas[], getValue: (d: CriativoMetricas) => number, invertido?: boolean): Estat {
  const vals = dados.map(getValue).filter(v => v > 0)
  if (!vals.length) return { media: 0, dp: 0, invertido: !!invertido }
  const media = vals.reduce((s, v) => s + v, 0) / vals.length
  const dp    = Math.sqrt(vals.reduce((s, v) => s + (v - media) ** 2, 0) / vals.length)
  return { media, dp, invertido: !!invertido }
}

function corSemaforo(val: number, e: Estat): string {
  // Zero = sem dado (criativo sem compra tem CAC 0), não "melhor da conta":
  // sem a guarda, CAC 0 invertido pintava de verde quem nunca vendeu
  if (!val || e.dp === 0) return 'var(--color-text-secondary)'
  const z = (val - e.media) / e.dp
  if (Math.abs(z) > 2) return 'var(--color-signal-yellow)'
  if (e.invertido) return val <= e.media ? 'var(--color-signal-green)' : 'var(--color-signal-red)'
  return val >= e.media ? 'var(--color-signal-green)' : 'var(--color-signal-red)'
}

// Rótulo de RÉGUA compacto pros eixos do scatter — moeda longa ("R$ 12.345,67")
// cortava no width do eixo; o valor exato continua no tooltip.
function tickCompacto(def: MetricaDef | undefined, v: number): string {
  const s = def?.formatRaw(v) ?? String(v)
  if (s.length <= 9) return s
  return Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : s
}

// ─── Filtro funil aplicado ao nome do criativo ────────────────────────────────

function aplicarFiltroFunil(dados: CriativoMetricas[], f: FiltroState, criativos: Criativo[]): CriativoMetricas[] {
  const ativoById = new Map(criativos.map(c => [c.id, c.ativo]))
  return dados.filter(d => {
    if (!passaFiltroNome(d.nome, f)) return false
    if (f.ativoAnuncio && !ativoById.get(d.id)) return false
    if (f.teveVeiculacao && !(d.impressoes > 0)) return false
    return true
  })
}

// ─── Tooltip scatter ─────────────────────────────────────────────────────────

function ScatterTooltip({ active, payload, metricaXDef, metricaYDef }: {
  active?: boolean
  payload?: { payload: CriativoMetricas }[]
  metricaXDef?: MetricaDef
  metricaYDef?: MetricaDef
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const linhas = [
    metricaXDef ? [metricaXDef.label, metricaXDef.format(d)] : null,
    metricaYDef && metricaYDef.key !== metricaXDef?.key ? [metricaYDef.label, metricaYDef.format(d)] : null,
    ['ROAS', `${d.roas.toFixed(1)}x`],
    ['Gasto', brl(d.gasto)],
  ].filter((l): l is [string, string] => l !== null)
  return (
    <div style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)', borderRadius: '8px', padding: '0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-primary)', minWidth: '160px' }}>
      <p style={{ fontWeight: 700, marginBottom: '0.35rem', color: Q_COR[d.quadrante] }}>{d.nome.substring(0, 42)}</p>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.65rem', marginBottom: '0.5rem', lineHeight: 1.4 }}>{d.id}</p>
      {linhas.map(([l, v]) => (
        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', paddingBlock: '0.1rem' }}>
          <span style={{ color: 'var(--color-text-muted)' }}>{l}</span>
          <span style={{ fontWeight: 600 }}>{v}</span>
        </div>
      ))}
    </div>
  )
}

function CriativoMedia({
  criativo,
  modo,
}: {
  criativo: CriativoMetricas
  modo: 'preview' | 'modal'
}) {
  const isModal = modo === 'modal'
  const mediaStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'center',
    backgroundColor: '#05070a',
  }

  return (
    <>
      {criativo.videoUrl ? (
        <video
          src={criativo.videoUrl}
          poster={criativo.thumbUrl ?? undefined}
          controls={isModal}
          muted={!isModal}
          loop={!isModal}
          playsInline
          autoPlay={!isModal}
          style={mediaStyle}
        />
      ) : criativo.thumbUrl ? (
        // Thumbnails vêm do CDN da Meta (URLs assinadas que expiram) — next/image não se aplica
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={criativo.thumbUrl}
          alt={criativo.nome}
          loading="lazy"
          referrerPolicy="no-referrer"
          style={mediaStyle}
        />
      ) : (
        <>
          {criativo.tipo === 'vídeo' && (
            <div style={{ width: isModal ? '72px' : '52px', height: isModal ? '72px' : '52px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 0, height: 0, borderTop: isModal ? '14px solid transparent' : '10px solid transparent', borderBottom: isModal ? '14px solid transparent' : '10px solid transparent', borderLeft: isModal ? '24px solid white' : '18px solid white', marginLeft: isModal ? '5px' : '3px' }} />
            </div>
          )}
          {criativo.tipo === 'carrossel' && (
            <div style={{ display: 'flex', gap: isModal ? '8px' : '5px' }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: isModal ? '10px' : '7px', height: isModal ? '10px' : '7px', borderRadius: '50%', backgroundColor: i === 0 ? 'white' : 'rgba(255,255,255,0.35)' }} />)}
            </div>
          )}
        </>
      )}
      {(criativo.thumbUrl || criativo.videoUrl) && (
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.18), transparent 35%, rgba(0,0,0,0.55))', pointerEvents: 'none' }} />
      )}
      {/* Vídeo sem source (token sem permissão na página) — o play leva ao Instagram
          pra não parecer preview quebrado */}
      {criativo.tipo === 'vídeo' && !criativo.videoUrl && criativo.permalinkUrl && (
        <a
          href={criativo.permalinkUrl}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
          title="Assistir no Instagram"
          style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', textDecoration: 'none' }}
        >
          <div style={{ width: isModal ? '72px' : '52px', height: isModal ? '72px' : '52px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 0, height: 0, borderTop: isModal ? '14px solid transparent' : '10px solid transparent', borderBottom: isModal ? '14px solid transparent' : '10px solid transparent', borderLeft: isModal ? '24px solid white' : '18px solid white', marginLeft: isModal ? '5px' : '3px' }} />
          </div>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: isModal ? '0.72rem' : '0.6rem', fontWeight: 700, color: 'white', backgroundColor: 'rgba(0,0,0,0.55)', padding: '0.15rem 0.5rem', borderRadius: 'var(--radius-pill)' }}>
            Assistir no Instagram ↗
          </span>
        </a>
      )}
    </>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function AnaliseCriativos({
  criativos,
  metricasReais,
  de: deInicial,
  ate: ateInicial,
}: {
  criativos: Criativo[]
  metricasReais: CriativoMetricas[]
  de?: string
  ate?: string
}) {
  const router = useRouter()
  const [filtroQ, setFiltroQ]                     = useState<string>('todos')
  const [de, setDe] = useState(deInicial ?? '')
  const [ate, setAte] = useState(ateInicial ?? '')
  const [selecionado, setSelecionado]             = useState<string>('')
  const [ordenarPor, setOrdenarPor]               = useState<MetricKey>('compras')
  const [ordemDir, setOrdemDir]                   = useState<'desc' | 'asc'>('desc')
  const [metricaXKey, setMetricaXKey]             = useState<MetricKey>('compras')
  const [metricaYKey, setMetricaYKey]             = useState<MetricKey>('cac')
  const [colsAtivas, setColsAtivas]               = useState<MetricKey[]>(COLS_PADRAO)
  const [configuradorAberto, setConfigurador]     = useState(false)
  const [filtroFunil, setFiltroFunil]             = useState<FiltroState>(FILTRO_PADRAO)
  const [filtroFunilAberto, setFiltroFunilAberto] = useState(false)
  const [expandido, setExpandido]                 = useState(false)
  const [dragIdx, setDragIdx]                     = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx]             = useState<number | null>(null)
  const metricasBiblioteca = useMetricLibrary()

  // Mudou o período → atualiza a URL, o que dispara um novo fetch no servidor
  // (a página é force-dynamic e busca direto na Graph API com o intervalo escolhido).
  useEffect(() => {
    if (!de || !ate || (de === deInicial && ate === ateInicial)) return
    const params = new URLSearchParams({ de, ate })
    router.push(`/dashboard/criativo?${params.toString()}`)
  }, [de, ate, deInicial, ateInicial, router])

  const dados: CriativoMetricas[] = useMemo(() => {
    const mediaById = new Map(criativos.map(c => [c.id, c]))
    return metricasReais.map(m => {
      const media = mediaById.get(m.id)
      return {
        ...m,
        thumbUrl: m.thumbUrl ?? media?.thumbUrl ?? null,
        videoUrl: m.videoUrl ?? media?.videoUrl ?? null,
        permalinkUrl: m.permalinkUrl ?? null,
      }
    })
  }, [criativos, metricasReais])

  // Médias do conjunto (só criativos com amostra) — régua relativa pro semáforo
  // das métricas no painel de detalhe: acima da média = verde, abaixo = neutro.
  const medias = useMemo(() => {
    const comAmostra = dados.filter(d => d.impressoes >= MIN_IMPRESSOES_AMOSTRA)
    const avg = (sel: (d: CriativoMetricas) => number) => {
      const xs = comAmostra.map(sel).filter(v => v > 0)
      return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0
    }
    return {
      hookRate: avg(d => d.hookRate), ctr: avg(d => d.ctr), retencao75: avg(d => d.retencao75),
      cac: avg(d => d.cac), roas: avg(d => d.roas),
    }
  }, [dados])

  const metricasDisponiveis = useMemo((): MetricaDef[] => {
    const custom = metricasBiblioteca
      .filter(m => m.scope === 'global' || m.scope === 'criativos')
      .map((m): MetricaDef => ({
        key: `custom:${m.id}`,
        label: m.name,
        grupo: m.group || 'Customizadas',
        format: d => formatMetricValue(evaluateFormula(m.formula, withFormulaAliases(d as unknown as Record<string, unknown>)), m.format),
        formatRaw: v => formatMetricValue(v, m.format),
        getValue: d => evaluateFormula(m.formula, withFormulaAliases(d as unknown as Record<string, unknown>)) ?? 0,
        invertido: m.invertido,
      }))
    return [...TODAS_METRICAS, ...custom]
  }, [metricasBiblioteca])

  const metricaOrdenacao = useMemo(
    () => metricasDisponiveis.find(m => m.key === ordenarPor) ?? metricasDisponiveis.find(m => m.key === 'compras') ?? metricasDisponiveis[0],
    [metricasDisponiveis, ordenarPor],
  )

  const dadosFiltrados = useMemo(() => {
    let d = dados
    if (temFiltroAtivo(filtroFunil)) d = aplicarFiltroFunil(d, filtroFunil, criativos)
    if (filtroQ !== 'todos') d = d.filter(c => c.quadrante === filtroQ)
    return [...d].sort((a, b) => {
      const av = metricaOrdenacao?.getValue(a) ?? valorCampo(a, ordenarPor)
      const bv = metricaOrdenacao?.getValue(b) ?? valorCampo(b, ordenarPor)
      return ordemDir === 'desc' ? bv - av : av - bv
    })
  }, [dados, filtroFunil, filtroQ, ordenarPor, ordemDir, metricaOrdenacao, criativos])

  const idAtivo = dadosFiltrados.find(d => d.id === selecionado)?.id ?? dadosFiltrados[0]?.id ?? ''
  const criativoAtivo = dados.find(c => c.id === idAtivo) ?? dados[0]
  const indiceAtivo   = dadosFiltrados.findIndex(d => d.id === idAtivo)

  // Piso 1: lista vazia daria Math.max() = -Infinity e gasto todo-zerado daria
  // 0/0 = NaN no raio das bolhas do scatter (bolha some sem aviso)
  const maxGasto = useMemo(() => Math.max(1, ...dados.map(d => d.gasto)), [dados])

  const metricaXDef = useMemo(
    () => metricasDisponiveis.find(m => m.key === metricaXKey) ?? metricasDisponiveis.find(m => m.key === 'compras') ?? metricasDisponiveis[0],
    [metricasDisponiveis, metricaXKey],
  )
  const metricaYDef = useMemo(
    () => metricasDisponiveis.find(m => m.key === metricaYKey) ?? metricasDisponiveis.find(m => m.key === 'cac') ?? metricasDisponiveis[0],
    [metricasDisponiveis, metricaYKey],
  )

  const dadosGrafico = useMemo(
    () => dadosFiltrados.map(d => ({
      ...d,
      __x: metricaXDef?.getValue(d) ?? 0,
      __y: metricaYDef?.getValue(d) ?? 0,
    })),
    [dadosFiltrados, metricaXDef, metricaYDef],
  )

  // Média das linhas de referência SÓ com quem tem valor (>0) — mesmo critério
  // de calcEstat/`medias`. Incluir zeros (criativo sem compra → CAC 0) puxava a
  // linha "média" pra baixo e empurrava criativos medianos pro lado "ruim".
  const mediaX = useMemo(() => {
    const vals = dadosGrafico.map(d => d.__x).filter(v => v > 0)
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
  }, [dadosGrafico])
  const mediaY = useMemo(() => {
    const vals = dadosGrafico.map(d => d.__y).filter(v => v > 0)
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
  }, [dadosGrafico])

  const estats = useMemo(() => {
    const result: Partial<Record<MetricKey, Estat>> = {}
    metricasDisponiveis.forEach(m => {
      result[m.key] = calcEstat(dadosFiltrados, m.getValue, m.invertido)
    })
    return result as Record<MetricKey, Estat>
  }, [dadosFiltrados, metricasDisponiveis])

  const colsDef = useMemo(
    () => colsAtivas.map(k => metricasDisponiveis.find(m => m.key === k)!).filter(Boolean),
    [colsAtivas, metricasDisponiveis]
  )

  function handleColHeader(key: MetricKey) {
    if (key === ordenarPor) { setOrdemDir(d => d === 'desc' ? 'asc' : 'desc') }
    else { setOrdenarPor(key); setOrdemDir('desc') }
  }

  function navPreview(dir: 1 | -1) {
    const next = indiceAtivo + dir
    if (next >= 0 && next < dadosFiltrados.length) setSelecionado(dadosFiltrados[next].id)
  }

  // ── Custom scatter shape ──────────────────────────────────────────────────
  const scatterShape = (shapeProps: unknown) => {
    const p = shapeProps as { cx?: number; cy?: number; payload: CriativoMetricas }
    const r = Math.round(12 + (p.payload.gasto / maxGasto) * 34)
    const isSelected = p.payload.id === idAtivo
    const cx = p.cx ?? 0
    const cy = p.cy ?? 0
    return (
      <g style={{ cursor: 'pointer' }}>
        <circle cx={cx} cy={cy} r={r} fill={Q_COR[p.payload.quadrante]} fillOpacity={isSelected ? 0.95 : 0.55} />
        {isSelected && <circle cx={cx} cy={cy} r={r} fill="none" stroke="white" strokeWidth={2.5} />}
      </g>
    )
  }

  const grupos = useMemo(() => Array.from(new Set(metricasDisponiveis.map(m => m.grupo))), [metricasDisponiveis])
  const filtroAtivo = temFiltroAtivo(filtroFunil)

  // ── Estilos reutilizáveis ─────────────────────────────────────────────────
  const segmBtn = (ativo: boolean, cor?: string): React.CSSProperties => ({
    padding: '0.3rem 0.75rem',
    fontFamily: 'var(--font-body)', fontSize: '0.74rem',
    border: 'none', cursor: 'pointer',
    backgroundColor: ativo ? (cor ?? 'var(--color-bg-tertiary)') : 'transparent',
    color: ativo ? 'white' : 'var(--color-text-muted)',
    fontWeight: ativo ? 700 : 400,
  })

  // Sem dados reais no período: estado vazio honesto — nunca inventamos métricas
  if (dados.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: 'var(--color-bg-primary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 2rem 0', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '0.03em' }}>CRIATIVOS</h1>
          <SeletorPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} atalhos={[7, 14, 30]} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', padding: '2rem' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>Sem dados da Meta neste período</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--color-text-muted)', textAlign: 'center', maxWidth: '440px', lineHeight: 1.55 }}>
            Nenhum anúncio retornou métricas. Ajuste o período acima ou aguarde alguns minutos — a Meta pode ter limitado as requisições temporariamente.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: 'var(--color-bg-primary)', overflow: 'hidden', position: 'relative' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 2rem 0', flexWrap: 'wrap', gap: '0.75rem', flexShrink: 0 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '0.03em' }}>CRIATIVOS</h1>

        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>

          <SeletorPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} atalhos={[7, 14, 30]} />

          {/* Quadrante */}
          <div style={{ display: 'flex', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {(['todos', 'acima', 'abaixo', 'novo'] as const).map((q, i, arr) => (
              <button key={q} onClick={() => setFiltroQ(q)} style={{ ...segmBtn(filtroQ === q, q === 'todos' ? 'var(--color-bg-tertiary)' : Q_COR[q]), borderRight: i < arr.length - 1 ? '1px solid var(--color-border-subtle)' : 'none' }}>
                {q === 'todos' ? 'Todos' : Q_LABEL[q]}
              </button>
            ))}
          </div>

          {/* Filtro inteligente */}
          <button
            onClick={() => setFiltroFunilAberto(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.75rem', backgroundColor: filtroAtivo ? 'rgba(95,138,60,0.12)' : 'var(--color-bg-card)', border: `1px solid ${filtroAtivo ? 'var(--color-ponto-conversao)' : 'var(--color-border-subtle)'}`, borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-body)', fontSize: '0.74rem', color: filtroAtivo ? 'var(--color-ponto-conversao)' : 'var(--color-text-muted)', cursor: 'pointer', fontWeight: filtroAtivo ? 700 : 400 }}
          >
            <span>⚙</span>
            Filtros{filtroAtivo ? ' ●' : ''}
          </button>

          {/* Configurador de métricas */}
          <button
            onClick={() => setConfigurador(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.75rem', backgroundColor: configuradorAberto ? 'rgba(95,138,60,0.08)' : 'var(--color-bg-card)', border: `1px solid ${configuradorAberto ? 'var(--color-ponto-conversao)' : 'var(--color-border-subtle)'}`, borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-body)', fontSize: '0.74rem', color: configuradorAberto ? 'var(--color-ponto-conversao)' : 'var(--color-text-muted)', cursor: 'pointer' }}
          >
            <span>≡</span>
            Métricas
          </button>
        </div>
      </div>

      {/* ── Filtro inteligente (dropdown) ─────────────────────────────────── */}
      {filtroFunilAberto && (
        <div style={{ padding: '0.75rem 2rem 0', flexShrink: 0 }}>
          <FiltroFunil filtro={filtroFunil} onChange={setFiltroFunil} storageKey="filtro-criativos-v1" niveis={['anuncio', 'veiculacao']} />
        </div>
      )}

      {/* ── Conteúdo principal ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '268px 1fr', gridTemplateRows: '1fr', gap: '1rem', padding: '1rem 2rem 1.25rem', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* ── Painel esquerdo — Preview ─────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', height: '100%', overflow: 'hidden' }}>

          {/* Card preview */}
          <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

            {/* Thumbnail */}
            <div
              onClick={() => setExpandido(true)}
              style={{ position: 'relative', height: '220px', background: criativoAtivo?.thumbColor ?? '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}
            >
              {criativoAtivo && <CriativoMedia criativo={criativoAtivo} modo="preview" />}
              {/* Hint de expandir */}
              <div style={{ position: 'absolute', top: '0.5rem', left: '0.5rem', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 'var(--radius-sm)', padding: '0.15rem 0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem', backdropFilter: 'blur(4px)' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'rgba(255,255,255,0.8)' }}>Expandir</span>
              </div>
              <div style={{ position: 'absolute', bottom: '0.5rem', left: '0.5rem' }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'white', backgroundColor: 'rgba(0,0,0,0.6)', padding: '0.1rem 0.35rem', borderRadius: 'var(--radius-sm)', backdropFilter: 'blur(4px)' }}>
                  {criativoAtivo?.duracao ? `${criativoAtivo.duracao} · ` : ''}{criativoAtivo?.tipo}
                </span>
              </div>
              {criativoAtivo && (
                <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', backgroundColor: Q_COR[criativoAtivo.quadrante], borderRadius: 'var(--radius-pill)', padding: '0.12rem 0.45rem', fontFamily: 'var(--font-body)', fontSize: '0.6rem', fontWeight: 700, color: 'white' }}>
                  {Q_LABEL[criativoAtivo.quadrante]}
                </div>
              )}
            </div>

            {/* Info + métricas */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0.8rem 0.9rem' }}>
              {criativoAtivo && (
                <>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '0.15rem' }}>
                    {criativoAtivo.nome}
                  </p>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-muted)', marginBottom: '0.85rem', lineHeight: 1.4 }}>
                    {criativoAtivo.id}
                  </p>

                  {[
                    // Hook Rate só existe para vídeo (video3s não é coletado em imagem) — igual Retenção/CPV
                    { label: 'Hook Rate',   valor: criativoAtivo.tipo === 'vídeo' ? pct(criativoAtivo.hookRate) : '—',   cor: corVsMedia(criativoAtivo.hookRate, medias.hookRate) },
                    { label: 'CTR',          valor: pct(criativoAtivo.ctr),        cor: corVsMedia(criativoAtivo.ctr, medias.ctr) },
                    { label: 'Retenção 75%', valor: criativoAtivo.tipo === 'vídeo' ? pct(criativoAtivo.retencao75) : '—', cor: corVsMedia(criativoAtivo.retencao75, medias.retencao75) },
                    { label: 'CPV 75%',      valor: criativoAtivo.tipo === 'vídeo' && criativoAtivo.cpv75 > 0 ? brl(criativoAtivo.cpv75) : '—', cor: 'var(--color-text-secondary)' },
                    { label: 'Compras',      valor: String(criativoAtivo.compras),  cor: 'var(--color-text-primary)' },
                    { label: 'CAC',          valor: criativoAtivo.compras > 0 ? brl(criativoAtivo.cac) : '—', cor: corVsMedia(criativoAtivo.cac, medias.cac, true) },
                    { label: 'ROAS',         valor: `${criativoAtivo.roas.toFixed(1)}x`, cor: corVsMedia(criativoAtivo.roas, medias.roas) },
                    { label: 'Gasto',        valor: brl(criativoAtivo.gasto),       cor: 'var(--color-text-secondary)' },
                    { label: 'Impressões',   valor: numK(criativoAtivo.impressoes),  cor: 'var(--color-text-secondary)' },
                    { label: 'CPM',          valor: criativoAtivo.cpm > 0 ? brl(criativoAtivo.cpm) : '—', cor: 'var(--color-text-secondary)' },
                  ].map(({ label, valor, cor }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBlock: '0.3rem', borderBottom: '1px solid rgba(28,28,26,0.03)' }}>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{label}</span>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 600, color: cor }}>{valor}</span>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Navegação prev / next */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.55rem 0.9rem', borderTop: '1px solid var(--color-border-subtle)', flexShrink: 0 }}>
              <button onClick={() => navPreview(-1)} disabled={indiceAtivo <= 0} style={{ padding: '0.25rem 0.6rem', backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: indiceAtivo <= 0 ? 'var(--color-text-muted)' : 'var(--color-text-primary)', cursor: indiceAtivo <= 0 ? 'default' : 'pointer', opacity: indiceAtivo <= 0 ? 0.4 : 1 }}>
                ← Ant.
              </button>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                {dadosFiltrados.length > 0 ? `${indiceAtivo + 1} / ${dadosFiltrados.length}` : '0 / 0'}
              </span>
              <button onClick={() => navPreview(1)} disabled={indiceAtivo >= dadosFiltrados.length - 1} style={{ padding: '0.25rem 0.6rem', backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: indiceAtivo >= dadosFiltrados.length - 1 ? 'var(--color-text-muted)' : 'var(--color-text-primary)', cursor: indiceAtivo >= dadosFiltrados.length - 1 ? 'default' : 'pointer', opacity: indiceAtivo >= dadosFiltrados.length - 1 ? 0.4 : 1 }}>
                Próx. →
              </button>
            </div>
          </div>
        </div>

        {/* ── Painel direito ────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0 }}>

          {/* Scatter chart */}
          <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', padding: '1rem 1.25rem', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                <select
                  value={metricaXKey}
                  onChange={e => setMetricaXKey(e.target.value)}
                  style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)', fontSize: '0.68rem', padding: '0.2rem 0.4rem' }}
                >
                  {metricasDisponiveis.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>×</span>
                <select
                  value={metricaYKey}
                  onChange={e => setMetricaYKey(e.target.value)}
                  style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)', fontSize: '0.68rem', padding: '0.2rem 0.4rem' }}
                >
                  {metricasDisponiveis.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)' }}>— tamanho = investimento</span>
              </div>
              <div style={{ display: 'flex', gap: '0.85rem' }}>
                {Object.entries(Q_COR).map(([q, cor]) => (
                  <div key={q} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: cor }} />
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)' }}>{Q_LABEL[q]}</span>
                  </div>
                ))}
              </div>
            </div>

            <ResponsiveContainer width="100%" height={230}>
              <ScatterChart margin={{ top: 20, right: 36, left: 0, bottom: 16 }} onClick={(e) => {
                const ev = e as unknown as { activePayload?: { payload: CriativoMetricas }[] }
                if (ev?.activePayload?.[0]?.payload) setSelecionado(ev.activePayload[0].payload.id)
              }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(28,28,26,0.04)" />
                <XAxis dataKey="__x" name={metricaXDef?.label} type="number" tick={{ fontFamily: 'var(--font-body)', fontSize: 10, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} tickFormatter={v => tickCompacto(metricaXDef, v as number)} label={{ value: metricaXDef?.label, position: 'insideBottom', offset: -4, fill: 'var(--color-text-muted)', fontSize: 10 }} />
                <YAxis dataKey="__y" name={metricaYDef?.label} type="number" tick={{ fontFamily: 'var(--font-body)', fontSize: 10, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} tickFormatter={v => tickCompacto(metricaYDef, v as number)} width={56} label={{ value: metricaYDef?.label, angle: -90, position: 'insideLeft', offset: 12, fill: 'var(--color-text-muted)', fontSize: 10 }} />
                <ZAxis range={[1, 1]} />
                <Tooltip content={<ScatterTooltip metricaXDef={metricaXDef} metricaYDef={metricaYDef} />} />
                <ReferenceLine x={mediaX} stroke="rgba(28,28,26,0.25)" strokeDasharray="4 4" label={{ value: 'média', position: 'top', fill: 'rgba(28,28,26,0.45)', fontSize: 9 }} />
                <ReferenceLine y={mediaY} stroke="rgba(28,28,26,0.25)" strokeDasharray="4 4" label={{ value: 'média', position: 'right', fill: 'rgba(28,28,26,0.45)', fontSize: 9 }} />
                <Scatter data={dadosGrafico} shape={scatterShape} cursor="pointer" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* ── Tabela ──────────────────────────────────────────────────────── */}
          <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>

            {/* Toolbar tabela */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 1rem', borderBottom: '1px solid var(--color-border-subtle)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                  {dadosFiltrados.length} criativos
                </p>
                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  {[['var(--color-signal-green)', 'Acima da média'], ['var(--color-signal-red)', 'Abaixo'], ['var(--color-signal-yellow)', 'Outlier']].map(([cor, label]) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: cor }} />
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)' }}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)' }}>Clique no cabeçalho para ordenar</p>
            </div>

            {/* Scroll */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--color-bg-secondary)', zIndex: 2 }}>
                  <tr>
                    <th style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', borderBottom: '1px solid var(--color-border-subtle)', whiteSpace: 'nowrap' }}>Anúncio</th>
                    <th style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center', borderBottom: '1px solid var(--color-border-subtle)' }}>Quadrante</th>
                    {colsDef.map(col => (
                      <th key={col.key} onClick={() => handleColHeader(col.key)} style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.62rem', fontWeight: 600, color: ordenarPor === col.key ? 'var(--color-text-primary)' : 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right', borderBottom: `2px solid ${ordenarPor === col.key ? 'var(--color-ponto-conversao)' : 'var(--color-border-subtle)'}`, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                        {col.label} {ordenarPor === col.key ? (ordemDir === 'desc' ? '↓' : '↑') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dadosFiltrados.map((d, i) => {
                    const ativo = d.id === idAtivo
                    return (
                      <tr key={d.id} onClick={() => setSelecionado(d.id)} style={{ borderBottom: '1px solid rgba(28,28,26,0.03)', backgroundColor: ativo ? 'rgba(95,138,60,0.07)' : i % 2 === 0 ? 'transparent' : 'rgba(28,28,26,0.02)', cursor: 'pointer' }}>
                        <td style={{ padding: '0.45rem 0.75rem', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', minWidth: 0 }}>
                            {d.thumbUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={d.thumbUrl}
                                alt=""
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                style={{ width: '34px', height: '34px', borderRadius: 'var(--radius-sm)', objectFit: 'cover', backgroundColor: '#05070a', border: '1px solid var(--color-border-subtle)', flexShrink: 0 }}
                              />
                            ) : (
                              <div style={{ width: '34px', height: '34px', borderRadius: 'var(--radius-sm)', background: d.thumbColor, border: '1px solid var(--color-border-subtle)', flexShrink: 0 }} />
                            )}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: Q_COR[d.quadrante], flexShrink: 0 }} />
                                <span title={d.nome} style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: ativo ? 'var(--color-ponto-conversao)' : 'var(--color-text-primary)', fontWeight: ativo ? 700 : 500, maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.nome}</span>
                              </div>
                              <p title={d.id} style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '0.08rem' }}>
                                {d.id}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '0.45rem 0.75rem', textAlign: 'center' }}>
                          <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', fontWeight: 700, color: Q_COR[d.quadrante], backgroundColor: `${Q_COR[d.quadrante]}22`, padding: '0.12rem 0.4rem', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap' }}>
                            {Q_LABEL[d.quadrante]}
                          </span>
                        </td>
                        {colsDef.map(col => {
                          const val = col.getValue(d)
                          const valStr = col.format(d)
                          const cor = valStr === '—' || valStr === '-' ? 'var(--color-text-muted)' : corSemaforo(val, estats[col.key])
                          return (
                            <td key={col.key} style={{ padding: '0.45rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: valStr === '—' ? 400 : 600, color: cor, whiteSpace: 'nowrap' }}>
                              {valStr}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* ── Overlay configurador de métricas ─────────────────────────────────── */}
      {configuradorAberto && (
        <>
          <div onClick={() => setConfigurador(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 40 }} />
          <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: '300px', backgroundColor: 'var(--color-bg-secondary)', borderLeft: '1px solid var(--color-border-subtle)', zIndex: 41, display: 'flex', flexDirection: 'column' }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border-subtle)', flexShrink: 0 }}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>Métricas da tabela</p>
              <button onClick={() => setConfigurador(false)} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>✕</button>
            </div>

            {/* Seção: Ativas (drag-and-drop) */}
            <div style={{ padding: '0.85rem 1.25rem 0', flexShrink: 0 }}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.5rem' }}>
                Ativas — arraste para reordenar
              </p>
              {colsAtivas.map((key, i) => {
                const m = metricasDisponiveis.find(x => x.key === key)
                if (!m) return null
                const isDragging  = dragIdx === i
                const isOver      = dragOverIdx === i
                return (
                  <div
                    key={key}
                    draggable
                    onDragStart={() => setDragIdx(i)}
                    onDragOver={e => { e.preventDefault(); setDragOverIdx(i) }}
                    onDrop={() => {
                      if (dragIdx === null || dragIdx === i) return
                      const next = [...colsAtivas]
                      const [moved] = next.splice(dragIdx, 1)
                      next.splice(i, 0, moved)
                      setColsAtivas(next)
                      setDragIdx(null)
                      setDragOverIdx(null)
                    }}
                    onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem',
                      padding: '0.4rem 0.6rem', marginBottom: '0.25rem',
                      backgroundColor: isOver ? 'rgba(95,138,60,0.12)' : 'var(--color-bg-card)',
                      border: `1px solid ${isOver ? 'var(--color-ponto-conversao)' : 'var(--color-border-subtle)'}`,
                      borderRadius: 'var(--radius-md)',
                      opacity: isDragging ? 0.4 : 1,
                      cursor: 'grab',
                      transition: 'background-color 0.1s, border-color 0.1s',
                    }}
                  >
                    <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', lineHeight: 1, userSelect: 'none' }}>⠿</span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--color-text-primary)', flex: 1 }}>{m.label}</span>
                    <button
                      onClick={() => setColsAtivas(prev => prev.filter(k => k !== key))}
                      style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.8rem', lineHeight: 1, padding: '0.1rem', opacity: 0.6 }}
                    >✕</button>
                  </div>
                )
              })}
              {colsAtivas.length === 0 && (
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '0.5rem 0' }}>Nenhuma métrica ativa</p>
              )}
            </div>

            <div style={{ margin: '0.75rem 1.25rem', borderTop: '1px solid var(--color-border-subtle)' }} />

            {/* Seção: Adicionar */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 1.25rem 1rem' }}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.75rem' }}>
                Adicionar
              </p>
              {grupos.map(grupo => {
                const inativos = metricasDisponiveis.filter(m => m.grupo === grupo && !colsAtivas.includes(m.key))
                if (!inativos.length) return null
                return (
                  <div key={grupo} style={{ marginBottom: '1rem' }}>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem', opacity: 0.7 }}>{grupo}</p>
                    {inativos.map(m => (
                      <button
                        key={m.key}
                        onClick={() => setColsAtivas(prev => [...prev, m.key])}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.38rem 0.6rem', marginBottom: '0.2rem', backgroundColor: 'transparent', border: '1px dashed var(--color-border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'left' }}
                      >
                        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', lineHeight: 1 }}>+</span>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{m.label}</span>
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>

            {/* Rodapé */}
            <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--color-border-subtle)', flexShrink: 0 }}>
              <button onClick={() => setColsAtivas(COLS_PADRAO)} style={{ width: '100%', padding: '0.5rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                Restaurar padrão
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Modal de expansão do thumbnail ───────────────────────────────────── */}
      {expandido && criativoAtivo && (
        <>
          <div
            onClick={() => setExpandido(false)}
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', zIndex: 50, backdropFilter: 'blur(6px)' }}
          />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 51, display: 'flex', gap: '0', borderRadius: 'var(--radius-lg)', overflow: 'hidden', width: 'min(880px, 92vw)', maxHeight: '88vh', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>

            {/* Lado esquerdo — visual do criativo */}
            <div style={{ position: 'relative', width: '340px', flexShrink: 0, background: criativoAtivo.thumbColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CriativoMedia criativo={criativoAtivo} modo="modal" />
              {/* Badges */}
              <div style={{ position: 'absolute', top: '1rem', left: '1rem', backgroundColor: Q_COR[criativoAtivo.quadrante], borderRadius: 'var(--radius-pill)', padding: '0.2rem 0.65rem', fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 700, color: 'white' }}>
                {Q_LABEL[criativoAtivo.quadrante]}
              </div>
              <div style={{ position: 'absolute', bottom: '1rem', left: '1rem' }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'white', backgroundColor: 'rgba(0,0,0,0.55)', padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-sm)', backdropFilter: 'blur(4px)' }}>
                  {criativoAtivo.duracao ? `${criativoAtivo.duracao} · ` : ''}{criativoAtivo.tipo}
                </span>
              </div>
              {/* Navegação no modal */}
              <button onClick={(e) => { e.stopPropagation(); navPreview(-1) }} disabled={indiceAtivo <= 0} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.5)', border: 'none', color: 'white', fontSize: '1rem', cursor: indiceAtivo <= 0 ? 'default' : 'pointer', opacity: indiceAtivo <= 0 ? 0.3 : 0.8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
              <button onClick={(e) => { e.stopPropagation(); navPreview(1) }} disabled={indiceAtivo >= dadosFiltrados.length - 1} style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.5)', border: 'none', color: 'white', fontSize: '1rem', cursor: indiceAtivo >= dadosFiltrados.length - 1 ? 'default' : 'pointer', opacity: indiceAtivo >= dadosFiltrados.length - 1 ? 0.3 : 0.8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
              {/* Contador */}
              <div style={{ position: 'absolute', bottom: '1rem', right: '1rem', fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)' }}>
                {indiceAtivo + 1} / {dadosFiltrados.length}
              </div>
            </div>

            {/* Lado direito — métricas */}
            <div style={{ flex: 1, backgroundColor: 'var(--color-bg-secondary)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '1.25rem 1.25rem 1rem', borderBottom: '1px solid var(--color-border-subtle)', flexShrink: 0 }}>
                <div>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '0.2rem', lineHeight: 1.35, maxWidth: '320px' }}>{criativoAtivo.nome}</p>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)', lineHeight: 1.45, maxWidth: '260px' }}>{criativoAtivo.id}</p>
                  {criativoAtivo.permalinkUrl && (
                    <a href={criativoAtivo.permalinkUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', marginTop: '0.5rem', fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-ponto-conversao)', textDecoration: 'none', fontWeight: 700 }}>
                      Abrir publicação
                    </a>
                  )}
                </div>
                <button onClick={() => setExpandido(false)} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1, padding: '0.2rem', marginLeft: '0.75rem' }}>✕</button>
              </div>

              {/* Grupos de métricas */}
              {[
                {
                  titulo: 'Veiculação',
                  items: [
                    { label: 'Gasto',       valor: brl(criativoAtivo.gasto),       cor: 'var(--color-text-primary)' },
                    { label: 'Impressões',  valor: numK(criativoAtivo.impressoes),  cor: 'var(--color-text-secondary)' },
                    // Custo com divisor zerado é '—' (coerente com a tabela) — R$ 0,00 afirmaria custo grátis
                    { label: 'CPM',         valor: criativoAtivo.cpm > 0 ? brl(criativoAtivo.cpm) : '—',  cor: 'var(--color-text-secondary)' },
                    { label: 'CTR',         valor: pct(criativoAtivo.ctr),          cor: corVsMedia(criativoAtivo.ctr, medias.ctr) },
                    { label: 'CPC',         valor: criativoAtivo.cpc > 0 ? brl(criativoAtivo.cpc) : '—',  cor: 'var(--color-text-secondary)' },
                  ]
                },
                {
                  titulo: 'Engajamento',
                  items: [
                    { label: 'Hook Rate',   valor: criativoAtivo.tipo === 'vídeo' ? pct(criativoAtivo.hookRate) : '—',    cor: corVsMedia(criativoAtivo.hookRate, medias.hookRate) },
                    { label: 'Retenção 75%',valor: criativoAtivo.tipo === 'vídeo' ? pct(criativoAtivo.retencao75) : '—', cor: corVsMedia(criativoAtivo.retencao75, medias.retencao75) },
                    { label: 'CPV 75%',     valor: criativoAtivo.tipo === 'vídeo' && criativoAtivo.cpv75 > 0 ? brl(criativoAtivo.cpv75) : '—', cor: 'var(--color-text-secondary)' },
                  ]
                },
                {
                  titulo: 'Conversão',
                  items: [
                    { label: 'Compras',      valor: String(criativoAtivo.compras),   cor: 'var(--color-text-primary)' },
                    { label: 'CAC',          valor: criativoAtivo.compras > 0 ? brl(criativoAtivo.cac) : '—', cor: corVsMedia(criativoAtivo.cac, medias.cac, true) },
                    { label: 'ROAS',         valor: `${criativoAtivo.roas.toFixed(1)}x`, cor: corVsMedia(criativoAtivo.roas, medias.roas) },
                    { label: 'Valor Gerado', valor: brl(criativoAtivo.valorGerado),  cor: 'var(--color-text-secondary)' },
                  ]
                },
              ].map(({ titulo, items }) => (
                <div key={titulo} style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.6rem' }}>{titulo}</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1.5rem' }}>
                    {items.map(({ label, valor, cor }) => (
                      <div key={label}>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-muted)', marginBottom: '0.1rem' }}>{label}</p>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.9rem', fontWeight: 700, color: cor }}>{valor}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
