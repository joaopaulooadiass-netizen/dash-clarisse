'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend, LineChart, Line, CartesianGrid,
} from 'recharts'
import type { TransacaoGateway, ConfigRentabilidade, CustoFixo } from '@/lib/config/rentabilidade'
import type { MetricasCampanhaDia } from '@/lib/types'
import { SeletorPeriodo, hoje, subDias } from '@/components/ui/SeletorPeriodo'
import { parseHublaCSV, decodificarCSV } from '@/lib/gateway/hubla'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function pct(v: number) { return `${v.toFixed(1)}%` }
function fmt(data: string) { const [, m, d] = data.split('-'); return `${d}/${m}` }

// ─── Tipos ────────────────────────────────────────────────────────────────────

// Convenção do João (adaptada pro ManyChat): source=canal, campaign=campanha,
// medium=conjunto, content=anúncio, term=termo (só Google)
type AbaUTM = 'source' | 'campaign' | 'medium' | 'content' | 'term'

const UTM_ABAS: [AbaUTM, string, keyof TransacaoGateway][] = [
  ['source',   'Canal',    'utm_source'],
  ['campaign', 'Campanha', 'utm_campaign'],
  ['medium',   'Conjunto', 'utm_medium'],
  ['content',  'Anúncio',  'utm_content'],
  ['term',     'Termo',    'utm_term'],
]

interface Props {
  metricas: MetricasCampanhaDia[]
  metaFalhou?: boolean // fetch da Meta falhou (rate limit) — investimento ausente, lucro não confiável
  configInicial: ConfigRentabilidade
  de?: string
  ate?: string
}

// ─── Waterfall ────────────────────────────────────────────────────────────────

interface WaterfallItem {
  label: string
  valor: number
  tipo: 'positivo' | 'negativo' | 'resultado'
  descricao: string
}

function WaterfallChart({ items }: { items: WaterfallItem[] }) {
  const max = items.reduce((acc, it) => Math.max(acc, Math.abs(it.valor)), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {items.map((item, i) => {
        const ratio = max > 0 ? Math.abs(item.valor) / max : 0
        const cor =
          item.tipo === 'resultado' ? 'var(--color-ponto-conversao)' :
          item.tipo === 'negativo'  ? 'rgba(224,57,47,0.75)' :
          'rgba(95,138,60,0.75)'

        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: '160px', flexShrink: 0, textAlign: 'right' }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                {item.label}
              </span>
            </div>
            <div style={{ flex: 1, position: 'relative', height: '28px', backgroundColor: 'var(--color-bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, height: '100%',
                width: `${ratio * 100}%`,
                backgroundColor: cor,
                borderRadius: '4px',
                transition: 'width 0.4s ease',
              }} />
              <span style={{
                position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
                fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 600,
                color: 'white', zIndex: 1,
              }}>
                {item.tipo === 'negativo' ? `- ${brl(Math.abs(item.valor))}` : brl(item.valor)}
              </span>
            </div>
            <div style={{ width: '80px', flexShrink: 0 }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
                {item.descricao}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, valor, sub, cor }: { label: string; valor: string; sub?: string; cor?: string }) {
  return (
    <div style={{
      backgroundColor: 'var(--color-bg-secondary)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-md)',
      padding: '1rem 1.25rem',
      borderBottom: cor ? `3px solid ${cor}` : '3px solid transparent',
    }}>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1 }}>{valor}</p>
      {sub && <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: '0.3rem' }}>{sub}</p>}
    </div>
  )
}

// ─── Status Card (Aprovado / Pendente / Perdido) ──────────────────────────────

function StatusCard({ label, valor, qtd, cor, descricao }: {
  label: string; valor: string; qtd: number; cor: string; descricao: string
}) {
  return (
    <div style={{
      backgroundColor: 'var(--color-bg-secondary)',
      border: '1px solid var(--color-border-subtle)',
      borderLeft: `3px solid ${cor}`,
      borderRadius: 'var(--radius-md)',
      padding: '0.85rem 1.1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: cor, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>{qtd} {qtd === 1 ? 'venda' : 'vendas'}</span>
      </div>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1, margin: '0.35rem 0' }}>{valor}</p>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.66rem', color: 'var(--color-text-muted)' }}>{descricao}</p>
    </div>
  )
}

// ─── Input editável ───────────────────────────────────────────────────────────

function InputEditavel({ label, valor, onChange, sufixo, prefixo }: {
  label: string
  valor: number
  onChange: (v: number) => void
  sufixo?: string
  prefixo?: string
}) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState(String(valor))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <label style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', backgroundColor: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.6rem' }}>
        {prefixo && <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{prefixo}</span>}
        {editing ? (
          <input
            autoFocus
            value={raw}
            onChange={e => setRaw(e.target.value)}
            onBlur={() => {
              const n = parseFloat(raw.replace(',', '.'))
              if (!isNaN(n)) onChange(n)
              setEditing(false)
            }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            style={{
              background: 'none', border: 'none', outline: 'none', width: '70px',
              fontFamily: 'var(--font-body)', fontSize: '0.875rem', fontWeight: 600,
              color: 'var(--color-text-primary)',
            }}
          />
        ) : (
          <span
            onClick={() => { setRaw(String(valor)); setEditing(true) }}
            style={{ fontFamily: 'var(--font-body)', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)', cursor: 'text', minWidth: '40px' }}
          >
            {valor}
          </span>
        )}
        {sufixo && <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{sufixo}</span>}
      </div>
    </div>
  )
}

// ─── Tela principal ───────────────────────────────────────────────────────────

const CORES_PIE = ['#5F8A3C', '#E0392F', '#F3850C', '#E8BE0B', '#5F8A3C', '#5C79C9', '#7D68C0', '#D9805C']

const CONFIG_STORAGE_KEY = 'cqv.rentabilidade-config.v1'
const TX_STORAGE_KEY = 'cqv.transacoes-hubla.v1'

interface ImportacaoHubla {
  em: string
  transacoes: TransacaoGateway[]
}

export function TelaFaturamento({ metricas, metaFalhou = false, configInicial, de: deInicial, ate: ateInicial }: Props) {
  const router = useRouter()
  const [de, setDe]             = useState<string>(deInicial ?? subDias(29))
  const [ate, setAte]           = useState<string>(ateInicial ?? hoje())
  const [abaUTM, setAbaUTM]     = useState<AbaUTM>('source')
  const [config, setConfig]     = useState<ConfigRentabilidade>(configInicial)
  const [novoFixo, setNovoFixo] = useState('')

  // Mudou o período → atualiza a URL, o que dispara um novo fetch no servidor
  // (a página é force-dynamic e busca o tráfego da Meta no intervalo escolhido)
  useEffect(() => {
    if (!de || !ate || (de === deInicial && ate === ateInicial)) return
    const params = new URLSearchParams({ de, ate })
    router.push(`/dashboard/rentabilidade?${params.toString()}`)
  }, [de, ate, deInicial, ateInicial, router])

  // Config editada persiste em localStorage (sem banco) — senão some a cada reload
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONFIG_STORAGE_KEY)
      if (!raw) return
      const salvo = JSON.parse(raw) as Partial<ConfigRentabilidade>
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a config salva só existe no cliente (localStorage); inicializar no useState causaria mismatch de hidratação
      setConfig(c => ({ ...c, ...salvo }))
    } catch { /* config corrompida — segue com o padrão */ }
  }, [])

  function salvarConfig(updater: (c: ConfigRentabilidade) => ConfigRentabilidade) {
    setConfig(c => {
      const novo = updater(c)
      try { localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(novo)) } catch { /* storage cheio/bloqueado — mantém só em memória */ }
      return novo
    })
  }

  // ── Vendas reais importadas do CSV da Hubla (persistem em localStorage) ────
  const [importacao, setImportacao] = useState<ImportacaoHubla | null>(null)
  const inputCSVRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TX_STORAGE_KEY)
      if (!raw) return
      const salvo = JSON.parse(raw) as ImportacaoHubla
      if (!Array.isArray(salvo.transacoes) || salvo.transacoes.length === 0) return
      // eslint-disable-next-line react-hooks/set-state-in-effect -- dados importados só existem no cliente (localStorage); inicializar no useState causaria mismatch de hidratação
      setImportacao(salvo)
    } catch { /* importação corrompida — segue sem ela */ }
  }, [])

  async function importarCSV(file: File) {
    const texto = decodificarCSV(await file.arrayBuffer())
    const novas = parseHublaCSV(texto)
    if (novas.length === 0) {
      alert('Nenhuma venda reconhecida — confere se o arquivo é o export de Vendas do painel da Hubla.')
      return
    }
    // Mescla com o que já existe (dedup por id da fatura — reimportar não duplica)
    const porId = new Map((importacao?.transacoes ?? []).map(t => [t.id, t]))
    for (const t of novas) porId.set(t.id, t)
    const novo: ImportacaoHubla = {
      em: new Date().toISOString(),
      transacoes: Array.from(porId.values()).sort((a, b) => a.data.localeCompare(b.data)),
    }
    setImportacao(novo)
    try { localStorage.setItem(TX_STORAGE_KEY, JSON.stringify(novo)) } catch { /* mantém em memória */ }
  }

  function limparImportacao() {
    setImportacao(null)
    try { localStorage.removeItem(TX_STORAGE_KEY) } catch { /* ok */ }
  }

  const temImportacao = (importacao?.transacoes.length ?? 0) > 0
  // Vendas vêm SÓ do CSV/webhook da Hubla — sem importação, vazio honesto.
  // Nada de estimar vendas pelo pixel (fabricaria transação que não existe).
  const transacoesBase = importacao?.transacoes ?? []

  // ─── Filtro por período ─────────────────────────────────────────────────────

  const txFiltradas = useMemo(() => {
    return transacoesBase.filter(t => t.data >= de && t.data <= ate)
  }, [transacoesBase, de, ate])

  const metFiltradas = useMemo(() => {
    return metricas.filter(m => m.data >= de && m.data <= ate)
  }, [metricas, de, ate])

  // ─── Cálculos base ──────────────────────────────────────────────────────────

  // Três baldes por status — só o APROVADO entra no lucro. Pendente (ainda não
  // pago) e Perdido (reembolso/chargeback) ficam num scorecard à parte, pra não
  // inflar o faturamento com dinheiro que não entrou ou que já voltou.
  const vendasAprovadas = useMemo(() => txFiltradas.filter(t => t.status === 'aprovado'), [txFiltradas])
  const vendasPendentes = useMemo(() => txFiltradas.filter(t => t.status === 'pendente'), [txFiltradas])
  const vendasPerdidas  = useMemo(() => txFiltradas.filter(t => t.status === 'reembolso' || t.status === 'chargeback'), [txFiltradas])

  const receitaAprovada = useMemo(() => vendasAprovadas.reduce((s, t) => s + t.valor, 0), [vendasAprovadas])
  const receitaPendente = useMemo(() => vendasPendentes.reduce((s, t) => s + t.valor, 0), [vendasPendentes])
  const receitaPerdida  = useMemo(() => vendasPerdidas.reduce((s, t) => s + t.valor, 0), [vendasPerdidas])

  // Receita Bruta = só o aprovado (dinheiro que entrou e ficou)
  const receitaBruta = receitaAprovada

  // Taxa REAL por venda quando o CSV/webhook traz o valor líquido;
  // estimativa da config (4,9% + R$ 2,49) só para vendas sem esse dado
  const taxasGateway = vendasAprovadas.reduce((s, t) =>
    s + (t.valorLiquido != null
      ? t.valor - t.valorLiquido
      : t.valor * (config.taxaGatewayPct / 100) + config.taxaGatewayFixa), 0)
  const receitaLiquida = receitaBruta - taxasGateway
  const cmv            = receitaLiquida * (config.cmvPct / 100)
  const margemBruta    = receitaLiquida - cmv
  const investimentoAds = metFiltradas.reduce((s, m) => s + m.gasto, 0)
  const margemContrib  = margemBruta - investimentoAds
  // Custos fixos são MENSAIS — pró-rata pelo período selecionado. Antes o mês
  // inteiro era subtraído sempre: lucro inflado em 90/365d (1 mês de fixos para
  // 3-12 meses de receita) e esmagado em 7d (1 mês de fixos numa semana).
  const diasPeriodo    = Math.round((new Date(`${ate}T12:00:00Z`).getTime() - new Date(`${de}T12:00:00Z`).getTime()) / 86_400_000) + 1
  const fixosMensais   = config.custosFixos.reduce((s, c) => s + c.valor, 0)
  const totalFixos     = fixosMensais * (diasPeriodo / 30.44)  // 30.44 = mês médio
  const lucroLiquido   = margemContrib - totalFixos

  const ticketMedio = vendasAprovadas.length > 0 ? receitaAprovada / vendasAprovadas.length : 0
  const totalVendas = vendasAprovadas.length
  // % do que foi pago (aprovado + perdido) que acabou estornado — nunca passa de 100%
  const baseReembolso = receitaAprovada + receitaPerdida
  const taxaReembolso = baseReembolso > 0 ? (receitaPerdida / baseReembolso) * 100 : 0

  // ─── Waterfall ──────────────────────────────────────────────────────────────

  const waterfall: WaterfallItem[] = [
    { label: 'Receita Aprovada',     valor: receitaBruta,    tipo: 'positivo',  descricao: `${totalVendas} vendas pagas`  },
    { label: temImportacao ? 'Taxas Hubla (reais por fatura)' : `Taxas Hubla (est. ${config.taxaGatewayPct}% + ${brl(config.taxaGatewayFixa)})`, valor: taxasGateway, tipo: 'negativo', descricao: `${vendasAprovadas.length} vendas` },
    { label: 'Receita Líquida',      valor: receitaLiquida, tipo: 'resultado', descricao: ''                               },
    { label: `CMV (${config.cmvPct}%)`, valor: cmv,         tipo: 'negativo',  descricao: 'Custo produto'                 },
    { label: 'Margem Bruta',         valor: margemBruta,    tipo: 'resultado', descricao: pct(receitaLiquida > 0 ? margemBruta / receitaLiquida * 100 : 0) },
    { label: 'Investimento Ads',     valor: investimentoAds,tipo: 'negativo',  descricao: 'Meta Ads'                      },
    { label: 'Margem Contribuição',  valor: margemContrib,  tipo: 'resultado', descricao: pct(receitaLiquida > 0 ? margemContrib / receitaLiquida * 100 : 0) },
    { label: `Custos Fixos (pró-rata ${diasPeriodo}d)`, valor: totalFixos, tipo: 'negativo', descricao: `${config.custosFixos.length} itens · ${brl(fixosMensais)}/mês`},
    { label: 'Lucro Líquido',        valor: lucroLiquido,   tipo: 'resultado', descricao: pct(receitaLiquida > 0 ? lucroLiquido / receitaLiquida * 100 : 0) },
  ]

  // ─── Receita por dia ────────────────────────────────────────────────────────

  const receitaDia = useMemo(() => {
    const mapa: Record<string, { receita: number; gasto: number }> = {}
    txFiltradas.filter(t => t.status === 'aprovado').forEach(t => {
      if (!mapa[t.data]) mapa[t.data] = { receita: 0, gasto: 0 }
      mapa[t.data].receita += t.valor
    })
    metFiltradas.forEach(m => {
      if (!mapa[m.data]) mapa[m.data] = { receita: 0, gasto: 0 }
      mapa[m.data].gasto += m.gasto
    })
    // Valores exatos — Math.round aqui fabricava "R$ 1.706,00" no tooltip
    return Object.entries(mapa).sort(([a], [b]) => a.localeCompare(b)).map(([data, v]) => ({
      data: fmt(data),
      receita: v.receita,
      gasto: v.gasto,
    }))
  }, [txFiltradas, metFiltradas])

  // ─── UTM breakdown ──────────────────────────────────────────────────────────

  const utmDados = useMemo(() => {
    const chave = UTM_ABAS.find(([k]) => k === abaUTM)![2] as 'utm_source' | 'utm_campaign' | 'utm_medium' | 'utm_content' | 'utm_term'
    const mapa: Record<string, { receita: number; vendas: number }> = {}
    txFiltradas.filter(t => t.status === 'aprovado').forEach(t => {
      const k = t[chave] || '(não rastreado)'
      if (!mapa[k]) mapa[k] = { receita: 0, vendas: 0 }
      mapa[k].receita += t.valor
      mapa[k].vendas  += 1
    })
    // Participação sobre a receita aprovada BRUTA (mesma base do numerador) —
    // dividir pelo líquido (pós-taxas) fazia as fatias somarem mais de 100%
    return Object.entries(mapa)
      .map(([nome, v]) => ({
        nome,
        receita: v.receita,
        vendas: v.vendas,
        ticket: v.receita / v.vendas,
        participacao: receitaAprovada > 0 ? (v.receita / receitaAprovada) * 100 : 0,
      }))
      .sort((a, b) => b.receita - a.receita)
  }, [txFiltradas, abaUTM, receitaAprovada])

  // ─── Produtos vendidos ──────────────────────────────────────────────────────
  // Agrupa vendas aprovadas por produto — cor estável por produto nas duas pizzas
  const produtosDados = useMemo(() => {
    const mapa: Record<string, { vendas: number; receita: number }> = {}
    txFiltradas.filter(t => t.status === 'aprovado').forEach(t => {
      const k = t.produto || '(sem produto)'
      if (!mapa[k]) mapa[k] = { vendas: 0, receita: 0 }
      mapa[k].vendas += 1
      mapa[k].receita += t.valor
    })
    const totalReceita = Object.values(mapa).reduce((s, v) => s + v.receita, 0)
    return Object.entries(mapa)
      .map(([nome, v], ) => ({
        nome,
        vendas: v.vendas,
        receita: v.receita,
        ticket: v.receita / v.vendas,
        participacao: totalReceita > 0 ? (v.receita / totalReceita) * 100 : 0,
      }))
      .sort((a, b) => b.receita - a.receita)
      .map((d, i) => ({ ...d, cor: CORES_PIE[i % CORES_PIE.length] }))
  }, [txFiltradas])

  const nomeCurto = (n: string) => n.length > 26 ? n.slice(0, 26) + '…' : n

  // Top 7 + fatia "Outros" — sem ela a pizza parecia 100% da receita quando havia
  // mais origens além das sete maiores
  const pieDados = (() => {
    const top = utmDados.slice(0, 7).map((d, i) => ({
      name: d.nome.length > 22 ? d.nome.slice(0, 22) + '…' : d.nome,
      value: d.receita,
      cor: CORES_PIE[i % CORES_PIE.length],
    }))
    const resto = utmDados.slice(7).reduce((s, d) => s + d.receita, 0)
    return resto > 0 ? [...top, { name: `Outros (${utmDados.length - 7})`, value: resto, cor: 'rgba(138,138,126,0.45)' }] : top
  })()

  // ─── Helpers de config ──────────────────────────────────────────────────────

  function adicionarCustoFixo() {
    const nome = novoFixo.trim()
    if (!nome) return
    salvarConfig(c => ({ ...c, custosFixos: [...c.custosFixos, { id: `cf-${Date.now()}`, nome, valor: 0 }] }))
    setNovoFixo('')
  }

  function removerCustoFixo(id: string) {
    salvarConfig(c => ({ ...c, custosFixos: c.custosFixos.filter(f => f.id !== id) }))
  }

  function atualizarCustoFixo(id: string, campo: keyof CustoFixo, valor: string | number) {
    salvarConfig(c => ({
      ...c,
      custosFixos: c.custosFixos.map(f => f.id === id ? { ...f, [campo]: valor } : f),
    }))
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const S = {
    page: {
      display: 'flex' as const,
      flexDirection: 'column' as const,
      gap: '1.5rem',
      padding: '1.5rem',
      minHeight: '100vh',
      backgroundColor: 'var(--color-bg-primary)',
      overflowY: 'auto' as const,
    },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: '0.75rem' },
    titulo: { fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text-primary)' },
    periodos: { display: 'flex', gap: '0.25rem' },
    btnPeriodo: (ativo: boolean) => ({
      padding: '0.35rem 0.75rem',
      borderRadius: 'var(--radius-sm)',
      border: 'none',
      fontFamily: 'var(--font-body)',
      fontSize: '0.75rem',
      fontWeight: ativo ? 700 : 400,
      backgroundColor: ativo ? 'var(--color-ponto-conversao)' : 'var(--color-bg-tertiary)',
      color: ativo ? 'white' : 'var(--color-text-secondary)',
      cursor: 'pointer',
    }),
    grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' },
    grid3: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' },
    grid4: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' },
    card: {
      backgroundColor: 'var(--color-bg-secondary)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-md)',
      padding: '1.25rem',
    },
    cardTitulo: { fontFamily: 'var(--font-display)', fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '1rem' },
    abaBtn: (ativa: boolean) => ({
      padding: '0.25rem 0.65rem',
      border: 'none',
      backgroundColor: ativa ? 'var(--color-ponto-conversao)' : 'transparent',
      color: ativa ? 'white' : 'var(--color-text-muted)',
      fontFamily: 'var(--font-body)',
      fontSize: '0.7rem',
      fontWeight: ativa ? 700 : 400,
      cursor: 'pointer',
      borderRadius: 'var(--radius-sm)',
    }),
  }

  return (
    <div style={S.page}>

      {/* Falha da Meta é DIFERENTE de gasto zero: sem o aviso, "Investimento Ads
          R$ 0,00" entrava na cascata como real e o Lucro Líquido saía inflado */}
      {metaFalhou && (
        <div style={{ padding: '0.7rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(224,57,47,0.45)', backgroundColor: 'rgba(224,57,47,0.08)', fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: '#B3372A', fontWeight: 600 }}>
          ⚠ Dados da Meta indisponíveis agora (provável rate limit). O investimento em anúncios NÃO está incluído — cascata e Lucro Líquido ficam superestimados até recarregar.
        </div>
      )}

      {/* Header */}
      <div style={S.header}>
        <div>
          <h1 style={S.titulo}>Faturamento</h1>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
            Receita do gateway · origem por UTM · waterfall de margens
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            ref={inputCSVRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) importarCSV(f); e.target.value = '' }}
          />
          {temImportacao && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.3rem 0.65rem', borderRadius: '999px', border: '1px solid rgba(95,138,60,0.4)', backgroundColor: 'rgba(95,138,60,0.08)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-signal-green)', fontWeight: 600 }}>
              Hubla CSV · {importacao!.transacoes.length} vendas
              <button onClick={limparImportacao} title="Remover importação"
                style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: 0 }}>×</button>
            </span>
          )}
          <button onClick={() => inputCSVRef.current?.click()}
            style={{ padding: '0.45rem 0.85rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-subtle)', backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}>
            ⬆ Importar CSV Hubla
          </button>
          <SeletorPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} atalhos={[7, 30, 60, 90, 180, 365]} minData={subDias(1095)} maxData={hoje()} />
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem' }}>
        <KpiCard label="Receita Aprovada" valor={brl(receitaBruta)}   cor="var(--color-signal-green)" sub={`${totalVendas} vendas pagas`} />
        <KpiCard label="Receita Líquida"  valor={brl(receitaLiquida)} cor="var(--color-signal-green)" sub="Após taxas Hubla" />
        <KpiCard label="Lucro Líquido"    valor={brl(lucroLiquido)}   cor={lucroLiquido >= 0 ? 'var(--color-signal-green)' : 'var(--color-signal-red)'} sub={pct(receitaBruta > 0 ? lucroLiquido / receitaBruta * 100 : 0) + ' da aprovada'} />
        <KpiCard label="Ticket Médio"     valor={brl(ticketMedio)}    cor="var(--color-ponto-conversao)" />
        <KpiCard label="Vendas Aprovadas" valor={String(totalVendas)} sub={temImportacao ? 'Hubla CSV' : 'Importe o CSV'} />
      </div>

      {/* Scorecard por status — Pendente e Perdido NÃO entram no lucro */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
        <StatusCard label="Aprovado" valor={brl(receitaAprovada)} qtd={vendasAprovadas.length} cor="var(--color-signal-green)"  descricao="Entrou e ficou — base do lucro" />
        <StatusCard label="Pendente" valor={brl(receitaPendente)} qtd={vendasPendentes.length} cor="var(--color-signal-yellow)" descricao="Aguardando pagamento (pix/boleto)" />
        <StatusCard label="Perdido"  valor={brl(receitaPerdida)}  qtd={vendasPerdidas.length}  cor="var(--color-signal-red)"    descricao={`Reembolso/chargeback · ${pct(taxaReembolso)} do pago`} />
      </div>

      {/* Gráfico linha + Waterfall */}
      <div style={S.grid2}>

        {/* Receita vs Investimento */}
        <div style={S.card}>
          <p style={S.cardTitulo}>Receita vs Investimento</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={receitaDia} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(28,28,26,0.05)" />
              <XAxis dataKey="data" tick={{ fontFamily: 'var(--font-body)', fontSize: 10, fill: 'var(--color-text-muted)' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontFamily: 'var(--font-body)', fontSize: 10, fill: 'var(--color-text-muted)' }} tickFormatter={v => { const n = v as number; return n >= 1000 ? `R$${(n / 1000).toFixed(0)}k` : `R$${Math.round(n)}` }} width={52} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: '6px', fontFamily: 'var(--font-body)', fontSize: '0.75rem' }}
                formatter={(v: unknown, name: unknown) => [brl(v as number), name === 'receita' ? 'Receita' : 'Investimento']}
              />
              <Line type="monotone" dataKey="receita"  stroke="#5F8A3C" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="gasto"    stroke="#E0392F" strokeWidth={2} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', justifyContent: 'center' }}>
            {[['#5F8A3C', 'Receita'], ['#E0392F', 'Ads']].map(([cor, label]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <div style={{ width: 12, height: 3, backgroundColor: cor, borderRadius: 2 }} />
                <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Waterfall */}
        <div style={S.card}>
          <p style={S.cardTitulo}>Cascata de Margens</p>
          <WaterfallChart items={waterfall} />
        </div>
      </div>

      {/* UTM breakdown + Pizza */}
      <div style={S.grid2}>

        {/* Tabela UTM */}
        <div style={S.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <p style={{ ...S.cardTitulo, marginBottom: 0 }}>Origem da Receita</p>
            <div style={{ display: 'flex', gap: '0.2rem', backgroundColor: 'var(--color-bg-tertiary)', padding: '0.2rem', borderRadius: 'var(--radius-sm)' }}>
              {UTM_ABAS.map(([k, label]) => (
                <button key={k} style={S.abaBtn(abaUTM === k)} onClick={() => setAbaUTM(k)}>{label}</button>
              ))}
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: '0.75rem' }}>
              <thead>
                <tr>
                  {['UTM', 'Receita', 'Vendas', 'Ticket', '% Total'].map(h => (
                    <th key={h} style={{ textAlign: h === 'UTM' ? 'left' : 'right', padding: '0.4rem 0.5rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border-subtle)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {utmDados.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(28,28,26,0.04)' }}>
                    <td style={{ padding: '0.45rem 0.5rem', color: 'var(--color-text-primary)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.nome}>{row.nome}</td>
                    <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', color: 'var(--color-text-primary)', fontWeight: 600 }}>{brl(row.receita)}</td>
                    <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', color: 'var(--color-text-secondary)' }}>{row.vendas}</td>
                    <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', color: 'var(--color-text-secondary)' }}>{brl(row.ticket)}</td>
                    <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right' }}>
                      <span style={{ backgroundColor: 'rgba(95,138,60,0.15)', color: 'var(--color-ponto-conversao)', padding: '0.1rem 0.4rem', borderRadius: '3px', fontWeight: 600 }}>
                        {pct(row.participacao)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pizza */}
        <div style={S.card}>
          <p style={S.cardTitulo}>Distribuição por {UTM_ABAS.find(([k]) => k === abaUTM)![1]}</p>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={pieDados} dataKey="value" nameKey="name" cx="40%" cy="50%" outerRadius={100} innerRadius={50}>
                {pieDados.map((entry, i) => (
                  <Cell key={i} fill={entry.cor} />
                ))}
              </Pie>
              <Legend
                layout="vertical"
                align="right"
                verticalAlign="middle"
                formatter={(value: string) => (
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-secondary)' }}>{value}</span>
                )}
              />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: '6px', fontFamily: 'var(--font-body)', fontSize: '0.75rem' }}
                formatter={(v: unknown) => [brl(v as number), 'Receita']}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Produtos vendidos: tabela + pizzas de vendas e faturamento */}
      <div style={S.card}>
        <p style={S.cardTitulo}>Produtos Vendidos</p>
        {produtosDados.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--color-text-muted)', padding: '1rem 0' }}>
            Sem vendas aprovadas no período — importe o CSV da Hubla ou ajuste o intervalo.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: '0.75rem' }}>
              <thead>
                <tr>
                  {['Produto', 'Vendas', 'Receita', 'Ticket médio', '% Receita'].map(h => (
                    <th key={h} style={{ textAlign: h === 'Produto' ? 'left' : 'right', padding: '0.4rem 0.5rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border-subtle)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {produtosDados.map(row => (
                  <tr key={row.nome} style={{ borderBottom: '1px solid rgba(28,28,26,0.04)' }}>
                    <td style={{ padding: '0.45rem 0.5rem', color: 'var(--color-text-primary)', maxWidth: '280px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: row.cor, flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.nome}>{row.nome}</span>
                      </div>
                    </td>
                    <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', color: 'var(--color-text-secondary)' }}>{row.vendas}</td>
                    <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', color: 'var(--color-text-primary)', fontWeight: 600 }}>{brl(row.receita)}</td>
                    <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', color: 'var(--color-text-secondary)' }}>{brl(row.ticket)}</td>
                    <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right' }}>
                      <span style={{ backgroundColor: 'rgba(95,138,60,0.15)', color: 'var(--color-ponto-conversao)', padding: '0.1rem 0.4rem', borderRadius: '3px', fontWeight: 600 }}>
                        {pct(row.participacao)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {produtosDados.length > 0 && (
        <div style={S.grid2}>
          {/* Pizza: unidades vendidas por produto */}
          <div style={S.card}>
            <p style={S.cardTitulo}>Vendas por Produto</p>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={produtosDados.map(d => ({ name: nomeCurto(d.nome), value: d.vendas, cor: d.cor }))} dataKey="value" nameKey="name" cx="40%" cy="50%" outerRadius={100} innerRadius={50}>
                  {produtosDados.map((d, i) => <Cell key={i} fill={d.cor} />)}
                </Pie>
                <Legend
                  layout="vertical" align="right" verticalAlign="middle"
                  formatter={(value: string) => (
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-secondary)' }}>{value}</span>
                  )}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: '6px', fontFamily: 'var(--font-body)', fontSize: '0.75rem' }}
                  formatter={(v: unknown) => [`${v} venda${(v as number) === 1 ? '' : 's'}`, 'Quantidade']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Pizza: faturamento por produto */}
          <div style={S.card}>
            <p style={S.cardTitulo}>Faturamento por Produto</p>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={produtosDados.map(d => ({ name: nomeCurto(d.nome), value: Math.round(d.receita * 100) / 100, cor: d.cor }))} dataKey="value" nameKey="name" cx="40%" cy="50%" outerRadius={100} innerRadius={50}>
                  {produtosDados.map((d, i) => <Cell key={i} fill={d.cor} />)}
                </Pie>
                <Legend
                  layout="vertical" align="right" verticalAlign="middle"
                  formatter={(value: string) => (
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-secondary)' }}>{value}</span>
                  )}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: '6px', fontFamily: 'var(--font-body)', fontSize: '0.75rem' }}
                  formatter={(v: unknown) => [brl(v as number), 'Receita']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Config de margens */}
      <div style={S.grid2}>

        {/* CMV */}
        <div style={S.card}>
          <p style={S.cardTitulo}>Parâmetros de Margem</p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
            Edite os valores clicando neles. Quando o gateway for integrado, estes parâmetros serão aplicados sobre os dados reais.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <InputEditavel
              label="CMV (% da receita líquida)"
              valor={config.cmvPct}
              onChange={v => salvarConfig(c => ({ ...c, cmvPct: Math.max(0, Math.min(100, v)) }))}
              sufixo="%"
            />
            <InputEditavel
              label="Taxa Hubla (% por venda)"
              valor={config.taxaGatewayPct}
              onChange={v => salvarConfig(c => ({ ...c, taxaGatewayPct: Math.max(0, Math.min(100, v)) }))}
              sufixo="%"
            />
            <InputEditavel
              label="Taxa Hubla fixa (R$ por venda)"
              valor={config.taxaGatewayFixa}
              onChange={v => salvarConfig(c => ({ ...c, taxaGatewayFixa: Math.max(0, v) }))}
              prefixo="R$"
            />
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.66rem', color: 'var(--color-text-muted)', margin: 0 }}>
              Taxas da conta: 4,9% + R$ 2,49 por venda aprovada (painel Hubla). Vendas importadas do CSV usam a taxa real de cada fatura — a estimativa só vale para vendas sem o dado.
            </p>
          </div>
        </div>

        {/* Custos fixos */}
        <div style={S.card}>
          <p style={S.cardTitulo}>Custos Fixos Mensais</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {config.custosFixos.map(cf => (
              <div key={cf.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  value={cf.nome}
                  onChange={e => atualizarCustoFixo(cf.id, 'nome', e.target.value)}
                  style={{
                    flex: 1, background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-sm)', padding: '0.3rem 0.5rem',
                    fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--color-text-primary)', outline: 'none',
                  }}
                />
                <InputEditavel
                  label=""
                  valor={cf.valor}
                  onChange={v => atualizarCustoFixo(cf.id, 'valor', v)}
                  prefixo="R$"
                />
                <button
                  onClick={() => removerCustoFixo(cf.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 0.25rem' }}
                >×</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              placeholder="Nome do custo..."
              value={novoFixo}
              onChange={e => setNovoFixo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') adicionarCustoFixo() }}
              style={{
                flex: 1, background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-sm)', padding: '0.35rem 0.5rem',
                fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--color-text-primary)', outline: 'none',
              }}
            />
            <button
              onClick={adicionarCustoFixo}
              style={{
                padding: '0.35rem 0.75rem', borderRadius: 'var(--radius-sm)', border: 'none',
                backgroundColor: 'var(--color-ponto-conversao)', color: 'white',
                fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
              }}
            >+ Adicionar</button>
          </div>
          <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border-subtle)', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Total mensal</span>
            {/* fixosMensais, não totalFixos: o rótulo é MENSAL — o pró-rata do período só vale pra cascata */}
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.875rem', color: 'var(--color-text-primary)', fontWeight: 700 }}>{brl(fixosMensais)}</span>
          </div>
        </div>
      </div>

      {/* Aviso gateway */}
      <div style={{
        backgroundColor: 'rgba(95,138,60,0.07)',
        border: '1px solid rgba(95,138,60,0.2)',
        borderRadius: 'var(--radius-md)',
        padding: '0.875rem 1.25rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
      }}>
        <span style={{ fontSize: '1rem' }}>🔌</span>
        <div>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '0.1rem' }}>
            {temImportacao ? `Vendas reais da Hubla via CSV — ${importacao!.transacoes.length} faturas importadas` : 'Hubla ainda não conectada — sem vendas para exibir'}
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
            {temImportacao ? 'Atualize reimportando um CSV mais novo quando quiser (dedup automático por fatura). Tempo real chega com o webhook da Hubla.' : 'A Hubla só envia vendas por webhook (spec pronta em docs/integracao-hubla.md). Para histórico e dados reais imediatos: importe o CSV de vendas do painel da Hubla no botão acima.'}
          </p>
        </div>
      </div>

    </div>
  )
}
