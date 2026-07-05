'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ZAxis,
} from 'recharts'
import type { CampanhaComMetricas } from '@/components/dashboard/TabelaCampanhas'
import type { PublicoComMetricas } from '@/lib/meta/publicos'
import type { CriativoMetricas } from '@/lib/types'
import { SeletorPeriodo } from '@/components/ui/SeletorPeriodo'
import { FiltroFunil, type FiltroState, FILTRO_PADRAO } from '@/components/dashboard/FiltroFunil'
import { getMetricsForScope, getMetricLabel } from '@/lib/config/metrics'
import { evaluateFormula, formatMetricValue, withFormulaAliases } from '@/lib/metrics/library'
import { useMetricLibrary } from '@/components/metrics/MetricLibraryPanel'
import { classificarPorMedia, ctrMedioPonderado, MIN_IMPRESSOES_AMOSTRA } from '@/lib/utils/classificacao'

// ─── Tipos locais ─────────────────────────────────────────────────────────────

type Aba = 'campanhas' | 'publicos' | 'anuncios'

interface ItemMetrica {
  id: string
  nome: string
  investimento: number
  impressoes: number
  cliques: number
  ctr: number
  cpm: number
  compras: number
  valorGerado: number
  roas: number
  cac: number
  seguidores: number
  ativo: boolean
  pageView?: number
  connectRate?: number
  subtitulo?: string
}

// ─── Métricas da biblioteca (eixos do scatter) ───────────────────────────────
// Os eixos aceitam QUALQUER métrica da biblioteca central + customizadas (ƒ),
// em vez dos antigos botões fixos (CTR/CPM/Impressões × ROAS/CAC/Compras/Seguidores).

interface MetricaDef {
  key: string
  label: string
  grupo: string
  formatRaw: (v: number) => string
  getValue: (d: ItemMetrica) => number
}

const METRICAS_BASE: MetricaDef[] = getMetricsForScope('publicos').map(m => ({
  key: m.key,
  label: getMetricLabel(m, 'publicos'),
  grupo: m.group,
  formatRaw: v => formatMetricValue(v, m.format),
  getValue: d => m.getValue(d as unknown as Record<string, unknown>),
}))

// ─── Seletor de eixo (popup da biblioteca) ───────────────────────────────────

function SeletorEixo({ rotulo, atual, metricas, onSelect }: {
  rotulo: string
  atual: MetricaDef
  metricas: MetricaDef[]
  onSelect: (key: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  const grupos = [...new Set(metricas.map(m => m.grupo))]

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setAberto(a => !a)}
        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.65rem', fontFamily: 'var(--font-body)', fontSize: '0.74rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-subtle)', cursor: 'pointer', backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)' }}>
        {rotulo}: <strong style={{ color: 'var(--color-ponto-conversao)' }}>{atual.label}</strong>
        <span style={{ fontSize: '0.6rem' }}>▾</span>
      </button>
      {aberto && (
        <>
          <div onClick={() => setAberto(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 41, width: '300px', maxHeight: '380px', overflowY: 'auto', backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-md)', padding: '0.6rem', boxShadow: '0 16px 40px rgba(0,0,0,0.45)' }}>
            {grupos.map(grupo => (
              <div key={grupo} style={{ marginBottom: '0.5rem' }}>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-muted)', margin: '0 0 0.3rem 0.2rem' }}>{grupo}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                  {metricas.filter(m => m.grupo === grupo).map(m => (
                    <button key={m.key} onClick={() => { onSelect(m.key); setAberto(false) }}
                      style={{ padding: '0.26rem 0.55rem', fontFamily: 'var(--font-body)', fontSize: '0.72rem', borderRadius: '4px', border: '1px solid', borderColor: atual.key === m.key ? 'var(--color-ponto-conversao)' : 'var(--color-border-subtle)', cursor: 'pointer', backgroundColor: atual.key === m.key ? 'rgba(95,138,60,0.15)' : 'var(--color-bg-card)', color: atual.key === m.key ? 'var(--color-ponto-conversao)' : 'var(--color-text-secondary)', fontWeight: atual.key === m.key ? 700 : 400 }}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Quadrante ────────────────────────────────────────────────────────────────

type Quadrante = 'acima' | 'abaixo' | 'novo'

const Q_COR: Record<Quadrante, string> = {
  acima:  '#5F8A3C',
  abaixo: '#8A8A7E',
  novo:   '#5C79C9',
}

const Q_LABEL: Record<Quadrante, string> = {
  acima:  'Acima da média',
  abaixo: 'Abaixo da média',
  novo:   'Novo',
}

// ─── Formatação ───────────────────────────────────────────────────────────────

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function pct(v: number) { return `${v.toFixed(2)}%` }
function num(v: number) { return v.toLocaleString('pt-BR') }

// ─── Tooltip do scatter ───────────────────────────────────────────────────────

interface TooltipProps {
  active?: boolean
  payload?: { payload: ItemMetrica & { quadrante: Quadrante } }[]
  metricaXDef?: MetricaDef
  metricaYDef?: MetricaDef
}

function BubbleTooltip({ active, payload, metricaXDef, metricaYDef }: TooltipProps) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{
      backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)',
      borderRadius: '8px', padding: '0.75rem', fontFamily: 'var(--font-body)',
      fontSize: '0.72rem', color: 'var(--color-text-primary)', minWidth: '190px',
    }}>
      <p style={{ fontWeight: 700, marginBottom: '0.35rem', color: Q_COR[d.quadrante], lineHeight: 1.3 }}>
        {d.nome.substring(0, 48)}
      </p>
      {d.subtitulo && <p style={{ color: 'var(--color-text-muted)', fontSize: '0.65rem', marginBottom: '0.45rem' }}>{d.subtitulo}</p>}
      {([
        metricaXDef ? [metricaXDef.label, metricaXDef.formatRaw(metricaXDef.getValue(d))] : null,
        metricaYDef && metricaYDef.key !== metricaXDef?.key
          ? [metricaYDef.label, metricaYDef.formatRaw(metricaYDef.getValue(d))] : null,
        ['Investimento', brl(d.investimento)],
        ['CTR', pct(d.ctr)],
        ['Compras', num(d.compras)],
      ].filter((l): l is [string, string] => l !== null)).map(([l, v]) => (
        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', paddingBlock: '0.1rem' }}>
          <span style={{ color: 'var(--color-text-muted)' }}>{l}</span>
          <span style={{ fontWeight: 600 }}>{v}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Helpers de conversão de tipo ────────────────────────────────────────────

function campanhaToItem(c: CampanhaComMetricas): ItemMetrica {
  return {
    id: c.id, nome: c.nome,
    investimento: c.investimento, impressoes: c.impressoes, cliques: c.cliques,
    ctr: c.ctr, cpm: c.cpm, compras: c.compras, valorGerado: c.valorGerado,
    roas: c.roas, cac: c.cac, seguidores: c.seguidores ?? 0,
    ativo: c.ativa ?? false,
    pageView: c.pageView ?? 0, connectRate: c.connectRate,
  }
}

function publicoToItem(p: PublicoComMetricas): ItemMetrica {
  return {
    id: p.id, nome: p.nome, subtitulo: p.campanhaNome,
    investimento: p.investimento, impressoes: p.impressoes, cliques: p.cliques,
    ctr: p.ctr, cpm: p.cpm, compras: p.compras, valorGerado: p.valorGerado,
    roas: p.roas, cac: p.cac, seguidores: p.seguidores,
    ativo: p.ativo,
    pageView: p.pageView, connectRate: p.connectRate,
  }
}

function anuncioToItem(a: CriativoMetricas): ItemMetrica {
  return {
    id: a.id, nome: a.nome, subtitulo: a.campanhaNome || undefined,
    // cliques REAIS do insight — reconstruir de impressões×CTR arredondado distorcia contagens e somas
    investimento: a.gasto, impressoes: a.impressoes, cliques: a.cliques,
    ctr: a.ctr, cpm: a.cpm, compras: a.compras, valorGerado: a.valorGerado,
    roas: a.roas, cac: a.cac, seguidores: a.seguidores ?? 0,
    ativo: a.ativo ?? false,
    // pageView REAL agora vem do insight — sem mapear, a coluna Connect Rate e o
    // eixo Page View do scatter zeravam a aba inteira com dado disponível
    pageView: a.pageView, connectRate: a.cliques > 0 ? (a.pageView / a.cliques) * 100 : 0,
  }
}

// ─── Tabela ───────────────────────────────────────────────────────────────────

type SortKey = keyof ItemMetrica | 'quadrante'

function TabelaItens({
  dados, selecionado, onSelect,
}: {
  dados: (ItemMetrica & { quadrante: Quadrante })[]
  selecionado: string
  onSelect: (id: string) => void
}) {
  const [sortK, setSortK] = useState<SortKey>('investimento')
  const [sortD, setSortD] = useState<'desc' | 'asc'>('desc')

  const sorted = useMemo(() => {
    return [...dados].sort((a, b) => {
      if (sortK === 'nome') {
        const cmp = a.nome.localeCompare(b.nome, 'pt-BR')
        return sortD === 'asc' ? cmp : -cmp
      }
      const va = (a as unknown as Record<string, unknown>)[sortK as string]
      const vb = (b as unknown as Record<string, unknown>)[sortK as string]
      const na = typeof va === 'number' ? va : 0
      const nb = typeof vb === 'number' ? vb : 0
      return sortD === 'desc' ? nb - na : na - nb
    })
  }, [dados, sortK, sortD])

  function th(label: string, key: SortKey) {
    const ativo = sortK === key
    return (
      <th
        key={String(key)}
        onClick={() => { if (ativo) setSortD(d => d === 'desc' ? 'asc' : 'desc'); else { setSortK(key); setSortD('desc') } }}
        style={{ padding: '0.55rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right', whiteSpace: 'nowrap', backgroundColor: 'var(--color-bg-secondary)', cursor: 'pointer', userSelect: 'none', color: ativo ? 'var(--color-ponto-conversao)' : 'var(--color-text-muted)' }}>
        {label} {ativo ? (sortD === 'desc' ? '↓' : '↑') : <span style={{ opacity: 0.2, fontSize: '0.6rem' }}>↕</span>}
      </th>
    )
  }

  const cols: [string, SortKey, (d: ItemMetrica & { quadrante: Quadrante }) => string][] = [
    ['Quadrante', 'quadrante', d => Q_LABEL[d.quadrante]],
    ['Investimento', 'investimento', d => brl(d.investimento)],
    ['Impressões', 'impressoes', d => num(d.impressoes)],
    ['CPM', 'cpm', d => brl(d.cpm)],
    ['CTR', 'ctr', d => pct(d.ctr)],
    ['Cliques', 'cliques', d => num(d.cliques)],
    ['Connect Rate', 'connectRate', d => d.connectRate != null ? pct(d.connectRate) : '—'],
    ['Seguidores', 'seguidores', d => num(d.seguidores)],
    ['Compras', 'compras', d => num(d.compras)],
    ['Valor Gerado', 'valorGerado', d => brl(d.valorGerado)],
    ['ROAS', 'roas', d => d.roas > 0 ? `${d.roas.toFixed(2)}x` : '—'],
    ['CAC', 'cac', d => d.cac > 0 ? brl(d.cac) : '—'],
  ]

  return (
    <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border-default)' }}>
              <th style={{ padding: '0.55rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', minWidth: '200px' }}>
                Nome
              </th>
              {cols.map(([label, key]) => th(label, key))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((d, i) => {
              const ativo = selecionado === d.id
              const bg = ativo ? 'rgba(95,138,60,0.08)' : i % 2 === 0 ? 'transparent' : 'rgba(28,28,26,0.02)'
              return (
                <tr key={d.id} onClick={() => onSelect(d.id)} style={{ borderBottom: '1px solid var(--color-border-subtle)', backgroundColor: bg, cursor: 'pointer', transition: 'background 0.1s' }}>
                  <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--color-text-primary)', maxWidth: '260px' }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.nome}>{d.nome}</div>
                    {d.subtitulo && <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.subtitulo}</div>}
                  </td>
                  {cols.map(([, key, format]) => (
                    <td key={key as string} style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.82rem', textAlign: 'right', whiteSpace: 'nowrap', color: key === 'quadrante' ? Q_COR[d.quadrante] : 'var(--color-text-primary)' }}>
                      {format(d)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--color-border-default)', backgroundColor: 'var(--color-bg-tertiary)' }}>
                <td style={{ padding: '0.55rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {sorted.length} itens
                </td>
                {cols.map(([, key]) => {
                  const sum = (fn: (d: ItemMetrica) => number) => sorted.reduce((s, d) => s + fn(d), 0)
                  let v = '—'
                  if (key === 'investimento') v = brl(sum(d => d.investimento))
                  else if (key === 'impressoes') v = num(sum(d => d.impressoes))
                  else if (key === 'cliques') v = num(sum(d => d.cliques))
                  else if (key === 'compras') v = num(sum(d => d.compras))
                  else if (key === 'valorGerado') v = brl(sum(d => d.valorGerado))
                  else if (key === 'cpm') {
                    const inv = sum(d => d.investimento); const imp = sum(d => d.impressoes)
                    v = imp > 0 ? brl(((inv / imp) * 1000)) : '—'
                  } else if (key === 'ctr') {
                    const cli = sum(d => d.cliques); const imp = sum(d => d.impressoes)
                    v = imp > 0 ? pct((cli / imp) * 100) : '—'
                  } else if (key === 'roas') {
                    const inv = sum(d => d.investimento); const vg = sum(d => d.valorGerado)
                    v = inv > 0 ? `${(vg / inv).toFixed(2)}x` : '—'
                  } else if (key === 'cac') {
                    const inv = sum(d => d.investimento); const cp = sum(d => d.compras)
                    v = cp > 0 ? brl(inv / cp) : '—'
                  } else if (key === 'seguidores') {
                    // Aditiva — total '—' sob células preenchidas contradizia a coluna
                    const seg = sum(d => d.seguidores)
                    v = seg > 0 ? num(seg) : '—'
                  } else if (key === 'connectRate') {
                    const pv = sum(d => d.pageView ?? 0); const cli = sum(d => d.cliques)
                    v = cli > 0 && pv > 0 ? pct((pv / cli) * 100) : '—'
                  } else if (key === 'pageView') {
                    const pv = sum(d => d.pageView ?? 0)
                    v = pv > 0 ? num(pv) : '—'
                  }
                  return <td key={key as string} style={{ padding: '0.55rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 600, textAlign: 'right', color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>{v}</td>
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function AnalisePublicos({
  campanhas, publicos, anuncios, de: deInicial, ate: ateInicial,
}: {
  campanhas: CampanhaComMetricas[]
  publicos: PublicoComMetricas[]
  anuncios: CriativoMetricas[]
  de?: string
  ate?: string
}) {
  const router = useRouter()
  const [aba, setAba]                         = useState<Aba>('publicos')
  const [filtroQ, setFiltroQ]                 = useState<string>('todos')
  const [selecionado, setSel]                 = useState<string>('')
  const [metricaXKey, setMetricaXKey]         = useState('ctr')
  const [metricaYKey, setMetricaYKey]         = useState('roas')
  const [de, setDe]                           = useState(deInicial ?? '')
  const [ate, setAte]                         = useState(ateInicial ?? '')
  const [filtroFunil, setFiltroFunil] = useState<FiltroState>(FILTRO_PADRAO)

  useEffect(() => {
    if (!de || !ate || (de === deInicial && ate === ateInicial)) return
    const params = new URLSearchParams({ de, ate })
    router.push(`/dashboard/publicos?${params.toString()}`)
  }, [de, ate, deInicial, ateInicial, router])

  const dadosBrutos = useMemo((): (ItemMetrica & { quadrante: Quadrante })[] => {
    const f = filtroFunil

    // As tags de Corredor (C1/C2/C3) e Objetivo (VENDAS/LEADS/CPT) só existem no
    // NOME DA CAMPANHA — nunca no nome do conjunto/anúncio. Por isso casamos sempre
    // contra o nome da campanha, em qualquer aba.
    const passaTags = (campanhaNome: string) => {
      if (f.corredor.length > 0 && !f.corredor.some(t => campanhaNome.includes(`[${t}]`))) return false
      if (f.objetivo.length > 0 && !f.objetivo.some(t => campanhaNome.includes(`[${t}]`))) return false
      return true
    }
    // Busca livre (contém/não contém/exatamente) casa contra o nome próprio do item
    // OU o nome da campanha — o que for mais útil para o usuário localizar.
    const passaTexto = (nomeProprio: string, campanhaNome: string) => {
      const alvo = `${nomeProprio} ${campanhaNome}`.toLowerCase()
      if (f.contem && !alvo.includes(f.contem.toLowerCase())) return false
      if (f.naoContem && alvo.includes(f.naoContem.toLowerCase())) return false
      if (f.exatamente) {
        const ex = f.exatamente.toLowerCase()
        if (nomeProprio.toLowerCase() !== ex && campanhaNome.toLowerCase() !== ex) return false
      }
      return true
    }

    let base: ItemMetrica[]
    if (aba === 'campanhas') {
      base = campanhas.filter(c => {
        if (f.teveVeiculacao && c.impressoes === 0) return false
        if (f.ativoCampanha && !(c.ativa ?? false)) return false
        return passaTags(c.nome) && passaTexto(c.nome, c.nome)
      }).map(campanhaToItem)
    } else if (aba === 'publicos') {
      base = publicos.filter(p => {
        if (f.teveVeiculacao && p.impressoes === 0) return false
        if (f.ativoConjunto && !p.ativo) return false
        return passaTags(p.campanhaNome) && passaTexto(p.nome, p.campanhaNome)
      }).map(publicoToItem)
    } else {
      base = anuncios.filter(a => {
        if (f.teveVeiculacao && a.impressoes === 0) return false
        if (f.ativoAnuncio && !a.ativo) return false
        return passaTags(a.campanhaNome ?? '') && passaTexto(a.nome, a.campanhaNome ?? '')
      }).map(anuncioToItem)
    }

    // Régua relativa: cada item é "acima"/"abaixo" da média de CTR DESTA aba
    // (ponderada por impressões). Sem amostra mínima → "novo".
    const mediaCtr = ctrMedioPonderado(base)
    return base.map(d => ({
      ...d,
      quadrante: classificarPorMedia(d.ctr, mediaCtr, d.impressoes >= MIN_IMPRESSOES_AMOSTRA),
    }))
  }, [aba, campanhas, publicos, anuncios, filtroFunil])

  const dados = useMemo(() => {
    if (filtroQ === 'todos') return dadosBrutos
    return dadosBrutos.filter(d => d.quadrante === filtroQ)
  }, [dadosBrutos, filtroQ])

  const biblioteca = useMetricLibrary()
  const metricasDisponiveis = useMemo((): MetricaDef[] => [
    ...METRICAS_BASE,
    ...biblioteca
      .filter(m => m.scope === 'global' || m.scope === 'publicos')
      .map((m): MetricaDef => ({
        key: `custom:${m.id}`,
        label: m.name,
        grupo: m.group || 'Customizadas',
        formatRaw: v => formatMetricValue(v, m.format),
        getValue: d => evaluateFormula(m.formula, withFormulaAliases(d as unknown as Record<string, unknown>)) ?? 0,
      })),
  ], [biblioteca])

  const metricaXDef = useMemo(
    () => metricasDisponiveis.find(m => m.key === metricaXKey) ?? metricasDisponiveis[0],
    [metricasDisponiveis, metricaXKey],
  )
  const metricaYDef = useMemo(
    () => metricasDisponiveis.find(m => m.key === metricaYKey) ?? metricasDisponiveis[0],
    [metricasDisponiveis, metricaYKey],
  )

  const getX = useCallback((d: ItemMetrica) => metricaXDef.getValue(d), [metricaXDef])
  const getY = useCallback((d: ItemMetrica) => metricaYDef.getValue(d), [metricaYDef])

  const mediaX = useMemo(() => {
    const vals = dados.map(getX).filter(v => v > 0)
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
  }, [dados, getX])

  const mediaY = useMemo(() => {
    const vals = dados.map(getY).filter(v => v > 0)
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
  }, [dados, getY])

  const scatterData = useMemo(() => dados.map(d => ({
    ...d,
    x: getX(d),
    y: getY(d),
    z: Math.max(d.investimento, 10),
  })), [dados, getX, getY])

  const abaLabel: Record<Aba, string> = {
    campanhas: 'Campanhas',
    publicos:  'Públicos',
    anuncios:  'Anúncios',
  }

  const btnAba = (a: Aba) => (
    <button
      key={a}
      onClick={() => { setAba(a); setSel(''); setFiltroQ('todos') }}
      style={{
        padding: '0.45rem 1rem', fontFamily: 'var(--font-body)', fontSize: '0.82rem',
        fontWeight: aba === a ? 600 : 400,
        color: aba === a ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
        background: 'none', border: 'none', borderBottom: aba === a ? '2px solid var(--color-ponto-conversao)' : '2px solid transparent',
        cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
      }}>
      {abaLabel[a]} <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
        ({a === 'campanhas' ? campanhas.length : a === 'publicos' ? publicos.length : anuncios.length})
      </span>
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '2rem', minHeight: '100%' }}>

      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
            Públicos & Campanhas
          </h1>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Análise de desempenho por campanha, conjunto de anúncios e anúncio
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <FiltroFunil filtro={filtroFunil} onChange={setFiltroFunil} />
          <SeletorPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} />
        </div>
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border-subtle)', gap: 0 }}>
        {(['campanhas', 'publicos', 'anuncios'] as Aba[]).map(btnAba)}
      </div>

      {/* Gráfico de dispersão */}
      <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', padding: '1.25rem' }}>

        {/* Controles do gráfico */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <SeletorEixo rotulo="Eixo X" atual={metricaXDef} metricas={metricasDisponiveis} onSelect={setMetricaXKey} />
            <SeletorEixo rotulo="Eixo Y" atual={metricaYDef} metricas={metricasDisponiveis} onSelect={setMetricaYKey} />
          </div>

          {/* Filtro quadrante */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {(['todos', 'acima', 'abaixo', 'novo'] as const).map(q => (
              <button
                key={q}
                onClick={() => setFiltroQ(q)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.3rem',
                  padding: '0.2rem 0.55rem', fontFamily: 'var(--font-body)', fontSize: '0.72rem',
                  borderRadius: '4px', border: '1px solid var(--color-border-subtle)', cursor: 'pointer',
                  backgroundColor: filtroQ === q ? (q === 'todos' ? 'var(--color-bg-tertiary)' : Q_COR[q as Quadrante]) : 'transparent',
                  color: filtroQ === q ? (q === 'todos' ? 'var(--color-text-primary)' : '#fff') : (q === 'todos' ? 'var(--color-text-secondary)' : Q_COR[q as Quadrante]),
                  opacity: filtroQ !== 'todos' && filtroQ !== q ? 0.45 : 1,
                }}>
                {q === 'todos' ? 'Todos' : Q_LABEL[q as Quadrante]}
              </button>
            ))}
          </div>
        </div>

        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem', marginTop: 0 }}>
          Tamanho da bolha = Investimento · Linhas tracejadas = média
        </p>

        <ResponsiveContainer width="100%" height={380}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(28,28,26,0.05)" />
            <XAxis
              type="number" dataKey="x" name={metricaXDef.label}
              label={{ value: metricaXDef.label, position: 'insideBottom', offset: -12, fill: 'var(--color-text-muted)', fontFamily: 'var(--font-body)', fontSize: 11 }}
              tick={{ fill: 'var(--color-text-muted)', fontFamily: 'var(--font-body)', fontSize: 11 }}
              tickLine={false} axisLine={{ stroke: 'var(--color-border-subtle)' }}
            />
            <YAxis
              type="number" dataKey="y" name={metricaYDef.label}
              label={{ value: metricaYDef.label, angle: -90, position: 'insideLeft', fill: 'var(--color-text-muted)', fontFamily: 'var(--font-body)', fontSize: 11, dx: -4 }}
              tick={{ fill: 'var(--color-text-muted)', fontFamily: 'var(--font-body)', fontSize: 11 }}
              tickLine={false} axisLine={{ stroke: 'var(--color-border-subtle)' }}
            />
            <ZAxis type="number" dataKey="z" range={[40, 1200]} />
            <Tooltip content={<BubbleTooltip metricaXDef={metricaXDef} metricaYDef={metricaYDef} />} />
            {mediaX > 0 && <ReferenceLine x={mediaX} stroke="rgba(28,28,26,0.25)" strokeDasharray="4 4" />}
            {mediaY > 0 && <ReferenceLine y={mediaY} stroke="rgba(28,28,26,0.25)" strokeDasharray="4 4" />}
            {(['acima', 'abaixo', 'novo'] as Quadrante[]).map(q => {
              const pts = scatterData.filter(d => d.quadrante === q)
              if (!pts.length) return null
              return (
                <Scatter
                  key={q}
                  name={Q_LABEL[q]}
                  data={pts}
                  fill={Q_COR[q]}
                  fillOpacity={0.75}
                  stroke={Q_COR[q]}
                  strokeWidth={1}
                  onClick={(d: unknown) => { const item = d as { id: string }; setSel(prev => prev === item.id ? '' : item.id) }}
                />
              )
            })}
          </ScatterChart>
        </ResponsiveContainer>

        {/* Legenda */}
        <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center', marginTop: '0.5rem' }}>
          {(['acima', 'abaixo', 'novo'] as Quadrante[]).map(q => (
            <div key={q} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: Q_COR[q] }} />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{Q_LABEL[q]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tabela */}
      <TabelaItens dados={dados} selecionado={selecionado} onSelect={id => setSel(prev => prev === id ? '' : id)} />

    </div>
  )
}
