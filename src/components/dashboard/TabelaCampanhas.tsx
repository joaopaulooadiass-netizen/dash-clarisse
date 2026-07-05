'use client'

import { useState, useMemo } from 'react'
import type { EstruturaCampanha } from '@/lib/meta/campanhas'
import { useMetricLibrary } from '@/components/metrics/MetricLibraryPanel'
import { evaluateFormula, formatMetricValue, withFormulaAliases } from '@/lib/metrics/library'
import { derivarMetricas } from '@/lib/metrics/derivar'
import { getDefaultMetricKeys, getMetricLabel, getMetricsForScope, type MetricFormat } from '@/lib/config/metrics'

// ─── Interface pública ────────────────────────────────────────────────────────

export interface CampanhaComMetricas {
  id: string
  nome: string
  temperatura: 'fundo' | 'quente' | 'neutro'
  tag: string | null
  ativa?: boolean
  impressoes: number
  cpm: number
  ctr: number
  cliques: number
  connectRate: number
  pctCheckout: number
  pctCompras: number
  compras: number
  valorGerado: number
  investimento: number
  roas: number
  cac: number
  tsr?: number | null
  retencao75?: number | null
  cpv75?: number | null
  cpv95?: number | null
  pageView?: number | null
  custoPorPageView?: number | null
  custoConnect?: number | null
  seguidores?: number | null
  custoSeguidores?: number | null
  leads?: number | null
  viewContent?: number | null
  inicioCheckout?: number | null
  resultado?: number | null   // contagem do evento que a campanha otimiza (Resultado dinâmico)
  objetivo?: string | null    // rótulo do objetivo predominante ('Conversões', 'Misto'...)
  unidadeResultado?: string | null // evento contado no Resultado ('purchase', 'lead', 'misto'...)
}

// ─── Tipos internos ───────────────────────────────────────────────────────────

type Sinal = 'bom' | 'ok' | 'ruim' | 'neutro'

type ColKey = string

interface ColInstancia {
  id: string
  key: ColKey
  label: string
  grupo: string
  fixo: boolean
  custom?: boolean
  getValue?: (c: CampanhaComMetricas) => number
  format?: (c: CampanhaComMetricas) => string
  metricFormat?: MetricFormat   // formato da métrica (linha de totais usa a unidade certa)
  invertido?: boolean
}

// ─── Semáforo ─────────────────────────────────────────────────────────────────

const COR: Record<Sinal, string> = {
  bom:    'var(--color-signal-green)',
  ok:     'var(--color-signal-yellow)',
  ruim:   'var(--color-signal-red)',
  neutro: 'var(--color-text-primary)',
}

const FUNDO: Record<Sinal, string> = {
  bom:    'rgba(95,138,60,0.10)',
  ok:     'rgba(232,190,11,0.10)',
  ruim:   'rgba(224,57,47,0.10)',
  neutro: 'transparent',
}

// Verde = direção boa vs média; Vermelho = direção ruim; Amarelo = outlier >2σ
// asc = maior é melhor; desc = menor é melhor
const DIRECAO: Partial<Record<ColKey, 'asc' | 'desc'>> = Object.fromEntries(
  getMetricsForScope('campanhas')
    .filter(m => m.colorized?.campanhas || m.invertido)
    .map(m => [m.key, m.invertido ? 'desc' : 'asc']),
)

interface EstatMetrica { media: number; desvio: number }

function calcularEstat(valores: number[]): EstatMetrica {
  const validos = valores.filter(v => v > 0)
  if (!validos.length) return { media: 0, desvio: 0 }
  const media = validos.reduce((s, v) => s + v, 0) / validos.length
  const desvio = Math.sqrt(validos.reduce((s, v) => s + Math.pow(v - media, 2), 0) / validos.length)
  return { media, desvio }
}

function avaliar(key: ColKey, valor: number, estat: EstatMetrica | undefined): Sinal {
  if (!estat) return 'neutro'
  if (!valor || !estat.media) return 'neutro'
  const direcao = DIRECAO[key]
  if (!direcao) return 'neutro'
  if (estat.desvio > 0 && Math.abs(valor - estat.media) > 2 * estat.desvio) return 'ok'
  return direcao === 'asc'
    ? valor >= estat.media ? 'bom' : 'ruim'
    : valor <= estat.media ? 'bom' : 'ruim'
}

function avaliarCustom(valor: number, estat: EstatMetrica | undefined, invertido: boolean): Sinal {
  if (!estat || !valor || !estat.media) return 'neutro'
  if (estat.desvio > 0 && Math.abs(valor - estat.media) > 2 * estat.desvio) return 'ok'
  return invertido
    ? valor <= estat.media ? 'bom' : 'ruim'
    : valor >= estat.media ? 'bom' : 'ruim'
}

// ─── Formatação ───────────────────────────────────────────────────────────────

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function pct(v: number) { return `${v.toFixed(2)}%` }
function num(v: number) { return v.toLocaleString('pt-BR') }

// Sinônimos centralizados na biblioteca (withFormulaAliases): a mesma fórmula
// custom tem que dar o MESMO resultado em qualquer tela
function formulaRow(c: CampanhaComMetricas): Record<string, unknown> {
  return withFormulaAliases(c as unknown as Record<string, unknown>)
}

function valorPadrao(c: CampanhaComMetricas, key: ColKey): number {
  const value = (c as unknown as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// Custos que o row do server não traz prontos — célula, ORDENAÇÃO e semáforo
// derivam pela MESMA função (o sort chegou a ordenar por 0 fixo enquanto a
// célula mostrava o valor derivado). null = base zerada → '—' na célula.
const custoConnectDe = (c: CampanhaComMetricas): number | null =>
  c.custoConnect ?? (c.pageView ? c.investimento / c.pageView : null)
const custoPorPageViewDe = (c: CampanhaComMetricas): number | null =>
  c.custoPorPageView ?? (c.pageView ? c.investimento / c.pageView : null)
const custoSeguidoresDe = (c: CampanhaComMetricas): number | null =>
  c.custoSeguidores ?? (c.seguidores ? c.investimento / c.seguidores : null)

// ─── Sistema de instâncias de colunas ─────────────────────────────────────────

const TODAS_INSTANCIAS: ColInstancia[] = [
  { id: 'nome', key: 'nome', label: 'Campaign Name', grupo: 'Fixas', fixo: true },
  { id: 'conjuntos', key: 'conjuntos', label: 'Conjuntos', grupo: 'Estrutura', fixo: false },
  { id: 'anuncios', key: 'anuncios', label: 'Anúncios', grupo: 'Estrutura', fixo: false },
  ...getMetricsForScope('campanhas').map(m => ({
    id: m.key,
    key: m.key,
    label: getMetricLabel(m, 'campanhas'),
    grupo: m.group,
    fixo: false,
    invertido: m.invertido,
    getValue: (c: CampanhaComMetricas) => m.getValue(formulaRow(c)),
    format: (c: CampanhaComMetricas) => formatMetricValue(m.getValue(formulaRow(c)), m.format),
    metricFormat: m.format,
  })),
]

const IDS_PADRAO = getDefaultMetricKeys('campanhas')

const PADRAO_COLORIDAS: ColKey[] = getMetricsForScope('campanhas')
  .filter(m => m.colorized?.campanhas)
  .map(m => m.key)

const COR_GRUPO: Record<string, string> = {
  Fixas:      'var(--color-text-secondary)',
  Veiculação: 'var(--color-text-muted)',
  Página:     '#5C79C9',
  Conversão:  'var(--color-signal-yellow)',
  Estrutura:  'var(--color-text-muted)',
}

// ─── Célula ───────────────────────────────────────────────────────────────────

function Celula({ v, s = 'neutro', muted }: { v: string; s?: Sinal; muted?: boolean }) {
  return (
    <td style={{
      padding: '0.55rem 0.75rem',
      fontFamily: 'var(--font-body)',
      fontSize: '0.84rem',
      color: muted ? 'var(--color-text-muted)' : COR[s],
      backgroundColor: FUNDO[s],
      textAlign: 'right',
      whiteSpace: 'nowrap',
    }}>
      {v}
    </td>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  campanhas: CampanhaComMetricas[]
  estrutura?: Record<string, EstruturaCampanha>
  isAdmin?: boolean
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function TabelaCampanhas({ campanhas, estrutura, isAdmin = false }: Props) {
  const [colIds, setColIds]       = useState<string[]>(IDS_PADRAO)
  const [dragId, setDragId]       = useState<string | null>(null)
  const [dragOver, setDragOver]   = useState<string | null>(null)
  const [configAberto, setConfig] = useState(false)
  const [coloridas, setColoridas] = useState<Set<ColKey>>(new Set(PADRAO_COLORIDAS))
  const [sortKey, setSortKey]     = useState<ColKey | null>(null)
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('desc')
  const metricasBiblioteca = useMetricLibrary()

  const todasInstancias = useMemo((): ColInstancia[] => {
    const custom = metricasBiblioteca
      .filter(m => m.scope === 'global' || m.scope === 'campanhas')
      .map((m): ColInstancia => ({
        id: `custom:${m.id}`,
        key: `custom:${m.id}`,
        label: m.name,
        grupo: m.group || 'Customizadas',
        fixo: false,
        custom: true,
        invertido: m.invertido,
        getValue: c => evaluateFormula(m.formula, formulaRow(c)) ?? 0,
        format: c => formatMetricValue(evaluateFormula(m.formula, formulaRow(c)), m.format),
        metricFormat: m.format,
      }))
    return [...TODAS_INSTANCIAS, ...custom]
  }, [metricasBiblioteca])

  // ── Ordenação ──────────────────────────────────────────────────────────────

  function toggleSort(key: ColKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  function sortIndicador(key: ColKey) {
    if (sortKey !== key) return <span style={{ opacity: 0.2, fontSize: '0.6rem' }}>↕</span>
    return <span style={{ fontSize: '0.65rem', color: 'var(--color-ponto-conversao)' }}>{sortDir === 'desc' ? '↓' : '↑'}</span>
  }

  // ── Gerenciamento de colunas ───────────────────────────────────────────────

  function toggleInstancia(id: string) {
    const inst = todasInstancias.find(c => c.id === id)!
    if (inst.fixo) return
    setColIds(prev => {
      if (prev.includes(id)) return prev.filter(i => i !== id)
      // Colunas de estrutura sempre respeitam ordem fixa: nome → conjuntos → anuncios
      if (id === 'conjuntos' || id === 'anuncios') {
        const arr = [...prev]
        if (id === 'conjuntos') {
          const nomeIdx = arr.indexOf('nome')
          arr.splice(nomeIdx + 1, 0, id)
        } else {
          const conjIdx = arr.indexOf('conjuntos')
          const nomeIdx = arr.indexOf('nome')
          arr.splice((conjIdx !== -1 ? conjIdx : nomeIdx) + 1, 0, id)
        }
        return arr
      }
      return [...prev, id]
    })
  }

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return
    setColIds(p => {
      const arr = [...p]
      const from = arr.indexOf(dragId)
      const to   = arr.indexOf(targetId)
      if (from === -1 || to === -1) return p
      arr.splice(from, 1)
      arr.splice(to, 0, dragId)
      return arr
    })
    setDragId(null)
    setDragOver(null)
  }

  function tudo() { setColIds(todasInstancias.map(c => c.id)) }
  function desmarcar() { setColIds(todasInstancias.filter(c => c.fixo).map(c => c.id)) }

  // ── Dados ordenados ────────────────────────────────────────────────────────

  const dados = useMemo((): CampanhaComMetricas[] => {
    if (!sortKey) return campanhas
    return [...campanhas].sort((a, b) => {
      const val = (c: CampanhaComMetricas): number => {
        switch (sortKey) {
          case 'nome':             return 0
          case 'impressoes':       return c.impressoes
          case 'cpm':              return c.cpm
          case 'ctr':              return c.ctr
          case 'cliques':          return c.cliques
          case 'tsr':              return c.tsr ?? 0
          case 'retencao75':       return c.retencao75 ?? 0
          case 'cpv75':            return c.cpv75 ?? 0
          case 'cpv95':            return c.cpv95 ?? 0
          case 'connectRate':      return c.connectRate
          case 'custoConnect':     return custoConnectDe(c) ?? 0
          case 'pageView':         return c.pageView ?? 0
          case 'custoPorPageView': return custoPorPageViewDe(c) ?? 0
          case 'pctCheckout':      return c.pctCheckout
          case 'pctCompras':       return c.pctCompras
          case 'vendas':           return c.resultado ?? 0
          case 'compras':          return c.compras
          case 'valorGerado':      return c.valorGerado
          case 'investimento':     return c.investimento
          case 'roas':             return c.roas
          case 'cac':              return c.cac
          case 'seguidores':       return c.seguidores ?? 0
          case 'custoSeguidores':  return custoSeguidoresDe(c) ?? 0
          default: {
            const inst = todasInstancias.find(c => c.key === sortKey)
            return inst?.getValue ? inst.getValue(c) : valorPadrao(c, sortKey)
          }
        }
      }
      if (sortKey === 'nome') {
        const cmp = a.nome.localeCompare(b.nome, 'pt-BR')
        return sortDir === 'asc' ? cmp : -cmp
      }
      return sortDir === 'desc' ? val(b) - val(a) : val(a) - val(b)
    })
  }, [campanhas, sortKey, sortDir, todasInstancias])

  // ── Colunas ativas na ordem do usuário ────────────────────────────────────

  const cols = colIds
    .map(id => todasInstancias.find(c => c.id === id))
    .filter(Boolean) as ColInstancia[]

  // ── Estatísticas para semáforo ────────────────────────────────────────────

  const stats = useMemo((): Partial<Record<ColKey, EstatMetrica>> => {
    const e = (fn: (c: CampanhaComMetricas) => number) => calcularEstat(dados.map(fn))
    return {
      impressoes:       e(c => c.impressoes),
      cpm:              e(c => c.cpm),
      ctr:              e(c => c.ctr),
      cliques:          e(c => c.cliques),
      tsr:              e(c => c.tsr ?? 0),
      retencao75:       e(c => c.retencao75 ?? 0),
      cpv75:            e(c => c.cpv75 ?? 0),
      cpv95:            e(c => c.cpv95 ?? 0),
      connectRate:      e(c => c.connectRate),
      custoConnect:     e(c => custoConnectDe(c) ?? 0),
      pageView:         e(c => c.pageView ?? 0),
      custoPorPageView: e(c => custoPorPageViewDe(c) ?? 0),
      pctCheckout:      e(c => c.pctCheckout),
      pctCompras:       e(c => c.pctCompras),
      compras:          e(c => c.compras),
      valorGerado:      e(c => c.valorGerado),
      investimento:     e(c => c.investimento),
      roas:             e(c => c.roas),
      cac:              e(c => c.cac),
      seguidores:       e(c => c.seguidores ?? 0),
      custoSeguidores:  e(c => custoSeguidoresDe(c) ?? 0),
    }
  }, [dados])

  // ── Renderizar célula de dados ─────────────────────────────────────────────

  function celula(c: CampanhaComMetricas, key: ColKey, instId: string) {
    const s = (k: ColKey, v: number): Sinal => coloridas.has(k) ? avaliar(k, v, stats[k]) : 'neutro'
    const nulo = (v: number | null | undefined, render: () => React.ReactNode) =>
      v == null ? <Celula key={instId} v="—" muted /> : render() as React.ReactElement

    switch (key) {
      case 'nome': {
        return (
          <td key={instId} style={{ padding: '0.55rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.84rem', color: 'var(--color-text-primary)', whiteSpace: 'nowrap', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span title={c.nome} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nome}</span>
              {c.tag && <span style={{ flexShrink: 0, fontSize: '0.6rem', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)', borderRadius: '3px', padding: '0 4px' }}>{c.tag}</span>}
            </div>
          </td>
        )
      }
      case 'conjuntos': {
        const est = estrutura?.[c.id]
        if (!est || est.conjuntos.length === 0) return <Celula key={instId} v="—" muted />
        const mostrar = est.conjuntos.slice(0, 3)
        const resto = est.conjuntos.length - 3
        return (
          <td key={instId} style={{ padding: '0.45rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--color-text-secondary)', minWidth: '160px', maxWidth: '240px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {mostrar.map(cj => (
                <div key={cj.id} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', overflow: 'hidden' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', flexShrink: 0, backgroundColor: cj.ativo ? 'var(--color-signal-green)' : 'var(--color-text-muted)' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cj.nome}>{cj.nome}</span>
                </div>
              ))}
              {resto > 0 && <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>+{resto} mais</span>}
            </div>
          </td>
        )
      }
      case 'anuncios': {
        const est = estrutura?.[c.id]
        if (!est || est.anuncios.length === 0) return <Celula key={instId} v="—" muted />
        const mostrar = est.anuncios.slice(0, 3)
        const resto = est.anuncios.length - 3
        return (
          <td key={instId} style={{ padding: '0.45rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--color-text-secondary)', minWidth: '160px', maxWidth: '280px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {mostrar.map(an => (
                <div key={an.id} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', overflow: 'hidden' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', flexShrink: 0, backgroundColor: an.ativo ? 'var(--color-signal-green)' : 'var(--color-text-muted)' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={an.nome}>{an.nome}</span>
                </div>
              ))}
              {resto > 0 && <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>+{resto} mais</span>}
            </div>
          </td>
        )
      }
      case 'impressoes':    return <Celula key={instId} v={num(c.impressoes)} muted />
      case 'cpm':           return <Celula key={instId} v={brl(c.cpm)} s={s('cpm', c.cpm)} />
      case 'ctr':           return <Celula key={instId} v={pct(c.ctr)} s={s('ctr', c.ctr)} />
      case 'cliques':       return <Celula key={instId} v={num(c.cliques)} muted />
      case 'tsr':           return nulo(c.tsr, () => <Celula key={instId} v={pct(c.tsr!)} s={s('tsr', c.tsr!)} />)
      case 'retencao75':    return nulo(c.retencao75, () => <Celula key={instId} v={pct(c.retencao75!)} s={s('retencao75', c.retencao75!)} />)
      case 'cpv75':         return nulo(c.cpv75, () => <Celula key={instId} v={brl(c.cpv75!)} s={s('cpv75', c.cpv75!)} />)
      case 'cpv95':         return nulo(c.cpv95, () => <Celula key={instId} v={brl(c.cpv95!)} s={s('cpv95', c.cpv95!)} />)
      case 'connectRate':   return <Celula key={instId} v={pct(c.connectRate)} s={s('connectRate', c.connectRate)} />
      // Custos derivados: o row do server não traz o campo pronto — célula, sort e
      // semáforo usam os MESMOS helpers (antes a célula ficava '—' com total real,
      // e depois o sort ordenava por 0 fixo com a célula mostrando valor).
      case 'custoConnect': {
        const v = custoConnectDe(c)
        return nulo(v, () => <Celula key={instId} v={brl(v!)} s={s('custoConnect', v!)} />)
      }
      case 'pageView':      return nulo(c.pageView, () => <Celula key={instId} v={num(c.pageView!)} muted />)
      case 'custoPorPageView': {
        const v = custoPorPageViewDe(c)
        return nulo(v, () => <Celula key={instId} v={brl(v!)} s={s('custoPorPageView', v!)} />)
      }
      case 'pctCheckout':   return <Celula key={instId} v={pct(c.pctCheckout)} s={s('pctCheckout', c.pctCheckout)} />
      case 'pctCompras':    return <Celula key={instId} v={pct(c.pctCompras)} s={s('pctCompras', c.pctCompras)} />
      // Resultado dinâmico: null = a busca por adset FALHOU (rate limit) → '—'
      // honesto. O caminho da biblioteca (firstNumber) cairia em compras — unidade errada.
      case 'vendas':        return nulo(c.resultado, () => <Celula key={instId} v={num(c.resultado!)} s={s('vendas', c.resultado!)} />)
      case 'compras':       return <Celula key={instId} v={num(c.compras)} s={s('compras', c.compras)} />
      case 'valorGerado':   return <Celula key={instId} v={brl(c.valorGerado)} s={s('valorGerado', c.valorGerado)} />
      case 'investimento':  return <Celula key={instId} v={brl(c.investimento)} />
      case 'roas':             return <Celula key={instId} v={c.roas > 0 ? `${c.roas.toFixed(2)}x` : '—'} s={s('roas', c.roas)} />
      case 'cac':              return <Celula key={instId} v={c.cac > 0 ? brl(c.cac) : '—'} s={s('cac', c.cac)} />
      case 'seguidores':       return nulo(c.seguidores, () => <Celula key={instId} v={num(c.seguidores!)} s={s('seguidores', c.seguidores!)} />)
      case 'custoSeguidores': {
        const v = custoSeguidoresDe(c)
        return nulo(v, () => <Celula key={instId} v={brl(v!)} s={s('custoSeguidores', v!)} />)
      }
      default: {
        const inst = todasInstancias.find(col => col.id === instId || col.key === key)
        const value = inst?.getValue ? inst.getValue(c) : valorPadrao(c, key)
        const formatted = inst?.format ? inst.format(c) : num(value)
        const sinal = coloridas.has(key) && inst?.invertido != null
          ? avaliarCustom(value, calcularEstat(dados.map(row => inst.getValue ? inst.getValue(row) : valorPadrao(row, key))), inst.invertido)
          : 'neutro'
        return <Celula key={instId} v={formatted} s={sinal} />
      }
    }
  }

  // ── Linha de totais ────────────────────────────────────────────────────────

  function totalCol(key: ColKey): string {
    const sum = (fn: (c: CampanhaComMetricas) => number) => dados.reduce((s, c) => s + fn(c), 0)
    const avgF = (fn: (c: CampanhaComMetricas) => number) => {
      const fil = dados.filter(c => fn(c) > 0)
      return fil.length ? fil.reduce((s, c) => s + fn(c), 0) / fil.length : 0
    }

    switch (key) {
      case 'nome':             return `${dados.length} campanhas`
      case 'conjuntos':        return '—'
      case 'anuncios':         return '—'
      case 'impressoes':       return num(sum(c => c.impressoes))
      case 'cpm': {
        const imp = sum(c => c.impressoes); const inv = sum(c => c.investimento)
        return imp > 0 ? brl(((inv / imp) * 1000)) : '—'
      }
      case 'ctr': {
        const imp = sum(c => c.impressoes); const cli = sum(c => c.cliques)
        return imp > 0 ? pct((cli / imp) * 100) : '—'
      }
      case 'cliques':          return num(sum(c => c.cliques))
      case 'tsr':              return avgF(c => c.tsr ?? 0) > 0 ? pct(avgF(c => c.tsr ?? 0)) : '—'
      case 'retencao75':       return avgF(c => c.retencao75 ?? 0) > 0 ? pct(avgF(c => c.retencao75 ?? 0)) : '—'
      case 'cpv75':            return avgF(c => c.cpv75 ?? 0) > 0 ? brl(avgF(c => c.cpv75 ?? 0)) : '—'
      case 'cpv95':            return avgF(c => c.cpv95 ?? 0) > 0 ? brl(avgF(c => c.cpv95 ?? 0)) : '—'
      // Razões recomputadas das SOMAS (como CPM/CTR/ROAS): média simples de razões
      // por campanha distorce — campanha pequena pesa igual à grande.
      case 'connectRate': {
        const cli = sum(c => c.cliques); const pv = sum(c => c.pageView ?? 0)
        return cli > 0 ? pct((pv / cli) * 100) : '—'
      }
      case 'custoConnect': {
        const inv = sum(c => c.investimento); const pv = sum(c => c.pageView ?? 0)
        return pv > 0 ? brl(inv / pv) : '—'
      }
      case 'pageView':         return sum(c => c.pageView ?? 0) > 0 ? num(sum(c => c.pageView ?? 0)) : '—'
      case 'custoPorPageView': {
        const inv = sum(c => c.investimento); const pv = sum(c => c.pageView ?? 0)
        return pv > 0 ? brl(inv / pv) : '—'
      }
      case 'pctCheckout': {
        const ic = sum(c => c.inicioCheckout ?? 0); const pv = sum(c => c.pageView ?? 0)
        return pv > 0 ? pct((ic / pv) * 100) : '—'
      }
      case 'pctCompras': {
        const comp = sum(c => c.compras); const ic = sum(c => c.inicioCheckout ?? 0)
        return ic > 0 ? pct((comp / ic) * 100) : '—'
      }
      // Resultado é CONTAGEM, mas de unidade dinâmica (EVENTO que a campanha
      // otimiza). O rótulo do objetivo não basta: 'Conversões' cobre purchase,
      // lead, registro... Soma só quando a unidade é única, senão '— (misto)'.
      case 'vendas': {
        // Busca de resultados falhou em alguma campanha → sem total (a biblioteca
        // emprestaria compras — unidade errada)
        if (dados.some(c => c.resultado == null)) return '—'
        const unidades = new Set(dados.map(c => c.unidadeResultado).filter((u): u is string => Boolean(u) && u !== '—'))
        if (unidades.size > 1 || unidades.has('misto')) return '— (misto)'
        return num(sum(c => c.resultado ?? 0))
      }
      case 'compras':          return num(sum(c => c.compras))
      case 'valorGerado':      return brl(sum(c => c.valorGerado))
      case 'investimento':     return brl(sum(c => c.investimento))
      case 'roas': {
        const inv = sum(c => c.investimento); const vg = sum(c => c.valorGerado)
        return inv > 0 ? `${(vg / inv).toFixed(2)}x` : '—'
      }
      case 'cac': {
        const inv = sum(c => c.investimento); const comp = sum(c => c.compras)
        return comp > 0 ? brl(inv / comp) : '—'
      }
      case 'seguidores':      return num(sum(c => c.seguidores ?? 0))
      case 'custoSeguidores': {
        const inv = sum(c => c.investimento); const seg = sum(c => c.seguidores ?? 0)
        return seg > 0 ? brl((inv / seg)) : '—'
      }
      default: {
        const inst = todasInstancias.find(col => col.key === key)
        if (!inst) return '—'
        // Total = métrica recomputada sobre o período AGREGADO, pela fonte única
        // (mesma regra de CPM/CTR/ROAS acima). A média simples por campanha mentia
        // (média de razões ≠ razão das somas) e o filtro >0 descartava valores
        // negativos de métrica custom (ex.: lucro).
        const b = {
          gasto: sum(c => c.investimento), impressoes: sum(c => c.impressoes),
          cliques: sum(c => c.cliques), pageView: sum(c => c.pageView ?? 0),
          leads: sum(c => c.leads ?? 0), inicioCheckout: sum(c => c.inicioCheckout ?? 0),
          compras: sum(c => c.compras), valorGerado: sum(c => c.valorGerado),
          seguidores: sum(c => c.seguidores ?? 0), viewContent: sum(c => c.viewContent ?? 0),
        }
        const der = derivarMetricas(b)
        const rowTotais = {
          ...b, investimento: b.gasto,
          cpm: der.cpm, ctr: der.ctr, cpc: der.cpc, connectRate: der.connectRate,
          custoPorPageView: der.custoPorPageView, roas: der.roas, cac: der.cac,
          ticketMedio: der.ticketMedio, pctCheckout: der.pctCheckout, pctCompras: der.taxaConvIC,
          taxaConversao: der.taxaConvVendaLP, taxaConversaoClique: der.taxaConvClique,
          resultado: sum(c => c.resultado ?? 0),
        } as unknown as CampanhaComMetricas
        // Custom: format preserva '—' quando a fórmula não é calculável e mostra 0/negativo reais
        if (inst.custom && inst.format) return inst.format(rowTotais)
        const v = inst.getValue ? inst.getValue(rowTotais) : NaN
        // Biblioteca: div protegida devolve 0 = não calculável no agregado
        return Number.isFinite(v) && v !== 0 ? formatMetricValue(v, inst.metricFormat ?? 'number') : '—'
      }
    }
  }

  // ── Estilos reutilizáveis ──────────────────────────────────────────────────

  const btnBase: React.CSSProperties = {
    padding: '0.4rem 0.8rem',
    fontFamily: 'var(--font-body)',
    fontSize: '0.78rem',
    border: 'none',
    cursor: 'pointer',
    borderRight: '1px solid var(--color-border-subtle)',
  }

  const thBase: React.CSSProperties = {
    padding: '0.6rem 0.75rem',
    fontFamily: 'var(--font-body)',
    fontSize: '0.68rem',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    textAlign: 'right' as const,
    whiteSpace: 'nowrap' as const,
    backgroundColor: 'var(--color-bg-secondary)',
  }

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Barra de controles */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>

        {/* Colunas — só admin */}
        {isAdmin && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setConfig(!configAberto)}
              style={{ ...btnBase, borderRight: 'none', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)' }}>
              ⚙ Colunas ({cols.length})
            </button>

            {configAberto && (
              <div style={{ position: 'absolute', top: 'calc(100% + 0.5rem)', left: 0, zIndex: 50, backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 24px rgba(0,0,0,0.45)', width: '520px', maxHeight: '80vh', overflowY: 'auto', display: 'flex', gap: 0 }}>

                {/* Coluna esquerda — ordem das ativas (drag) */}
                <div style={{ flex: '0 0 220px', padding: '1rem', borderRight: '1px solid var(--color-border-subtle)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.25rem' }}>
                    Ordem da tabela
                  </p>
                  {colIds.map((id) => {
                    const col = todasInstancias.find(c => c.id === id)
                    if (!col) return null
                    const isDragging = dragId === id
                    const isOver     = dragOver === id
                    return (
                      <div
                        key={id}
                        draggable
                        onDragStart={() => setDragId(id)}
                        onDragOver={e => { e.preventDefault(); setDragOver(id) }}
                        onDragLeave={() => setDragOver(null)}
                        onDrop={() => onDrop(id)}
                        onDragEnd={() => { setDragId(null); setDragOver(null) }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.5rem',
                          padding: '0.35rem 0.5rem',
                          backgroundColor: isOver ? 'rgba(95,138,60,0.15)' : isDragging ? 'rgba(28,28,26,0.05)' : 'var(--color-bg-card)',
                          border: `1px solid ${isOver ? 'var(--color-ponto-conversao)' : 'var(--color-border-subtle)'}`,
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'grab',
                          opacity: isDragging ? 0.4 : 1,
                          transition: 'all 0.1s',
                        }}>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', userSelect: 'none' }}>⠿</span>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--color-text-primary)', flex: 1 }}>{col.label}</span>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: COR_GRUPO[col.grupo] ?? 'var(--color-text-muted)', opacity: 0.7 }}>{col.grupo}</span>
                        {!col.fixo && (
                          <button
                            onClick={() => toggleInstancia(id)}
                            style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>
                            ✕
                          </button>
                        )}
                      </div>
                    )
                  })}
                  <div style={{ marginTop: '0.25rem', display: 'flex', gap: '0.5rem' }}>
                    <button onClick={desmarcar} style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)', background: 'none', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', padding: '0.2rem 0.5rem', cursor: 'pointer' }}>Limpar</button>
                    <button onClick={tudo}      style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-ponto-conversao)', background: 'none', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', padding: '0.2rem 0.5rem', cursor: 'pointer' }}>Ver tudo</button>
                  </div>
                </div>

                {/* Coluna direita — adicionar métricas + cor */}
                <div style={{ flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Adicionar</p>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>ver</span>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: 'var(--color-signal-yellow)' }}>cor</span>
                    </div>
                  </div>

                  {Array.from(new Set(todasInstancias.filter(c => !c.fixo).map(c => c.grupo))).map(grupo => {
                    const itens = todasInstancias.filter(c => c.grupo === grupo)
                    if (!itens.length) return null
                    return (
                      <div key={grupo}>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: COR_GRUPO[grupo] ?? 'var(--color-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.3rem' }}>{grupo}</p>
                        {itens.map(col => {
                          const ativo = colIds.includes(col.id)
                          return (
                            <div key={col.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.18rem 0' }}>
                              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: ativo ? 'var(--color-text-primary)' : 'var(--color-text-muted)', flex: 1 }}>{col.label}</span>
                              <input
                                type="checkbox"
                                checked={ativo}
                                disabled={col.fixo}
                                onChange={() => toggleInstancia(col.id)}
                                style={{ accentColor: 'var(--color-ponto-conversao)', width: '13px', height: '13px', cursor: col.fixo ? 'default' : 'pointer', opacity: col.fixo ? 0.35 : 1 }}
                              />
                              <input
                                type="checkbox"
                                checked={coloridas.has(col.key)}
                                disabled={!ativo}
                                onChange={() => setColoridas(p => { const n = new Set(p); if (n.has(col.key)) n.delete(col.key); else n.add(col.key); return n })}
                                style={{ accentColor: 'var(--color-signal-yellow)', width: '13px', height: '13px', cursor: ativo ? 'pointer' : 'not-allowed', opacity: ativo ? 1 : 0.2 }}
                              />
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>

              </div>
            )}
          </div>
        )}

        {/* Semáforo */}
        <div style={{ marginLeft: isAdmin ? 'auto' : undefined, display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {([['bom', 'Acima da média'], ['ruim', 'Abaixo da média'], ['ok', 'Outlier']] as [Sinal, string][]).map(([s, label]) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: COR[s] }} />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tabela */}
      <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-default)', backgroundColor: 'var(--color-bg-secondary)' }}>
                {cols.map(col => (
                  <th
                    key={col.id}
                    onClick={() => toggleSort(col.key)}
                    style={{
                      ...thBase,
                      textAlign: col.key === 'nome' ? 'left' : 'right',
                      color: COR_GRUPO[col.grupo] ?? 'var(--color-text-muted)',
                      cursor: 'pointer',
                      userSelect: 'none',
                      minWidth: col.key === 'nome' ? '180px' : undefined,
                    }}>
                    {col.label} {sortIndicador(col.key)}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {/* Linha de dados */}
              {dados.map((c, i) => {
                const bg = i % 2 === 0 ? 'transparent' : 'rgba(28,28,26,0.02)'
                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border-subtle)', backgroundColor: bg }}>
                    {cols.map(col => celula(c, col.key, col.id))}
                  </tr>
                )
              })}

              {/* Linha de totais */}
              {dados.length > 0 && (
                <tr style={{ borderTop: '2px solid var(--color-border-default)', backgroundColor: 'var(--color-bg-tertiary)' }}>
                  {cols.map(col => {
                    const v = totalCol(col.key)
                    const isNome = col.key === 'nome'
                    return (
                      <td
                        key={col.id}
                        style={{
                          padding: '0.6rem 0.75rem',
                          fontFamily: 'var(--font-body)',
                          fontSize: isNome ? '0.7rem' : '0.82rem',
                          fontWeight: 600,
                          color: isNome ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
                          textAlign: isNome ? 'left' : 'right',
                          whiteSpace: 'nowrap',
                          textTransform: isNome ? 'uppercase' : undefined,
                          letterSpacing: isNome ? '0.06em' : undefined,
                        }}>
                        {v}
                      </td>
                    )
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
