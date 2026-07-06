'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { SeletorPeriodo, hoje, subDias } from '@/components/ui/SeletorPeriodo'
import { FiltroFunil, type FiltroState, FILTRO_VAZIO, passaFiltroNome } from '@/components/dashboard/FiltroFunil'
import type { CampanhaDiaTendencias, DadoGeoTendencias, GeoCampanhaRow } from '@/lib/meta/tendencias'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps'
import {
  TENDENCIAS_HEATMAP_METRIC_KEYS,
  TENDENCIAS_LINE_METRIC_KEYS,
  TENDENCIAS_REGION_METRIC_KEYS,
  formatMetricValue,
  getMetricByKey,
  getMetricLabel,
} from '@/lib/config/metrics'
import { derivarMetricas } from '@/lib/metrics/derivar'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Objetivo   = 'todos' | 'VENDAS' | 'LEADS' | 'CPT' | 'C1' | 'C2' | 'C3'
type Temperatura = 'todos' | 'fundo' | 'quente' | 'nao_identificado'

interface DiaDado {
  data: string
  diaSemana: number   // 0=Dom … 6=Sáb
  semanaIdx: number
  investimento: number
  impressoes: number
  cliques: number
  compras: number
  valorGerado: number
  roas: number
  cac: number
  ctr: number
  cpm: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtData(d: string) { const [, m, dia] = d.split('-'); return `${dia}/${m}` }

const DIAS_LABEL  = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MESES_LABEL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

// ─── Componente BubbleMap ────────────────────────────────────────────────────

type MapaModo = 'brasil' | 'mundo'

const GEO_URL_BRASIL = '/brazil-states.geojson'
const GEO_URL_MUNDO  = '/world-110m.json'

// ISO 3166-1 numérico → alpha-2 (para os países que usamos)
const ISO_NUM_TO_ALPHA2: Record<string, string> = {
  '076': 'BR', '620': 'PT', '840': 'US', '032': 'AR',
  '170': 'CO', '484': 'MX', '152': 'CL', '024': 'AO',
  '276': 'DE', '826': 'GB', '724': 'ES', '250': 'FR',
  '380': 'IT', '604': 'PE', '124': 'CA',
}

interface BubbleMapProps {
  dados: DadoGeoTendencias[]
  metrica: MetricaHeatmapRegiao
  modo: MapaModo
  tooltip: string | null
  onHover: (sigla: string | null) => void
}

function BubbleMap({ dados, metrica, modo, tooltip, onHover }: BubbleMapProps) {
  const vals   = dados.map(d => d[metrica])
  const maxVal = Math.max(...vals)
  const inv    = HEATMAP_METRICAS_REGIAO.find(m => m.key === metrica)?.invertido

  const porSigla = useMemo(() => {
    const m: Record<string, DadoGeoTendencias> = {}
    dados.forEach(d => { m[d.sigla] = d })
    return m
  }, [dados])

  function getFill(sigla: string) {
    const d = porSigla[sigla]
    if (!d) return 'rgba(28,28,26,0.05)'
    const val = d[metrica]
    const ratio = maxVal > 0 ? val / maxVal : 0
    const opacity = inv ? (0.06 + (1 - ratio) * 0.94) : (0.06 + ratio * 0.94)
    return `rgba(95,138,60,${opacity.toFixed(2)})`
  }

  function getFillMundo(numericId: string) {
    const alpha2 = ISO_NUM_TO_ALPHA2[numericId]
    if (!alpha2) return 'rgba(28,28,26,0.04)'
    const d = porSigla[alpha2]
    if (!d) return 'rgba(28,28,26,0.04)'
    const val = d[metrica]
    const ratio = maxVal > 0 ? val / maxVal : 0
    const opacity = inv ? (0.06 + (1 - ratio) * 0.94) : (0.06 + ratio * 0.94)
    return `rgba(95,138,60,${opacity.toFixed(2)})`
  }

  if (modo === 'mundo') {
    return (
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 130, center: [10, 5] }}
        style={{ width: '100%', height: '100%' }}
      >
        <Geographies geography={GEO_URL_MUNDO}>
          {({ geographies }) =>
            geographies.map(geo => {
              const numId  = String(geo.id).padStart(3, '0')
              const alpha2 = ISO_NUM_TO_ALPHA2[numId]
              const isHovered = tooltip === alpha2
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={getFillMundo(numId)}
                  stroke={isHovered ? 'rgba(28,28,26,0.6)' : 'rgba(28,28,26,0.15)'}
                  strokeWidth={isHovered ? 1.0 : 0.3}
                  style={{ default: { outline: 'none' }, hover: { outline: 'none' }, pressed: { outline: 'none' } }}
                  onMouseEnter={() => alpha2 && onHover(alpha2)}
                  onMouseLeave={() => onHover(null)}
                />
              )
            })
          }
        </Geographies>
        {dados.map(d => {
          // Países fora do dicionário vêm sem coordenada (NaN) — sem marcador
          if (tooltip !== d.sigla || !Number.isFinite(d.lat)) return null
          return (
            <Marker key={d.sigla} coordinates={[d.lon, d.lat]}>
              <circle r={4} fill="white" opacity={0.9} style={{ pointerEvents: 'none' }} />
            </Marker>
          )
        })}
      </ComposableMap>
    )
  }

  return (
    <ComposableMap
      projection="geoMercator"
      projectionConfig={{ scale: 680, center: [-54, -15] }}
      style={{ width: '100%', height: '100%' }}
    >
      <Geographies geography={GEO_URL_BRASIL}>
        {({ geographies }) =>
          geographies.map(geo => {
            const sigla = geo.properties.sigla as string
            const isHovered = tooltip === sigla
            return (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill={getFill(sigla)}
                stroke={isHovered ? 'rgba(28,28,26,0.6)' : 'rgba(28,28,26,0.18)'}
                strokeWidth={isHovered ? 1.2 : 0.4}
                style={{ default: { outline: 'none' }, hover: { outline: 'none' }, pressed: { outline: 'none' } }}
                onMouseEnter={() => onHover(sigla)}
                onMouseLeave={() => onHover(null)}
              />
            )
          })
        }
      </Geographies>
      {dados.map(d => {
        const isHovered = tooltip === d.sigla
        if (!isHovered) return null
        return (
          <Marker key={d.sigla} coordinates={[d.lon, d.lat]}>
            <circle r={4} fill="white" opacity={0.9} style={{ pointerEvents: 'none' }} />
          </Marker>
        )
      })}
    </ComposableMap>
  )
}

// ─── Métricas para gráfico de linha ──────────────────────────────────────────

const METRIC_VISUAL: Record<string, { cor: string; eixo: 'L' | 'R' }> = {
  investimento: { cor: '#5C79C9', eixo: 'L' },
  valorGerado:  { cor: '#5F8A3C', eixo: 'L' },
  roas:         { cor: '#E8BE0B', eixo: 'R' },
  cac:          { cor: '#E0392F', eixo: 'R' },
  ctr:          { cor: '#9A86D6', eixo: 'R' },
  cpm:          { cor: '#F3850C', eixo: 'R' },
  compras:      { cor: '#5F8A3C', eixo: 'R' },
}

const METRICAS_LINHA = TENDENCIAS_LINE_METRIC_KEYS.flatMap(key => {
  const metric = getMetricByKey(key)
  const visual = METRIC_VISUAL[key]
  return metric && visual ? [{
    key,
    label: getMetricLabel(metric, 'tendencias'),
    cor: visual.cor,
    formato: (v: number) => formatMetricValue(v, metric.format),
    eixo: visual.eixo,
  }] : []
})

// ─── Heatmap ──────────────────────────────────────────────────────────────────

type MetricaHeatmap = 'investimento' | 'roas' | 'compras' | 'ctr' | 'cac'
type MetricaHeatmapRegiao = 'investimento' | 'roas' | 'compras' | 'ctr'

const HEATMAP_METRICAS: { key: MetricaHeatmap; label: string; formato: (v: number) => string; invertido?: boolean }[] =
  TENDENCIAS_HEATMAP_METRIC_KEYS.flatMap(key => {
    const metric = getMetricByKey(key)
    return metric ? [{ key: key as MetricaHeatmap, label: getMetricLabel(metric, 'tendencias'), formato: (v: number) => formatMetricValue(v, metric.format), invertido: metric.invertido }] : []
  })

const HEATMAP_METRICAS_REGIAO: { key: MetricaHeatmapRegiao; label: string; formato: (v: number) => string; invertido?: boolean }[] =
  TENDENCIAS_REGION_METRIC_KEYS.flatMap(key => {
    const metric = getMetricByKey(key)
    return metric ? [{ key: key as MetricaHeatmapRegiao, label: getMetricLabel(metric, 'tendencias'), formato: (v: number) => formatMetricValue(v, metric.format), invertido: metric.invertido }] : []
  })

function heatmapCor(val: number, min: number, max: number, invertido?: boolean): string {
  if (max === min) return 'rgba(95,138,60,0.15)'
  const ratio = invertido
    ? 1 - (val - min) / (max - min)
    : (val - min) / (max - min)
  const clamped = Math.max(0, Math.min(1, ratio))
  return `rgba(95,138,60,${0.08 + clamped * 0.82})`
}

// Agregação canônica de um bucket de dias (dia-da-semana ou mês): aditivas =
// média/dia contando zeros (segunda com gasto e 0 compra é dado real, não
// ausência); razões = recomputadas das somas do bucket pela fonte única (média
// das razões diárias mentia — dias pequenos pesavam igual aos grandes — e o
// filtro >0 inflava o valor exibido). Razão sem denominador no bucket → null.
function mediaBucket(dias: DiaDado[], metrica: MetricaHeatmap): number | null {
  if (!dias.length) return null
  const soma = (k: 'investimento' | 'impressoes' | 'cliques' | 'compras' | 'valorGerado') =>
    dias.reduce((s, d) => s + d[k], 0)
  const der = derivarMetricas({
    gasto: soma('investimento'), impressoes: soma('impressoes'),
    cliques: soma('cliques'), compras: soma('compras'), valorGerado: soma('valorGerado'),
  })
  switch (metrica) {
    case 'roas': return soma('investimento') > 0 ? der.roas : null
    case 'cac':  return soma('compras') > 0 ? der.cac : null
    case 'ctr':  return soma('impressoes') > 0 ? der.ctr : null
    default:     return soma(metrica) / dias.length
  }
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface TelaTendenciasProps {
  dadosCampanha: CampanhaDiaTendencias[]
  geoRegioes: GeoCampanhaRow[]  // geo POR CAMPANHA — a tela filtra e agrega
  geoPaises: GeoCampanhaRow[]
  campanhasAtivas?: Record<string, boolean>
  de?: string
  ate?: string
}

export function TelaTendencias({ dadosCampanha, geoRegioes, geoPaises, campanhasAtivas = {}, de: deInicial, ate: ateInicial }: TelaTendenciasProps) {
  const router = useRouter()
  const [objetivo,   setObjetivo]   = useState<Objetivo>('todos')
  const [temperatura, setTemp]      = useState<Temperatura>('todos')
  const [filtroFunil, setFiltroFunil] = useState<FiltroState>(FILTRO_VAZIO)
  const [de,         setDe]         = useState(deInicial ?? subDias(29))
  const [ate,        setAte]        = useState(ateInicial ?? hoje())
  const [metricasAtivas, setMetricasAtivas] = useState<string[]>(['investimento', 'roas'])
  const [hmDia,      setHmDia]      = useState<MetricaHeatmap>('roas')
  const [hmAgrup,    setHmAgrup]    = useState<'semanas' | 'meses' | 'dias' | 'mes'>('dias')
  const [hmRegiao,   setHmRegiao]   = useState<MetricaHeatmapRegiao>('investimento')
  const [mapaModo,   setMapaModo]   = useState<MapaModo>('brasil')
  const [mapaHover,  setMapaHover]  = useState<string | null>(null)

  // Mudou o período → atualiza a URL, o que dispara um novo fetch no servidor
  // (a página é force-dynamic e busca gráfico, heatmaps e mapas com o intervalo escolhido)
  useEffect(() => {
    if (!de || !ate || (de === deInicial && ate === ateInicial)) return
    const params = new URLSearchParams({ de, ate })
    router.push(`/dashboard/tendencias?${params.toString()}`)
  }, [de, ate, deInicial, ateInicial, router])

  const periodo = useMemo(() => {
    const diff = Math.round((new Date(ate).getTime() - new Date(de).getTime()) / 86400000) + 1
    return Math.max(diff, 1)
  }, [de, ate])

  // Filtra por período/objetivo/temperatura/filtro inteligente e agrega por dia
  const dados = useMemo((): DiaDado[] => {
    const temStatus = Object.keys(campanhasAtivas).length > 0
    const filtrados = dadosCampanha.filter(c => {
      const dataOk = c.data >= de && c.data <= ate
      const objOk  = objetivo === 'todos' || c.objetivo === objetivo
      const tempOk = temperatura === 'todos'
        || (temperatura === 'nao_identificado' ? c.temperatura === 'neutro' : c.temperatura === temperatura)
      const funilOk = passaFiltroNome(c.campanhaNome, filtroFunil)
      // "Campanha ativa" só filtra se o mapa de status chegou (o fetch pode degradar)
      const ativaOk = !filtroFunil.ativoCampanha || !temStatus || campanhasAtivas[c.campanhaId] === true
      return dataOk && objOk && tempOk && funilOk && ativaOk
    })

    // Agrupa por data → DiaDado
    const porData = new Map<string, DiaDado>()
    filtrados.forEach(c => {
      const existing = porData.get(c.data)
      if (existing) {
        existing.investimento += c.investimento
        existing.impressoes   += c.impressoes
        existing.cliques      += c.cliques
        existing.compras      += c.compras
        existing.valorGerado  += c.valorGerado
      } else {
        porData.set(c.data, { ...c, data: c.data })
      }
    })

    // Recalcula métricas derivadas e ordena por data.
    // semanaIdx NÃO é recalculado aqui: o servidor já o deriva da DATA real
    // (tendencias.ts). Recalcular pela posição no array desalinhava as semanas
    // e colidia células do heatmap quando havia dias sem veiculação.
    return Array.from(porData.values())
      .sort((a, b) => a.data.localeCompare(b.data))
      .map(d => {
        // Derivadas da fonte única — uma fórmula só (lib/metrics/derivar.ts)
        const der = derivarMetricas({ gasto: d.investimento, impressoes: d.impressoes, cliques: d.cliques, compras: d.compras, valorGerado: d.valorGerado })
        return {
          ...d,
          roas: der.roas,
          cac:  der.cac,
          ctr:  der.ctr,
          cpm:  der.cpm,
        }
      })
  }, [dadosCampanha, de, ate, objetivo, temperatura, filtroFunil, campanhasAtivas])

  // Mapa segue os MESMOS filtros do resto da tela: o geo chega POR CAMPANHA e é
  // filtrado aqui (antes, agregado por conta, o mapa ignorava objetivo/temperatura/
  // filtro inteligente e pintava a conta inteira ao lado de KPIs filtrados).
  // O período já vem filtrado do fetch (time_range de..ate).
  const agregarGeo = useMemo(() => {
    const temStatus = Object.keys(campanhasAtivas).length > 0
    const passa = (r: GeoCampanhaRow) => {
      const objOk  = objetivo === 'todos' || r.objetivo === objetivo
      const tempOk = temperatura === 'todos'
        || (temperatura === 'nao_identificado' ? r.temperatura === 'neutro' : r.temperatura === temperatura)
      const funilOk = passaFiltroNome(r.campanhaNome, filtroFunil)
      const ativaOk = !filtroFunil.ativoCampanha || !temStatus || campanhasAtivas[r.campanhaId] === true
      return objOk && tempOk && funilOk && ativaOk
    }
    return (rows: GeoCampanhaRow[]): DadoGeoTendencias[] => {
      const por = new Map<string, DadoGeoTendencias & { cliques: number }>()
      for (const r of rows) {
        if (!passa(r)) continue
        const cur = por.get(r.sigla)
        if (cur) {
          cur.investimento += r.investimento
          cur.impressoes   += r.impressoes
          cur.cliques      += r.cliques
          cur.compras      += r.compras
          cur.valorGerado  += r.valorGerado
        } else {
          por.set(r.sigla, {
            nome: r.nome, sigla: r.sigla, lat: r.lat, lon: r.lon,
            investimento: r.investimento, impressoes: r.impressoes, cliques: r.cliques,
            compras: r.compras, valorGerado: r.valorGerado, roas: 0, ctr: 0,
          })
        }
      }
      // Razões recomputadas das somas do recorte (fórmulas canônicas do app)
      for (const d of por.values()) {
        d.ctr  = d.impressoes > 0 ? (d.cliques / d.impressoes) * 100 : 0
        d.roas = d.investimento > 0 ? d.valorGerado / d.investimento : 0
      }
      return Array.from(por.values()).sort((a, b) => b.investimento - a.investimento)
    }
  }, [objetivo, temperatura, filtroFunil, campanhasAtivas])

  const regioes   = useMemo(() => agregarGeo(geoRegioes), [agregarGeo, geoRegioes])
  const paises    = useMemo(() => agregarGeo(geoPaises), [agregarGeo, geoPaises])
  const dadosMapa = mapaModo === 'brasil' ? regioes : paises

  // Heatmap: semanas × dias
  const semanas = useMemo(() => {
    const map = new Map<number, Partial<Record<number, DiaDado>>>()
    dados.forEach(d => {
      if (!map.has(d.semanaIdx)) map.set(d.semanaIdx, {})
      map.get(d.semanaIdx)![d.diaSemana] = d
    })
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [dados])

  // Heatmap: meses × dias — cada célula agrega os dias daquele dia-da-semana no
  // mês via mediaBucket (razões recomputadas das somas; média aritmética das
  // razões diárias distorcia CAC/ROAS/CTR)
  const meses = useMemo(() => {
    const map = new Map<string, Partial<Record<number, DiaDado[]>>>()
    dados.forEach(d => {
      const mesKey = d.data.slice(0, 7) // "YYYY-MM"
      if (!map.has(mesKey)) map.set(mesKey, {})
      const row = map.get(mesKey)!
      ;(row[d.diaSemana] ??= []).push(d)
    })
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mesKey, dias]) => {
        const [yyyy, mm] = mesKey.split('-')
        const label = `${MESES_LABEL[parseInt(mm) - 1]} ${yyyy}`
        const medias: Partial<Record<number, DiaDado>> = {}
        for (let dia = 0; dia <= 6; dia++) {
          const bucket = dias[dia]
          if (!bucket || bucket.length === 0) continue
          const avg: Record<string, unknown> = { data: mesKey, diaSemana: dia, semanaIdx: 0 }
          for (const m of HEATMAP_METRICAS) avg[m.key] = mediaBucket(bucket, m.key) ?? 0
          medias[dia] = avg as unknown as DiaDado
        }
        return [label, medias] as [string, Partial<Record<number, DiaDado>>]
      })
  }, [dados])

  // Guarda contra métrica zerada no período inteiro: Math.min(...[]) = Infinity
  // geraria rgba(...,NaN) e as células sumiriam sem explicação
  const hmVals = dados.map(d => d[hmDia] as number).filter(v => v > 0)
  const hmMin  = hmVals.length ? Math.min(...hmVals) : 0
  const hmMax  = hmVals.length ? Math.max(...hmVals) : 0

  // Linha chart — agrupar por semana se > 60 dias
  const dadosLinha = useMemo(() => {
    if (periodo <= 60) return dados.map(d => ({ ...d, rotulo: fmtData(d.data) }))
    // Agrupamento semanal
    const grupos = new Map<number, DiaDado[]>()
    dados.forEach(d => {
      if (!grupos.has(d.semanaIdx)) grupos.set(d.semanaIdx, [])
      grupos.get(d.semanaIdx)!.push(d)
    })
    return Array.from(grupos.entries()).map(([idx, dias]) => {
      const soma = (k: keyof DiaDado) => dias.reduce((s, d) => s + (d[k] as number), 0)
      return {
        rotulo: `Sem ${idx + 1}`,
        data: dias[0].data,
        diaSemana: 0, semanaIdx: idx,
        investimento: soma('investimento'),
        impressoes:   soma('impressoes'),
        cliques:      soma('cliques'),
        compras:      soma('compras'),
        valorGerado:  soma('valorGerado'),
        // Mesma regra da fonte única (div): sem investimento → 0, nunca "ROAS = receita"
        roas:         soma('investimento') > 0 ? soma('valorGerado') / soma('investimento') : 0,
        cac:          soma('compras') > 0 ? soma('investimento') / soma('compras') : 0,
        ctr:          soma('impressoes') > 0 ? soma('cliques') / soma('impressoes') * 100 : 0,
        cpm:          soma('impressoes') > 0 ? soma('investimento') / soma('impressoes') * 1000 : 0,
      }
    })
  }, [dados, periodo])

  // Totais do período (para sumário)
  const totais = useMemo(() => ({
    investimento: dados.reduce((s, d) => s + d.investimento, 0),
    valorGerado:  dados.reduce((s, d) => s + d.valorGerado, 0),
    compras:      dados.reduce((s, d) => s + d.compras, 0),
    roas:         dados.reduce((s, d) => s + d.investimento, 0) > 0
      ? dados.reduce((s, d) => s + d.valorGerado, 0) / dados.reduce((s, d) => s + d.investimento, 0) : 0,
    cac:          dados.reduce((s, d) => s + d.compras, 0) > 0
      ? dados.reduce((s, d) => s + d.investimento, 0) / dados.reduce((s, d) => s + d.compras, 0) : 0,
  }), [dados])

  function toggleMetrica(key: string) {
    setMetricasAtivas(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  // Estilos
  const segBtn = (ativo: boolean, cor?: string): React.CSSProperties => ({
    padding: '0.28rem 0.7rem', fontFamily: 'var(--font-body)', fontSize: '0.72rem',
    border: 'none', cursor: 'pointer',
    backgroundColor: ativo ? (cor ?? 'var(--color-bg-tertiary)') : 'transparent',
    color: ativo ? 'white' : 'var(--color-text-muted)',
    fontWeight: ativo ? 700 : 400,
  })

  const grupo = (children: React.ReactNode, label?: string): React.ReactNode => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {label && <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>}
      <div style={{ display: 'flex', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )

  const hmSelect = (val: string, onChange: (v: MetricaHeatmap) => void): React.ReactNode => (
    <select value={val} onChange={e => onChange(e.target.value as MetricaHeatmap)} style={{ padding: '0.25rem 0.5rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
      {HEATMAP_METRICAS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
    </select>
  )

  const hmSelectRegiao = (val: string, onChange: (v: MetricaHeatmapRegiao) => void): React.ReactNode => (
    <select value={val} onChange={e => onChange(e.target.value as MetricaHeatmapRegiao)} style={{ padding: '0.25rem 0.5rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
      {HEATMAP_METRICAS_REGIAO.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
    </select>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--color-bg-primary)' }}>

      {/* ── Header + Filtros ─────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid var(--color-border-subtle)', backgroundColor: 'var(--color-bg-secondary)' }}>
        <div style={{ padding: '1rem 2rem 0.75rem', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1.5rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '0.03em', flexShrink: 0 }}>
            TENDENCIAS
          </h1>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>

            {/* Filtro inteligente */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Filtro</span>
              <FiltroFunil filtro={filtroFunil} onChange={setFiltroFunil} niveis={['campanha']} />
            </div>

            {/* Objetivo / Corredor */}
            {grupo(
              <>
                {(['todos','VENDAS','LEADS','CPT','C1','C2','C3'] as Objetivo[]).map((o, i, arr) => (
                  <button key={o} onClick={() => setObjetivo(o)} style={{ ...segBtn(objetivo === o, 'var(--color-ponto-conversao)'), borderRight: i < arr.length - 1 ? '1px solid var(--color-border-subtle)' : 'none' }}>
                    {o === 'todos' ? 'Todos' : o}
                  </button>
                ))}
              </>,
              'Objetivo'
            )}

            {/* Temperatura */}
            {grupo(
              <>
                {([
                  { v: 'todos',           l: 'Todos' },
                  { v: 'fundo',           l: 'Frio'  },
                  { v: 'quente',          l: 'Quente' },
                  { v: 'nao_identificado',l: 'Não Ident.' },
                ] as { v: Temperatura; l: string }[]).map((t, i, arr) => (
                  <button key={t.v} onClick={() => setTemp(t.v)} style={{ ...segBtn(temperatura === t.v, '#46619E'), borderRight: i < arr.length - 1 ? '1px solid var(--color-border-subtle)' : 'none' }}>
                    {t.l}
                  </button>
                ))}
              </>,
              'Temperatura'
            )}

            {/* Período */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Período</span>
              <SeletorPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} atalhos={[7, 14, 30, 60, 90, 180, 365]} />
            </div>
          </div>
        </div>

        {/* KPIs rápidos */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderTop: '1px solid var(--color-border-subtle)' }}>
          {[
            { label: 'Investimento', val: brl(totais.investimento) },
            { label: 'Receita',      val: brl(totais.valorGerado) },
            { label: 'ROAS',         val: `${totais.roas.toFixed(2)}x` },
            { label: 'Compras',      val: String(totais.compras) },
            // CPA sem compras não é R$ 0,00 — é incalculável (div protegida devolve 0)
            { label: 'CPA',          val: totais.cac > 0 ? brl(totais.cac) : '—' },
          ].map(({ label, val }, i) => (
            <div key={label} style={{ padding: '0.65rem 1.5rem', borderRight: i < 4 ? '1px solid var(--color-border-subtle)' : 'none' }}>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)', marginBottom: '0.15rem' }}>{label}</p>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1 }}>{val}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Conteúdo scrollável ───────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* Sem dados reais: aviso honesto — nunca inventamos métricas */}
        {dados.length === 0 && (
          <div style={{ padding: '1rem 1.25rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '0.2rem' }}>Sem dados da Meta para este período/filtros</p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.74rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              Ajuste o período ou os filtros acima. Se o problema persistir, a Meta pode ter limitado as requisições — tente novamente em alguns minutos.
            </p>
          </div>
        )}

        {/* ── Gráfico de linha ─────────────────────────────────────────── */}
        <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Evolução no período</p>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {METRICAS_LINHA.map(m => {
                const ativa = metricasAtivas.includes(m.key)
                return (
                  <button key={m.key} onClick={() => toggleMetrica(m.key)} style={{ padding: '0.2rem 0.65rem', fontFamily: 'var(--font-body)', fontSize: '0.68rem', borderRadius: 'var(--radius-pill)', border: `1px solid ${ativa ? m.cor : 'var(--color-border-subtle)'}`, backgroundColor: ativa ? `${m.cor}22` : 'transparent', color: ativa ? m.cor : 'var(--color-text-muted)', cursor: 'pointer', fontWeight: ativa ? 700 : 400 }}>
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>

          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={dadosLinha} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(28,28,26,0.04)" />
              <XAxis dataKey="rotulo" tick={{ fontFamily: 'var(--font-body)', fontSize: 10, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} interval={Math.floor(dadosLinha.length / 8)} />
              <YAxis yAxisId="L" orientation="left"  tick={{ fontFamily: 'var(--font-body)', fontSize: 10, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} width={52} tickFormatter={v => v >= 1000 ? `R$${(v/1000).toFixed(0)}k` : `R$${Math.round(v)}`} />
              <YAxis yAxisId="R" orientation="right" tick={{ fontFamily: 'var(--font-body)', fontSize: 10, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} width={36} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)', borderRadius: '8px', fontFamily: 'var(--font-body)', fontSize: '0.72rem' }}
                labelStyle={{ color: 'var(--color-text-primary)', fontWeight: 600, marginBottom: '0.25rem' }}
                formatter={(value, name) => {
                  const v = typeof value === 'number' ? value : Number(value)
                  const m = METRICAS_LINHA.find(x => x.label === name)
                  return [m ? m.formato(v) : v, name as string]
                }}
              />
              <Legend wrapperStyle={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem' }} />
              {METRICAS_LINHA.filter(m => metricasAtivas.includes(m.key)).map(m => (
                <Line key={m.key} yAxisId={m.eixo} type="monotone" dataKey={m.key} name={m.label} stroke={m.cor} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* ── Heatmap dia da semana + Heatmap regiões ──────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>

          {/* Heatmap dia da semana */}
          <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  Desempenho por dia da semana
                </p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                  {hmAgrup === 'dias'    && 'Média agregada de todo o período por dia da semana'}
                  {hmAgrup === 'mes'     && 'Média agregada por mês do período'}
                  {hmAgrup === 'semanas' && 'Cada linha = uma semana do período · temporal'}
                  {hmAgrup === 'meses'   && 'Cada linha = um mês · média por dia da semana'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <div style={{ display: 'flex', backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                  {([['dias', 'Dia ★'], ['mes', 'Mês ★'], ['semanas', 'Semanas'], ['meses', 'Meses']] as const).map(([a, label], i, arr) => (
                    <button key={a} onClick={() => setHmAgrup(a)} style={{
                      padding: '0.25rem 0.65rem',
                      fontFamily: 'var(--font-body)', fontSize: '0.68rem',
                      border: 'none',
                      borderRight: i < arr.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                      backgroundColor: hmAgrup === a ? 'var(--color-ponto-conversao)' : 'transparent',
                      color: hmAgrup === a ? 'white' : 'var(--color-text-muted)',
                      cursor: 'pointer', fontWeight: hmAgrup === a ? 700 : 400,
                    }}>{label}</button>
                  ))}
                </div>
                {hmSelect(hmDia, setHmDia)}
              </div>
            </div>

            {/* Header: labels acima das células */}
            {(hmAgrup === 'dias' || hmAgrup === 'semanas' || hmAgrup === 'meses') && (
              <div style={{ display: 'grid', gridTemplateColumns: hmAgrup === 'dias' ? 'repeat(7, 1fr)' : '56px repeat(7, 1fr)', gap: '4px', marginBottom: '4px' }}>
                {hmAgrup !== 'dias' && <div />}
                {DIAS_LABEL.map(d => (
                  <div key={d} style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-secondary)', textAlign: 'center', fontWeight: 700, letterSpacing: '0.03em' }}>{d}</div>
                ))}
              </div>
            )}

            {/* Grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>

              {/* Modo Dia ★ — uma linha com 7 células grandes */}
              {hmAgrup === 'dias' && (() => {
                const fmt    = HEATMAP_METRICAS.find(m => m.key === hmDia)?.formato
                const hmInv  = HEATMAP_METRICAS.find(m => m.key === hmDia)?.invertido
                const medias = [0,1,2,3,4,5,6].map(dia => mediaBucket(dados.filter(d => d.diaSemana === dia), hmDia))
                const vals   = medias.filter((v): v is number => v !== null)
                const min    = Math.min(...vals)
                const max    = Math.max(...vals)
                const melhor = medias.indexOf(hmInv ? Math.min(...vals) : Math.max(...vals))
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px' }}>
                    {medias.map((media, dia) => {
                      if (media === null) return <div key={dia} style={{ height: '72px', borderRadius: '8px', backgroundColor: 'rgba(28,28,26,0.03)' }} />
                      const bg = heatmapCor(media, min, max, hmInv)
                      const ratio = max > min ? (media - min) / (max - min) : 0
                      const textColor = ratio > 0.45 ? 'rgba(255,255,255,0.95)' : 'rgba(28,28,26,0.65)'
                      const isMelhor = dia === melhor
                      return (
                        <div key={dia} title={fmt ? `${DIAS_LABEL[dia]}: ${fmt(media)}` : ''} style={{
                          height: '72px', borderRadius: '8px', backgroundColor: bg,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px',
                          border: isMelhor ? '2px solid rgba(255,255,255,0.6)' : '2px solid transparent',
                          transition: 'filter 0.15s', cursor: 'default',
                        }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.filter = 'brightness(1.2)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.filter = '' }}
                        >
                          {isMelhor && <span style={{ fontSize: '0.55rem', fontFamily: 'var(--font-body)', color: 'rgba(255,255,255,0.9)', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>★ melhor</span>}
                          {fmt && <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 800, color: textColor, letterSpacing: '0.02em' }}>{fmt(media)}</span>}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {/* Modo Mês ★ — uma linha com N células, uma por mês */}
              {hmAgrup === 'mes' && (() => {
                const fmt   = HEATMAP_METRICAS.find(m => m.key === hmDia)?.formato
                const hmInv = HEATMAP_METRICAS.find(m => m.key === hmDia)?.invertido
                const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
                const mesesUniq = Array.from(new Set(dados.map(d => d.data.slice(0, 7)))).sort()
                const mediasM  = mesesUniq.map(ym => ({ ym, media: mediaBucket(dados.filter(d => d.data.startsWith(ym)), hmDia) }))
                const vals   = mediasM.map(m => m.media).filter((v): v is number => v !== null)
                const min    = Math.min(...vals)
                const max    = Math.max(...vals)
                const melhorIdx = vals.length ? mediasM.findIndex(m => m.media === (hmInv ? Math.min(...vals) : Math.max(...vals))) : -1
                const cols = Math.max(mesesUniq.length, 3)
                return (
                  <div>
                    {/* Labels dos meses */}
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '6px', marginBottom: '4px' }}>
                      {mediasM.map(({ ym }) => {
                        const [, mm] = ym.split('-')
                        return <div key={ym} style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-secondary)', textAlign: 'center', fontWeight: 700 }}>{MESES_PT[parseInt(mm, 10) - 1]}</div>
                      })}
                    </div>
                    {/* Células */}
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '6px' }}>
                      {mediasM.map(({ ym, media }, idx) => {
                        if (media === null) return <div key={ym} style={{ height: '72px', borderRadius: '8px', backgroundColor: 'rgba(28,28,26,0.03)' }} />
                        const bg = heatmapCor(media, min, max, hmInv)
                        const ratio = max > min ? (media - min) / (max - min) : 0
                        const textColor = ratio > 0.45 ? 'rgba(255,255,255,0.95)' : 'rgba(28,28,26,0.65)'
                        const isMelhor = idx === melhorIdx
                        const [, mm] = ym.split('-')
                        return (
                          <div key={ym} title={fmt ? `${MESES_PT[parseInt(mm, 10) - 1]}: ${fmt(media)}` : ''} style={{
                            height: '72px', borderRadius: '8px', backgroundColor: bg,
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px',
                            border: isMelhor ? '2px solid rgba(255,255,255,0.6)' : '2px solid transparent',
                            transition: 'filter 0.15s', cursor: 'default',
                          }}
                            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.filter = 'brightness(1.2)' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.filter = '' }}
                          >
                            {isMelhor && <span style={{ fontSize: '0.55rem', fontFamily: 'var(--font-body)', color: 'rgba(255,255,255,0.9)', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>★ melhor</span>}
                            {fmt && <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 800, color: textColor, letterSpacing: '0.02em' }}>{fmt(media)}</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {/* Modos Semanas / Meses — grid com linhas */}
              {(hmAgrup === 'semanas' || hmAgrup === 'meses') && (hmAgrup === 'semanas' ? semanas : meses).map(([rowLabel, dias]) => (
                <div key={String(rowLabel)} style={{ display: 'grid', gridTemplateColumns: '56px repeat(7, 1fr)', gap: '4px', alignItems: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.58rem', color: 'var(--color-text-muted)', fontWeight: 600, lineHeight: 1.2 }}>
                    {hmAgrup === 'semanas' ? `S${(rowLabel as number) + 1}` : rowLabel}
                  </div>
                  {[0, 1, 2, 3, 4, 5, 6].map(dia => {
                    const d     = dias[dia]
                    const hmInv = HEATMAP_METRICAS.find(m => m.key === hmDia)?.invertido
                    const fmt   = HEATMAP_METRICAS.find(m => m.key === hmDia)?.formato
                    const bruto = d ? (d[hmDia] as number) : null
                    // Custo (métrica invertida) = 0 é "sem compras", não "melhor
                    // célula grátis" — vira sem-dado, como no Dia★/Mês★
                    const val   = bruto !== null && !(hmInv && bruto === 0) ? bruto : null
                    const bg    = val !== null ? heatmapCor(val, hmMin, hmMax, hmInv) : 'rgba(28,28,26,0.03)'
                    const ratio = hmMax > hmMin && val !== null ? (val - hmMin) / (hmMax - hmMin) : 0
                    const textColor = ratio > 0.5 ? 'rgba(255,255,255,0.95)' : 'rgba(28,28,26,0.6)'
                    return (
                      <div key={dia} title={val !== null && fmt ? `${DIAS_LABEL[dia]}: ${fmt(val)}` : ''}
                        style={{ height: '38px', borderRadius: '6px', backgroundColor: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'filter 0.15s' }}
                        onMouseEnter={e => { if (val !== null) (e.currentTarget as HTMLDivElement).style.filter = 'brightness(1.25)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.filter = '' }}
                      >
                        {val !== null && fmt && <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', fontWeight: 700, color: textColor, pointerEvents: 'none' }}>{fmt(val)}</span>}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>

            {/* Legenda — segue a direção da métrica: em CAC (invertida) a cor forte
                é o MENOR valor; "Baixo → Alto" fixo mentia a leitura do grid */}
            {(() => {
              const inv = HEATMAP_METRICAS.find(m => m.key === hmDia)?.invertido
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1rem' }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{inv ? 'Alto' : 'Baixo'}</span>
                  <div style={{ flex: 1, height: '8px', borderRadius: '4px', background: 'linear-gradient(to right, rgba(95,138,60,0.08), rgba(95,138,60,1))' }} />
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{inv ? 'Baixo' : 'Alto'}</span>
                </div>
              )
            })()}
          </div>

          {/* Mapa de bolhas */}
          <div style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                  Distribuição geográfica
                </p>
                {mapaHover && (() => {
                  const d = dadosMapa.find(x => x.sigla === mapaHover)
                  const fmt = HEATMAP_METRICAS_REGIAO.find(m => m.key === hmRegiao)?.formato
                  return d ? (
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-ponto-conversao)', marginTop: '0.1rem', fontWeight: 600 }}>
                      {d.nome} · {fmt ? fmt(d[hmRegiao]) : d[hmRegiao]}
                    </p>
                  ) : null
                })()}
                {!mapaHover && (() => {
                  // Desde o iOS 14, a Meta não divulga conversões do pixel (compras/ROAS)
                  // por região — sem o aviso, o mapa zerado parecia bug do dashboard.
                  const metricaConversao = hmRegiao === 'compras' || hmRegiao === 'roas'
                  const tudoZerado = dadosMapa.every(d => !d[hmRegiao])
                  if (metricaConversao && tudoZerado) {
                    return (
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-signal-yellow)', marginTop: '0.1rem', fontWeight: 600 }}>
                        ⚠ A Meta não fornece compras/ROAS por localização (privacidade iOS 14) — use investimento ou CTR
                      </p>
                    )
                  }
                  return (
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)', marginTop: '0.1rem' }}>
                      Segue os filtros e o período da tela · passe o mouse para detalhes
                    </p>
                  )
                })()}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {hmSelectRegiao(hmRegiao, setHmRegiao)}
                {/* Toggle Brasil/Mundo */}
                <div style={{ display: 'flex', backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                  {(['brasil', 'mundo'] as MapaModo[]).map((m, i) => (
                    <button key={m} onClick={() => setMapaModo(m)} style={{ padding: '0.25rem 0.65rem', fontFamily: 'var(--font-body)', fontSize: '0.68rem', border: 'none', borderRight: i === 0 ? '1px solid var(--color-border-subtle)' : 'none', backgroundColor: mapaModo === m ? 'var(--color-ponto-conversao)' : 'transparent', color: mapaModo === m ? 'white' : 'var(--color-text-muted)', cursor: 'pointer', fontWeight: mapaModo === m ? 700 : 400, textTransform: 'capitalize' }}>
                      {m === 'brasil' ? '🇧🇷 Brasil' : '🌍 Mundo'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* SVG bubble map */}
            <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BubbleMap
                dados={dadosMapa}
                metrica={hmRegiao}
                modo={mapaModo}
                tooltip={mapaHover}
                onHover={setMapaHover}
              />
            </div>

            {/* Legenda */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.58rem', color: 'var(--color-text-muted)' }}>Menor</span>
              <div style={{ flex: 1, height: '5px', borderRadius: '3px', background: 'linear-gradient(to right, rgba(95,138,60,0.15), rgba(95,138,60,0.9))' }} />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.58rem', color: 'var(--color-text-muted)' }}>Maior</span>
            </div>

            {/* Países com gasto real mas fora do dicionário do mapa — nunca somem em silêncio */}
            {mapaModo === 'mundo' && (() => {
              const fora = paises.filter(p => !Number.isFinite(p.lat) && p.investimento > 0)
              if (!fora.length) return null
              const fmt = HEATMAP_METRICAS_REGIAO.find(m => m.key === hmRegiao)?.formato
              return (
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: 'var(--color-text-muted)', marginTop: '0.4rem' }}>
                  Fora do mapa: {fora.map(p => `${p.nome} · ${fmt ? fmt(p[hmRegiao]) : p[hmRegiao]}`).join('  ·  ')}
                </p>
              )
            })()}
          </div>
        </div>

      </div>
    </div>
  )
}
