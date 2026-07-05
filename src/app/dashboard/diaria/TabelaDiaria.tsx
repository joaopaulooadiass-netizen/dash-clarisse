'use client'

import { useState, useMemo } from 'react'
import type { MetricasCampanhaDia, MetricasFunilDia } from '@/lib/types'
import type { CampanhaMetricaDia } from '@/lib/meta/campanhas'
import { FiltroFunil, FiltroState, FILTRO_VAZIO, passaFiltroNome } from '@/components/dashboard/FiltroFunil'
import { SeletorPeriodo } from '@/components/ui/SeletorPeriodo'
import { hoje, subDias } from '@/lib/utils/data'
import { getDefaultMetricKeys, getMetricLabel, getMetricsForScope, type MetricDefinition } from '@/lib/config/metrics'
import { derivarMetricas } from '@/lib/metrics/derivar'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Sinal = 'bom' | 'ok' | 'ruim' | 'neutro'
type Agrupamento = 'diario' | 'semanal' | 'mensal'

interface Linha {
  rotulo: string
  dataRef: string
  investimento: number
  impressoes: number
  cpm: number
  ctr: number
  cliques: number
  cpc: number
  pageView: number | null      // Page Views (Connect Rate = pageView / cliques)
  leads: number | null         // Leads gerados
  conectados: number | null    // alias de leads (compatibilidade)
  vendas: number | null
  valorGerado: number | null
  seguidores: number | null
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

// ─── Semáforo relativo à média do período ────────────────────────────────────
// Verde  = na direção boa vs média
// Vermelho = na direção ruim vs média
// Amarelo = outlier estatístico (> 2σ da média — dia anômalo, investigar)
// Neutro  = métrica sem direção definida (impressões, cliques brutos)

const DIRECAO: Partial<Record<ColKey, 'asc' | 'desc'>> = Object.fromEntries(
  getMetricsForScope('diaria')
    .filter(m => m.colorized?.diaria || m.invertido)
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

  // Outlier: mais de 2 desvios padrão da média
  if (estat.desvio > 0 && Math.abs(valor - estat.media) > 2 * estat.desvio) return 'ok'

  return direcao === 'asc'
    ? valor >= estat.media ? 'bom' : 'ruim'
    : valor <= estat.media ? 'bom' : 'ruim'
}

// ─── Formatação ───────────────────────────────────────────────────────────────

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function pct(v: number) { return `${v.toFixed(2)}%` }


// Agrega linhas por campanha/dia (já filtradas) na visão da conta inteira:
// um MetricasCampanhaDia + um MetricasFunilDia por data.
function agregarPorDia(linhas: CampanhaMetricaDia[]): { metricas: MetricasCampanhaDia[]; funil: MetricasFunilDia[] } {
  const porData = new Map<string, {
    gasto: number; impressoes: number; cliques: number
    sessoes: number; leads: number; vendas: number; receita: number; seguidores: number
  }>()

  for (const l of linhas) {
    const acc = porData.get(l.data) ?? { gasto: 0, impressoes: 0, cliques: 0, sessoes: 0, leads: 0, vendas: 0, receita: 0, seguidores: 0 }
    acc.gasto      += l.gasto
    acc.impressoes += l.impressoes
    acc.cliques    += l.cliques
    acc.sessoes    += l.sessoes
    acc.leads      += l.leads
    acc.vendas     += l.vendas
    acc.receita    += l.receita
    acc.seguidores += l.seguidores
    porData.set(l.data, acc)
  }

  const datas = Array.from(porData.keys()).sort()
  const metricas: MetricasCampanhaDia[] = []
  const funil: MetricasFunilDia[] = []

  for (const data of datas) {
    const a = porData.get(data)!
    const d = derivarMetricas({
      gasto: a.gasto, impressoes: a.impressoes, cliques: a.cliques,
      compras: a.vendas, valorGerado: a.receita, leads: a.leads, pageView: a.sessoes,
    })
    metricas.push({
      campanhaId:    'agregado',
      data,
      gasto:         a.gasto,
      impressoes:    a.impressoes,
      cliques:       a.cliques,
      conversoes:    a.vendas,
      receita:       a.receita,
      seguidores:    a.seguidores,
      ctr:           d.ctr,
      cpl:           d.cpl,                // gasto ÷ leads
      roas:          d.roas,
      taxaConversao: d.taxaConvVendaLP,    // compra ÷ pageView (decisão João)
    })
    funil.push({
      clienteId:      'agregado',
      data,
      sessoes:        a.sessoes,
      leads:          a.leads,
      vendas:         a.vendas,
      receita:        a.receita,
      taxaLeadSessao: d.taxaConvLeadLP,    // lead ÷ pageView
      taxaVendaLead:  a.leads > 0 ? (a.vendas / a.leads) * 100 : 0,
      ticketMedio:    d.ticketMedio,
    })
  }

  return { metricas, funil }
}

// ─── Sistema de instâncias de colunas ────────────────────────────────────────
// Cada instância é um slot independente na tabela.
// A mesma métrica pode ter múltiplas instâncias em posições diferentes.

type ColKey = string

interface ColInstancia {
  id: string        // único — identifica o slot
  key: ColKey
  label: string
  grupo: string
  fixo: boolean     // sempre ativo, não pode ser removido
  metric?: MetricDefinition
}

const TODAS_INSTANCIAS: ColInstancia[] = [
  ...getMetricsForScope('diaria').map(m => ({
    id: m.key,
    key: m.key,
    label: getMetricLabel(m, 'diaria'),
    grupo: m.group,
    fixo: ['investimento', 'vendas', 'cac'].includes(m.key),
    metric: m,
  })),
]

const IDS_PADRAO = getDefaultMetricKeys('diaria')

// Métricas coloridas por padrão
const PADRAO_COLORIDAS: ColKey[] = getMetricsForScope('diaria')
  .filter(m => m.colorized?.diaria)
  .map(m => m.key)

const COR_GRUPO: Record<string, string> = {
  Principais: 'var(--color-text-secondary)',
  Adicionais: 'var(--color-text-secondary)',
  Veiculação: 'var(--color-text-muted)',
  Página:     '#5C79C9',
  Conversão:  'var(--color-signal-yellow)',
  Final:      'var(--color-text-muted)',
}

// ─── Célula ───────────────────────────────────────────────────────────────────

function Celula({ v, s = 'neutro', muted }: { v: string; s?: Sinal; muted?: boolean }) {
  return (
    <td style={{ padding: '0.55rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.84rem', color: muted ? 'var(--color-text-muted)' : COR[s], backgroundColor: FUNDO[s], textAlign: 'right', whiteSpace: 'nowrap' }}>
      {v}
    </td>
  )
}

// ─── Agrupamento ──────────────────────────────────────────────────────────────

function semana(data: string) {
  const d = new Date(`${data}T12:00:00`)
  // ISO week: find the Thursday of the same week, then use that year for the key.
  const thu = new Date(d)
  thu.setDate(d.getDate() + (4 - (d.getDay() || 7)))
  const jan4 = new Date(thu.getFullYear(), 0, 4)
  const sem = Math.ceil(((thu.getTime() - jan4.getTime()) / 86400000 + (jan4.getDay() || 7) - 3) / 7)
  return `${thu.getFullYear()}-S${String(sem).padStart(2, '0')}`
}
function mes(data: string) { return data.slice(0, 7) }
function rotuloMes(k: string) {
  const [a, m] = k.split('-')
  return `${'JanFevMarAbrMaiJunJulAgoSetOutNovDez'.match(/.{3}/g)![parseInt(m) - 1]} ${a.slice(2)}`
}
function rotuloDia(data: string) { const [, m, d] = data.split('-'); return `${d}/${m}` }
function diaSemana(data: string) {
  return new Date(`${data}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
}

function construirLinhas(
  slice: { data: string; m: MetricasCampanhaDia; f?: MetricasFunilDia }[],
  agrup: Agrupamento,
): Linha[] {
  if (agrup === 'diario') {
    return slice.map(({ data, m, f }) => {
      const d = derivarMetricas({ gasto: m.gasto, impressoes: m.impressoes, cliques: m.cliques })
      return {
      rotulo: rotuloDia(data),
      dataRef: data,
      investimento: m.gasto,
      impressoes: m.impressoes,
      cpm: d.cpm,
      ctr: d.ctr,
      cliques: m.cliques,
      cpc: d.cpc,
      pageView: f?.sessoes ?? null,   // sessoes ≈ page views
      leads: f?.leads ?? null,
      conectados: f?.leads ?? null,   // alias de leads (compatibilidade)
      vendas: f?.vendas ?? null,
      valorGerado: f?.receita ?? null,
      seguidores: m.seguidores,
      }
    })
  }

  const grupos = new Map<string, typeof slice>()
  for (const item of slice) {
    const k = agrup === 'semanal' ? semana(item.data) : mes(item.data)
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k)!.push(item)
  }

  const entradas = Array.from(grupos.entries())

  return entradas.map(([k, itens], idx) => {
    const inv   = itens.reduce((s, i) => s + i.m.gasto, 0)
    const imp   = itens.reduce((s, i) => s + i.m.impressoes, 0)
    const cliqs = itens.reduce((s, i) => s + i.m.cliques, 0)
    const temF  = itens.some(i => i.f)
    const d = derivarMetricas({ gasto: inv, impressoes: imp, cliques: cliqs })
    // Semanas numeradas sequencialmente: Sem 1 = mais recente (índice 0 = topo)
    const rotuloSemanal = `Sem ${idx + 1}`
    return {
      rotulo: agrup === 'semanal' ? rotuloSemanal : rotuloMes(k),
      dataRef: itens[0].data,
      investimento: inv,
      impressoes: imp,
      cpm: d.cpm,
      ctr: d.ctr,
      cliques: cliqs,
      cpc: d.cpc,
      pageView:    temF ? itens.reduce((s, i) => s + (i.f?.sessoes ?? 0), 0) : null,
      leads:       temF ? itens.reduce((s, i) => s + (i.f?.leads ?? 0), 0) : null,
      conectados:  temF ? itens.reduce((s, i) => s + (i.f?.leads ?? 0), 0) : null,
      vendas:      temF ? itens.reduce((s, i) => s + (i.f?.vendas ?? 0), 0) : null,
      valorGerado: temF ? itens.reduce((s, i) => s + (i.f?.receita ?? 0), 0) : null,
      seguidores:  itens.reduce((s, i) => s + i.m.seguidores, 0),
    }
  })
}

// ─── Componente ───────────────────────────────────────────────────────────────

interface Props {
  dados: CampanhaMetricaDia[]
  campanhasAtivas?: Record<string, boolean>
  metaFalhou?: boolean // fetch da Meta falhou (rate limit) — tabela vazia não é "sem veiculação"
  isAdmin?: boolean
}

export function TabelaDiaria({ dados, campanhasAtivas = {}, metaFalhou = false, isAdmin = true }: Props) {
  // isAdmin controla visibilidade do configurador de colunas
  const [de,  setDe]  = useState(subDias(29))
  const [ate, setAte] = useState(hoje())
  const [agrup, setAgrup]           = useState<Agrupamento>('diario')
  const [colIds, setColIds]           = useState<string[]>(IDS_PADRAO)
  const [dragId, setDragId]           = useState<string | null>(null)
  const [dragOver, setDragOver]       = useState<string | null>(null)
  const [configAberto, setConfig]     = useState(false)
  const [coloridas, setColoridas]     = useState<Set<ColKey>>(new Set(PADRAO_COLORIDAS))
  const [filtro, setFiltro]           = useState<FiltroState>(FILTRO_VAZIO)
  const [sortKey, setSortKey]         = useState<ColKey | 'data' | null>(null)
  const [sortDir, setSortDir]         = useState<'asc' | 'desc'>('desc')

  // Aplica o filtro inteligente nas campanhas e re-agrega na visão da conta.
  // "Campanha ativa" só filtra se o mapa de status chegou (o fetch pode degradar)
  const { metricas, funil } = useMemo(() => {
    const temStatus = Object.keys(campanhasAtivas).length > 0
    const filtradas = dados.filter(c => passaFiltroNome(c.campanhaNome, filtro)
      && (!filtro.ativoCampanha || !temStatus || campanhasAtivas[c.campanhaId] === true))
    return agregarPorDia(filtradas)
  }, [dados, filtro, campanhasAtivas])

  const datasOrdenadas = useMemo(() => Array.from(new Set(dados.map(d => d.data))).sort(), [dados])
  const minData = datasOrdenadas[0] ?? subDias(364)
  const maxData = datasOrdenadas[datasOrdenadas.length - 1] ?? hoje()

  function toggleSort(key: ColKey | 'data') {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  function sortIndicador(key: ColKey | 'data') {
    if (sortKey !== key) return <span style={{ opacity: 0.2, fontSize: '0.6rem' }}>↕</span>
    return <span style={{ fontSize: '0.65rem', color: 'var(--color-ponto-conversao)' }}>{sortDir === 'desc' ? '↓' : '↑'}</span>
  }
  function toggleInstancia(id: string) {
    const inst = TODAS_INSTANCIAS.find(c => c.id === id)!
    if (inst.fixo) return
    setColIds(p => p.includes(id) ? p.filter(i => i !== id) : [...p, id])
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

  function tudo() { setColIds(TODAS_INSTANCIAS.map(c => c.id)) }
  function desmarcar() { setColIds(TODAS_INSTANCIAS.filter(c => c.fixo).map(c => c.id)) }

const slice = useMemo(() => {
    return metricas
      .filter(m => m.data >= de && m.data <= ate)
      .reverse()
      .map(m => ({ data: m.data, m, f: funil.find(f => f.data === m.data) }))
  }, [metricas, funil, de, ate])

  const linhasBase = useMemo(() => construirLinhas(slice, agrup), [slice, agrup])

  const linhas = useMemo(() => {
    const resultado = [...linhasBase]

    // Ordenação
    if (sortKey) {
      resultado.sort((a, b) => {
        const val = (l: Linha): number => {
          if (sortKey === 'data') return new Date(l.dataRef).getTime()
          const roas = (x: Linha) => x.valorGerado && x.investimento ? x.valorGerado / x.investimento : 0
          const cac  = (x: Linha) => x.vendas && x.investimento ? x.investimento / x.vendas : 0
          switch (sortKey) {
            case 'investimento': return l.investimento
            case 'valorGerado':  return l.valorGerado ?? 0
            case 'vendas':       return l.vendas ?? 0
            case 'cac':          return cac(l)
            case 'roas':         return roas(l)
            case 'impressoes':   return l.impressoes
            case 'cpm':          return l.cpm
            case 'ctr':          return l.ctr
            case 'cliques':      return l.cliques
            case 'cpc':          return l.cpc
            case 'connectRate':  return l.pageView && l.cliques ? (l.pageView / l.cliques) * 100 : 0
            case 'custoConnect': return l.pageView ? l.investimento / l.pageView : 0
            case 'ticketMedio':  return l.valorGerado && l.vendas ? l.valorGerado / l.vendas : 0
            // Mesmas contas das células — sem estes cases o header ordenava por 0 fixo
            case 'compras':          return l.vendas ?? 0
            case 'pageView':         return l.pageView ?? 0
            case 'custoPorPageView': return l.pageView ? l.investimento / l.pageView : 0
            case 'taxaConvLead':     return l.leads && l.pageView ? (l.leads / l.pageView) * 100 : 0
            case 'receita':             return l.valorGerado ?? 0
            case 'taxaConversao':       return l.vendas && l.pageView ? (l.vendas / l.pageView) * 100 : 0
            case 'taxaConversaoClique': return l.vendas && l.cliques ? (l.vendas / l.cliques) * 100 : 0
            case 'seguidores':          return l.seguidores ?? 0
            case 'custoSeguidores':     return l.seguidores ? l.investimento / l.seguidores : 0
            default: return 0
          }
        }
        return sortDir === 'desc' ? val(b) - val(a) : val(a) - val(b)
      })
    }

    return resultado
  }, [linhasBase, sortKey, sortDir])

  // Colunas na ordem definida pelo usuário
  const cols = colIds
    .map(id => TODAS_INSTANCIAS.find(c => c.id === id))
    .filter(Boolean) as ColInstancia[]

  // Estatísticas calculadas sobre as linhas do período atual
  const stats = useMemo((): Partial<Record<ColKey, EstatMetrica>> => {
    const e = (fn: (l: Linha) => number) => calcularEstat(linhas.map(fn))
    return {
      investimento:  e(l => l.investimento),
      valorGerado:   e(l => l.valorGerado ?? 0),
      vendas:        e(l => l.vendas ?? 0),
      cac:           e(l => l.vendas ? l.investimento / l.vendas : 0),
      roas:          e(l => l.valorGerado ? l.valorGerado / l.investimento : 0),
      impressoes:    e(l => l.impressoes),
      cpm:           e(l => l.cpm),
      ctr:           e(l => l.ctr),
      cliques:       e(l => l.cliques),
      cpc:           e(l => l.cpc),
      connectRate:   e(l => l.pageView && l.cliques ? (l.pageView / l.cliques) * 100 : 0),
      custoConnect:  e(l => l.pageView ? l.investimento / l.pageView : 0),
      ticketMedio:   e(l => l.valorGerado && l.vendas ? l.valorGerado / l.vendas : 0),
    }
  }, [linhas])

  // ── Renderizar célula ──────────────────────────────────────────────────────

  function celula(l: Linha, key: ColKey, instId: string) {
    const roas = l.valorGerado && l.investimento ? l.valorGerado / l.investimento : 0
    const cac  = l.vendas && l.investimento ? l.investimento / l.vendas : 0
    const cr   = l.pageView && l.cliques ? (l.pageView / l.cliques) * 100 : 0
    const cc   = l.pageView ? l.investimento / l.pageView : 0
    const s    = (k: ColKey, v: number): Sinal => coloridas.has(k) ? avaliar(k, v, stats[k]) : 'neutro'

    switch (key) {
      case 'investimento':  return <Celula key={instId} v={brl(l.investimento)} />
      case 'valorGerado':   return <Celula key={instId} v={l.valorGerado ? brl(l.valorGerado) : '—'} s={s('valorGerado', l.valorGerado ?? 0)} />
      case 'vendas':        return <Celula key={instId} v={l.vendas ? l.vendas.toLocaleString('pt-BR') : '—'} s={s('vendas', l.vendas ?? 0)} />
      // 'compras' (métrica global) na Diária = o mesmo dado da coluna acima
      // (antes caía no default e renderizava '—' apesar de haver dado real)
      case 'compras':       return <Celula key={instId} v={l.vendas ? l.vendas.toLocaleString('pt-BR') : '—'} s={s('vendas', l.vendas ?? 0)} />
      case 'cac':           return <Celula key={instId} v={cac > 0 ? brl(cac) : '—'} s={s('cac', cac)} />
      case 'roas':          return <Celula key={instId} v={roas > 0 ? `${roas.toFixed(2)}x` : '—'} s={s('roas', roas)} />
      case 'impressoes':    return <Celula key={instId} v={l.impressoes.toLocaleString('pt-BR')} muted />
      case 'cpm':           return <Celula key={instId} v={brl(l.cpm)} s={s('cpm', l.cpm)} />
      case 'ctr':           return <Celula key={instId} v={pct(l.ctr)} s={s('ctr', l.ctr)} />
      case 'cliques':       return <Celula key={instId} v={l.cliques.toLocaleString('pt-BR')} muted />
      case 'cpc':           return <Celula key={instId} v={l.cpc > 0 ? brl(l.cpc) : '—'} s={s('cpc', l.cpc)} />
      case 'connectRate':   return <Celula key={instId} v={cr > 0 ? pct(cr) : '—'} s={s('connectRate', cr)} />
      case 'custoConnect':  return <Celula key={instId} v={cc > 0 ? brl(cc) : '—'} s={s('custoConnect', cc)} />
      case 'ticketMedio': {
        const tm = l.valorGerado && l.vendas ? l.valorGerado / l.vendas : 0
        return <Celula key={instId} v={tm > 0 ? brl(tm) : '—'} />
      }
      // Página — dado REAL já presente na linha (mesma fonte do Connect Rate).
      // Antes mostravam '—' fixo, parecendo falta de dado da Meta.
      case 'pageView':
        return <Celula key={instId} v={l.pageView ? l.pageView.toLocaleString('pt-BR') : '—'} muted />
      case 'custoPorPageView': {
        const cpv = l.pageView ? l.investimento / l.pageView : 0
        return <Celula key={instId} v={cpv > 0 ? brl(cpv) : '—'} muted />
      }
      case 'taxaConvLead': {
        const tl = l.leads && l.pageView ? (l.leads / l.pageView) * 100 : 0
        return <Celula key={instId} v={tl > 0 ? pct(tl) : '—'} muted />
      }
      // Colunas globais selecionáveis com dado real na linha — caíam no default '—'
      case 'receita':      return <Celula key={instId} v={l.valorGerado ? brl(l.valorGerado) : '—'} muted />
      case 'taxaConversao': {
        const t = l.vendas && l.pageView ? (l.vendas / l.pageView) * 100 : 0
        return <Celula key={instId} v={t > 0 ? pct(t) : '—'} muted />
      }
      case 'taxaConversaoClique': {
        const t = l.vendas && l.cliques ? (l.vendas / l.cliques) * 100 : 0
        return <Celula key={instId} v={t > 0 ? pct(t) : '—'} muted />
      }
      case 'seguidores':      return <Celula key={instId} v={l.seguidores ? l.seguidores.toLocaleString('pt-BR') : '—'} muted />
      case 'custoSeguidores': {
        const cs = l.seguidores ? l.investimento / l.seguidores : 0
        return <Celula key={instId} v={cs > 0 ? brl(cs) : '—'} muted />
      }
      // Veiculação — vídeo (dados de vídeo ainda não chegam a esta tela)
      case 'tsr':
      case 'retencao75':
      case 'conv75Lead': case 'conv75Venda': case 'conv75Seguidor': case 'conv75Resultado':
      case 'convCliqueLead': case 'convCliqueVenda': case 'convCliqueSeguidor': case 'convCliqueResultado':
      case 'cpv75': case 'cpv95':
      case 'taxaConvVenda': case 'taxaConvMql':
      case 'taxaConvInscricao': case 'taxaConvContatos':
      case 'taxaCheckout': case 'taxaConvCheckout':
        return <Celula key={instId} v="—" muted />
      default:              return <Celula key={instId} v="—" />
    }
  }

  // ── Médias ─────────────────────────────────────────────────────────────────

  function mediaCol(key: ColKey): { v: string; s: Sinal } {
    // Recorte sem nenhum dia (filtro que não casa nada): média não existe —
    // sem o guard, a linha mostrava "R$ 0,00 / 0 / 0" fabricados
    if (!linhas.length) return { v: '—', s: 'neutro' }
    const n = linhas.length || 1
    const sum = (fn: (l: Linha) => number) => linhas.reduce((s, l) => s + fn(l), 0)
    const avg = (fn: (l: Linha) => number) => sum(fn) / n
    // Razões recomputadas das SOMAS do período (média diária ponderada) — média
    // simples das razões diárias mentia (dias pequenos pesavam igual aos grandes)
    // e o filtro >0 escondia do CAC os dias com gasto e zero venda.
    // Aditivas: média sobre TODOS os dias exibidos (dia com 0 venda conta).
    // Sinal sempre neutro: a linha de média é a própria referência do semáforo.
    const somas = {
      inv: sum(l => l.investimento), vg: sum(l => l.valorGerado ?? 0), vendas: sum(l => l.vendas ?? 0),
      imp: sum(l => l.impressoes), cli: sum(l => l.cliques), pv: sum(l => l.pageView ?? 0),
      leads: sum(l => l.leads ?? 0), seg: sum(l => l.seguidores ?? 0),
    }

    switch (key) {
      case 'investimento':  return { v: brl(avg(l => l.investimento)), s: 'neutro' }
      case 'valorGerado':   return { v: somas.vg > 0 ? brl(somas.vg / n) : '—', s: 'neutro' }
      case 'vendas':        return { v: somas.vendas > 0 ? (somas.vendas / n).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—', s: 'neutro' }
      case 'cac':           return { v: somas.vendas > 0 ? brl(somas.inv / somas.vendas) : '—', s: 'neutro' }
      case 'roas':          return { v: somas.inv > 0 && somas.vg > 0 ? `${(somas.vg / somas.inv).toFixed(2)}x` : '—', s: 'neutro' }
      case 'impressoes':    return { v: Math.round(avg(l => l.impressoes)).toLocaleString('pt-BR'), s: 'neutro' }
      case 'cpm':           return { v: somas.imp > 0 ? brl((somas.inv / somas.imp) * 1000) : '—', s: 'neutro' }
      case 'ctr':           return { v: somas.imp > 0 ? pct((somas.cli / somas.imp) * 100) : '—', s: 'neutro' }
      case 'cliques':       return { v: Math.round(avg(l => l.cliques)).toLocaleString('pt-BR'), s: 'neutro' }
      case 'cpc':           return { v: somas.cli > 0 ? brl(somas.inv / somas.cli) : '—', s: 'neutro' }
      case 'connectRate':   return { v: somas.cli > 0 && somas.pv > 0 ? pct((somas.pv / somas.cli) * 100) : '—', s: 'neutro' }
      case 'custoConnect':  return { v: somas.pv > 0 ? brl(somas.inv / somas.pv) : '—', s: 'neutro' }
      case 'ticketMedio':   return { v: somas.vendas > 0 && somas.vg > 0 ? brl(somas.vg / somas.vendas) : '—', s: 'neutro' }
      // Colunas com célula preenchida precisam de média — o default '—' escondia
      // médias calculáveis (célula com dado + rodapé vazio = tabela se contradiz)
      case 'compras':          return { v: somas.vendas > 0 ? (somas.vendas / n).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—', s: 'neutro' }
      case 'pageView':         return { v: somas.pv > 0 ? Math.round(somas.pv / n).toLocaleString('pt-BR') : '—', s: 'neutro' }
      case 'custoPorPageView': return { v: somas.pv > 0 ? brl(somas.inv / somas.pv) : '—', s: 'neutro' }
      case 'taxaConvLead':     return { v: somas.pv > 0 && somas.leads > 0 ? pct((somas.leads / somas.pv) * 100) : '—', s: 'neutro' }
      case 'receita':             return { v: somas.vg > 0 ? brl(somas.vg / n) : '—', s: 'neutro' }
      case 'taxaConversao':       return { v: somas.pv > 0 && somas.vendas > 0 ? pct((somas.vendas / somas.pv) * 100) : '—', s: 'neutro' }
      case 'taxaConversaoClique': return { v: somas.cli > 0 && somas.vendas > 0 ? pct((somas.vendas / somas.cli) * 100) : '—', s: 'neutro' }
      case 'seguidores':          return { v: somas.seg > 0 ? Math.round(somas.seg / n).toLocaleString('pt-BR') : '—', s: 'neutro' }
      case 'custoSeguidores':     return { v: somas.seg > 0 ? brl(somas.inv / somas.seg) : '—', s: 'neutro' }
      default:              return { v: '—', s: 'neutro' }
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
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Falha da Meta ≠ conta parada: sem o aviso, a tabela vazia parecia dado real */}
      {metaFalhou && (
        <div style={{ padding: '0.7rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(224,57,47,0.45)', backgroundColor: 'rgba(224,57,47,0.08)', fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: '#B3372A', fontWeight: 600 }}>
          ⚠ Dados da Meta indisponíveis agora (provável rate limit). A tabela está incompleta — recarregue em alguns minutos.
        </div>
      )}

      {/* Título */}
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '0.03em' }}>VISAO DIARIA</h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>Salto para o Dólar</p>
      </div>

      {/* Filtro de funil */}
      <FiltroFunil filtro={filtro} onChange={setFiltro} isAdmin={isAdmin} niveis={['campanha']} />

      {/* Controles */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>

        <SeletorPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} atalhos={[7, 30, 60, 90]} minData={minData} maxData={maxData} />

        <div style={{ width: '1px', height: '28px', backgroundColor: 'var(--color-border-subtle)' }} />

        {/* Granularidade */}
        <div style={{ display: 'flex', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {([['diario', 'Diário'], ['semanal', 'Semanal'], ['mensal', 'Mensal']] as [Agrupamento, string][]).map(([a, l]) => (
            <button key={a} onClick={() => setAgrup(a)} style={{ ...btnBase, color: agrup === a ? 'var(--color-ponto-conversao)' : 'var(--color-text-muted)', backgroundColor: agrup === a ? 'var(--color-bg-tertiary)' : 'transparent', fontWeight: agrup === a ? 700 : 400 }}>
              {l}
            </button>
          ))}
        </div>

        {/* Colunas — só admin */}
        {isAdmin && (
          <div style={{ position: 'relative' }}>
            <button onClick={() => setConfig(!configAberto)}
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
                    const col = TODAS_INSTANCIAS.find(c => c.id === id)
                    if (!col) return null
                    const isDragging = dragId === id
                    const isOver    = dragOver === id
                    return (
                      <div key={id}
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
                          <button onClick={() => toggleInstancia(id)}
                            style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>
                            ✕
                          </button>
                        )}
                      </div>
                    )
                  })}
                  <div style={{ marginTop: '0.25rem', display: 'flex', gap: '0.5rem' }}>
                    <button onClick={desmarcar} style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)', background: 'none', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', padding: '0.2rem 0.5rem', cursor: 'pointer' }}>Limpar</button>
                    <button onClick={tudo}     style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-ponto-conversao)', background: 'none', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', padding: '0.2rem 0.5rem', cursor: 'pointer' }}>Ver tudo</button>
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

                  {['Principais', 'Adicionais', 'Veiculação', 'Página', 'Conversão', 'Final'].map(grupo => {
                    const itens = TODAS_INSTANCIAS.filter(c => c.grupo === grupo)
                    if (!itens.length) return null
                    return (
                      <div key={grupo}>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: COR_GRUPO[grupo] ?? 'var(--color-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.3rem' }}>{grupo}</p>
                        {itens.map(col => {
                          const ativo = colIds.includes(col.id)
                          return (
                            <div key={col.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.18rem 0' }}>
                              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: ativo ? 'var(--color-text-primary)' : 'var(--color-text-muted)', flex: 1 }}>{col.label}</span>
                              <input type="checkbox" checked={ativo}
                                disabled={col.fixo}
                                onChange={() => toggleInstancia(col.id)}
                                style={{ accentColor: 'var(--color-ponto-conversao)', width: '13px', height: '13px', cursor: col.fixo ? 'default' : 'pointer', opacity: col.fixo ? 0.35 : 1 }} />
                              <input type="checkbox" checked={coloridas.has(col.key)} disabled={!ativo}
                                onChange={() => setColoridas(p => { const n = new Set(p); if (n.has(col.key)) n.delete(col.key); else n.add(col.key); return n })}
                                style={{ accentColor: 'var(--color-signal-yellow)', width: '13px', height: '13px', cursor: ativo ? 'pointer' : 'not-allowed', opacity: ativo ? 1 : 0.2 }} />
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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '1rem', alignItems: 'center' }}>
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
                <th onClick={() => toggleSort('data')}
                  style={{ ...thBase, textAlign: 'left', minWidth: '70px', cursor: 'pointer', userSelect: 'none' }}>
                  {agrup === 'diario' ? 'Data' : agrup === 'semanal' ? 'Semana' : 'Mês'} {sortIndicador('data')}
                </th>
                {agrup === 'diario' && (
                  <th style={{ ...thBase, textAlign: 'left', minWidth: '40px' }}>Dia</th>
                )}
                {cols.map(col => (
                  <th key={col.id}
                    onClick={() => toggleSort(col.key)}
                    style={{ ...thBase, color: COR_GRUPO[col.grupo] ?? 'var(--color-text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                    {col.label} {sortIndicador(col.key)}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {/* Linha de médias */}
              <tr style={{ borderBottom: '2px solid var(--color-border-default)', backgroundColor: 'var(--color-bg-tertiary)' }}>
                <td colSpan={agrup === 'diario' ? 2 : 1} style={{ padding: '0.6rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Média
                </td>
                {cols.map(col => {
                  const { v, s } = mediaCol(col.key)
                  return (
                    <td key={col.id} style={{ padding: '0.6rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: COR[s], backgroundColor: FUNDO[s], textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {v}
                    </td>
                  )
                })}
              </tr>


              {/* Linhas de dados */}
              {linhas.map((l, i) => {
                // Pela DATA real, não pela posição: ordenar por qualquer coluna
                // movia o selo "HOJE" pra primeira linha da ordenação. Se hoje
                // ainda não tem dado, nenhuma linha ganha o selo (honesto).
                const isHoje = agrup === 'diario' && l.dataRef === hoje()
                const bg = isHoje ? 'rgba(95,138,60,0.07)' : i % 2 === 0 ? 'transparent' : 'rgba(28,28,26,0.02)'
                return (
                  <tr key={`${l.dataRef}-${i}`} style={{ borderBottom: '1px solid var(--color-border-subtle)', backgroundColor: bg }}>
                    <td style={{ padding: '0.55rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.84rem', color: isHoje ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', fontWeight: isHoje ? 700 : 400, whiteSpace: 'nowrap' }}>
                      {l.rotulo}
                      {isHoje && <span style={{ marginLeft: '0.4rem', fontSize: '0.6rem', color: 'var(--color-ponto-conversao)', fontWeight: 700 }}>HOJE</span>}
                    </td>
                    {agrup === 'diario' && (
                      <td style={{ padding: '0.55rem 0.5rem', fontFamily: 'var(--font-body)', fontSize: '0.74rem', color: 'var(--color-text-muted)', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
                        {diaSemana(l.dataRef)}
                      </td>
                    )}
                    {cols.map(col => celula(l, col.key, col.id))}
                  </tr>
                )
              })}

            </tbody>
          </table>
        </div>

      </div>
    </div>
  )
}
