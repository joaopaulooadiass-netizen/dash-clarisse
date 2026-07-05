'use client'

import { useState, useMemo, useRef } from 'react'
import { corVsMedia, mediaSimples } from '@/lib/utils/classificacao'
import { parseLinhasCSV, parseValorBR } from '@/lib/gateway/hubla'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type TipoLista = 'meta_ads' | 'leads_utm' | 'compradores' | 'pesquisa' | 'desistencia' | 'matricula' | 'custom'
type AbaAtiva  = 'listas' | 'cruzamento' | 'cpa'
type UTMDim    = 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term'

type CampoStd =
  | 'email' | 'utm_campaign' | 'utm_content' | 'utm_medium' | 'utm_source' | 'utm_term'
  | 'campanha' | 'conjunto' | 'anuncio' | 'resultado' | 'cpa' | 'gasto'
  | 'valor' | 'produto' | 'data'

export interface ListaImportada {
  id: string
  nome: string
  tipo: TipoLista
  headers: string[]
  rows: Record<string, string>[]
  campoJoin: string | null
  mapeamento: Partial<Record<CampoStd, string>>
}

interface LinhaEnriquecida {
  chave: string
  presenca: Record<string, boolean>
  dados: Record<string, Record<string, string>>
  score: number
  status: { label: string; cor: string }
  utmOrigem?: string
}

interface LinhaCPAUtm {
  valor: string
  leads: number
  compradores: number
  taxaConv: number
  gasto: number
  receita: number
  cpa: number
  roas: number
  ticketMedio: number
}

interface ConfigCPA {
  listaLeadsId: string
  colUtm: string
  colEmail: string
  listaCompId: string
  colCompEmail: string
  colCompValor: string
  listaMetaId: string
  colMetaGasto: string
  colMetaCamp: string
  colMetaConjunto: string
  colMetaAnuncio: string
}

// Coluna do export do Meta que casa com cada dimensão UTM escolhida.
// Convenção do projeto: utm_campaign = nome da campanha · utm_medium = nome do
// conjunto · utm_content = nome do anúncio (confirmada pelo João em 2026-06-12)
function colMetaParaDim(cfg: ConfigCPA, dim: UTMDim): string {
  if (dim === 'utm_medium')  return cfg.colMetaConjunto || cfg.colMetaCamp
  if (dim === 'utm_content') return cfg.colMetaAnuncio  || cfg.colMetaCamp
  return cfg.colMetaCamp
}

// ─── Configuração dos tipos ───────────────────────────────────────────────────

const TIPOS: Record<TipoLista, { label: string; cor: string; desc: string }> = {
  meta_ads:    { label: 'Meta Ads',    cor: '#5C79C9', desc: 'Export do Gerenciador de Anúncios' },
  leads_utm:   { label: 'Leads + UTM', cor: '#7D68C0', desc: 'Leads com parâmetros UTM' },
  compradores: { label: 'Compradores', cor: '#5F8A3C', desc: 'Lista de quem comprou' },
  pesquisa:    { label: 'Pesquisa',    cor: '#E8BE0B', desc: 'Respostas de pesquisa' },
  desistencia: { label: 'Desistência', cor: '#E0392F', desc: 'Pesquisa de quem não comprou' },
  matricula:   { label: 'Matrícula',   cor: '#5F8A3C', desc: 'Dados dos alunos matriculados' },
  custom:      { label: 'Customizado', cor: '#8A8A7E', desc: 'Qualquer outro tipo de lista' },
}

// Mesma convenção e mesmos rótulos da tela de Faturamento
const UTM_DIMS: { key: UTMDim; label: string; meta: string }[] = [
  { key: 'utm_source',   label: 'Canal',     meta: 'utm_source'        },
  { key: 'utm_campaign', label: 'Campanha',  meta: 'nome da campanha'  },
  { key: 'utm_medium',   label: 'Conjunto',  meta: 'nome do conjunto'  },
  { key: 'utm_content',  label: 'Anúncio',   meta: 'nome do anúncio'   },
  { key: 'utm_term',     label: 'Termo',     meta: 'palavra-chave'     },
]

const ALIASES: Record<CampoStd, string[]> = {
  campanha:     ['nome da campanha', 'campaign name', 'nome do anúncio'],
  conjunto:     ['nome do conjunto de anúncios', 'ad set name'],
  anuncio:      ['nome do anúncio', 'ad name'],
  resultado:    ['resultados', 'results'],
  cpa:          ['custo por resultado', 'cost per result'],
  gasto:        ['valor usado (brl)', 'amount spent', 'valor gasto', 'investimento'],
  email:        ['email', 'e-mail', 'e_mail'],
  utm_campaign: ['utm_campaign', 'utm campaign'],
  utm_content:  ['utm_content', 'utm content'],
  utm_medium:   ['utm_medium', 'utm medium'],
  utm_source:   ['utm_source', 'utm source'],
  utm_term:     ['utm_term', 'utm term'],
  valor:        ['valor', 'valor da compra', 'receita', 'price', 'amount'],
  produto:      ['produto', 'product', 'item'],
  data:         ['data', 'date', 'created_at'],
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────
// Delega ao parser robusto do gateway (aspas escapadas "" e quebra de linha
// DENTRO de aspas — a versão antiga fazia split por \n antes de olhar aspas e
// desalinhava todas as colunas quando um campo tinha observação multilinha).

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const idx = text.indexOf('\n')
  const primeira = idx >= 0 ? text.slice(0, idx) : text
  const sep = primeira.split(';').length > primeira.split(',').length ? ';' : ','
  const linhas = parseLinhasCSV(text, sep)
  if (!linhas.length) return { headers: [], rows: [] }
  const headers = linhas[0].map(h => h.replace(/^["']|["']$/g, '').trim())
  const rows = linhas.slice(1).map(vals => {
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = (vals[i] ?? '').replace(/^["']|["']$/g, '').trim() })
    return row
  }).filter(r => Object.values(r).some(v => v))
  return { headers, rows }
}

// ─── Autodetecção ─────────────────────────────────────────────────────────────

function autoDetectTipo(headers: string[]): TipoLista {
  const h = headers.map(x => x.toLowerCase().trim())
  // Meta Ads: precisa de 2+ colunas muito específicas
  const metaScore = [
    h.some(x => x === 'nome da campanha' || x === 'campaign name'),
    h.some(x => x.includes('valor usado') || x.includes('amount spent')),
    h.some(x => x === 'resultados' || x === 'results'),
    h.some(x => x.includes('custo por resultado') || x.includes('cost per result')),
    h.some(x => x === 'nome do conjunto de anúncios' || x === 'ad set name'),
  ].filter(Boolean).length
  if (metaScore >= 2) return 'meta_ads'

  if (['matrícula','matricula','aluno','enrollment'].some(k => h.some(x => x.includes(k)))) return 'matricula'
  if (['compra','purchase','order','pagamento'].some(k => h.some(x => x.includes(k))))       return 'compradores'
  if (['desistência','desistencia','cancelamento','nao comprou'].some(k => h.some(x => x.includes(k)))) return 'desistencia'
  if (h.some(x => x.includes('utm'))) return 'leads_utm'
  if (['pesquisa','survey','resposta','questionário'].some(k => h.some(x => x.includes(k)))) return 'pesquisa'
  return 'custom'
}

function autoMapear(headers: string[], tipo: TipoLista): Partial<Record<CampoStd, string>> {
  const mapa: Partial<Record<CampoStd, string>> = {}
  const campos: CampoStd[] = tipo === 'meta_ads'
    ? ['campanha','conjunto','anuncio','resultado','cpa','gasto']
    : ['email','utm_campaign','utm_content','utm_medium','utm_source','utm_term','valor','produto','data']
  campos.forEach(campo => {
    const match = headers.find(h => ALIASES[campo].some(a => h.toLowerCase().includes(a)))
    if (match) mapa[campo] = match
  })
  return mapa
}

function autoJoin(headers: string[], tipo: TipoLista): string | null {
  if (tipo === 'meta_ads') {
    return headers.find(h => ['nome da campanha','campanha','campaign'].some(a => h.toLowerCase().includes(a))) ?? headers[0] ?? null
  }
  return headers.find(h => ['email','e-mail','e_mail'].some(a => h.toLowerCase().includes(a))) ?? headers[0] ?? null
}

// ─── Cruzamento ───────────────────────────────────────────────────────────────

function derivarStatus(presenca: Record<string, boolean>, listas: ListaImportada[]): { label: string; cor: string } {
  if (listas.some(l => l.tipo === 'compradores' && presenca[l.id])) return { label: 'Comprador',  cor: '#5F8A3C' }
  if (listas.some(l => l.tipo === 'desistencia' && presenca[l.id])) return { label: 'Desistente', cor: '#E0392F' }
  return { label: 'Lead', cor: '#8A8A7E' }
}

function cruzarListas(listas: ListaImportada[]): LinhaEnriquecida[] {
  const listasAtivas = listas.filter(l => l.tipo !== 'meta_ads')
  if (!listasAtivas.length) return []

  const getCampo = (l: ListaImportada) => l.campoJoin ?? l.headers[0] ?? null

  const chaves = new Set<string>()
  listasAtivas.forEach(l => {
    const campo = getCampo(l)
    if (!campo) return
    l.rows.forEach(r => {
      const v = r[campo]?.trim().toLowerCase()
      if (v) chaves.add(v)
    })
  })

  // Lista leads_utm para extrair UTM de origem
  const leadsLista = listasAtivas.find(l => l.tipo === 'leads_utm')
  const colUtmCamp = leadsLista ? (leadsLista.mapeamento.utm_campaign ?? leadsLista.headers.find(h => h.toLowerCase().includes('utm_campaign')) ?? '') : ''
  const colUtmSrc  = leadsLista ? (leadsLista.mapeamento.utm_source   ?? leadsLista.headers.find(h => h.toLowerCase().includes('utm_source')) ?? '') : ''

  return Array.from(chaves).map(chave => {
    const presenca: Record<string, boolean> = {}
    const dados: Record<string, Record<string, string>> = {}

    listasAtivas.forEach(l => {
      const campo = getCampo(l)
      if (!campo) { presenca[l.id] = false; return }
      const row = l.rows.find(r => r[campo]?.trim().toLowerCase() === chave)
      presenca[l.id] = !!row
      if (row) dados[l.id] = row
    })

    let score = 0
    listasAtivas.forEach(l => {
      if (!presenca[l.id]) return
      score += 1
      if (l.tipo === 'compradores') score += 3
      if (l.tipo === 'matricula')   score += 2
      if (l.tipo === 'pesquisa')    score += 1
      if (l.tipo === 'desistencia') score -= 1
    })

    let utmOrigem: string | undefined
    if (leadsLista && presenca[leadsLista.id] && dados[leadsLista.id]) {
      const row = dados[leadsLista.id]
      const src  = colUtmSrc  ? row[colUtmSrc]  : ''
      const camp = colUtmCamp ? row[colUtmCamp] : ''
      if (src || camp) utmOrigem = [src, camp].filter(Boolean).join(' / ')
    }

    return { chave, presenca, dados, score, status: derivarStatus(presenca, listasAtivas), utmOrigem }
  }).sort((a, b) => b.score - a.score)
}

// ─── CPA por UTM ──────────────────────────────────────────────────────────────

function calcularCPAporUTM(listas: ListaImportada[], cfg: ConfigCPA, dim: UTMDim): LinhaCPAUtm[] {
  const leadsLista = listas.find(l => l.id === cfg.listaLeadsId)
  if (!leadsLista || !cfg.colUtm) return []

  const compLista = cfg.listaCompId ? listas.find(l => l.id === cfg.listaCompId) : null
  const metaLista = cfg.listaMetaId ? listas.find(l => l.id === cfg.listaMetaId) : null
  // Casa o gasto pela coluna do Meta correspondente à granularidade escolhida
  const colMetaMatch = colMetaParaDim(cfg, dim)

  // Agrupar leads por valor UTM. Lead = LINHA do arquivo; o e-mail é opcional e
  // serve só para cruzar com compradores — contar e-mails escondia leads sem
  // e-mail e zerava a coluna inteira quando a coluna de e-mail não era mapeada.
  const grupos = new Map<string, { linhas: number; emails: string[] }>()
  leadsLista.rows.forEach(r => {
    const utmVal = r[cfg.colUtm]?.trim() || '(não identificado)'
    const email  = cfg.colEmail ? r[cfg.colEmail]?.trim().toLowerCase() : ''
    if (!grupos.has(utmVal)) grupos.set(utmVal, { linhas: 0, emails: [] })
    const g = grupos.get(utmVal)!
    g.linhas++
    if (email) g.emails.push(email)
  })

  // Gasto do Meta: cada linha do Meta entra em NO MÁXIMO um grupo UTM — o match
  // mais específico (exato > substring mais longa). Somar em todo grupo que
  // "continha" fazia a mesma linha contar 2× (ex.: 'promo' e 'promo-black'),
  // inflando o gasto total e distorcendo CPA/ROAS de todos os grupos.
  const gastoPorUtm = new Map<string, number>()
  if (metaLista && cfg.colMetaGasto && colMetaMatch) {
    const utms = Array.from(grupos.keys())
      .map(orig => ({ orig, norm: orig.toLowerCase().trim() }))
      .filter(u => u.norm)
    metaLista.rows.forEach(r => {
      const campNorm = (r[colMetaMatch]?.trim() ?? '').toLowerCase()
      if (!campNorm) return
      let melhor: { orig: string; norm: string } | null = null
      let melhorScore = -1
      for (const u of utms) {
        const exato = campNorm === u.norm
        const parcial = campNorm.includes(u.norm) || u.norm.includes(campNorm)
        if (!exato && !parcial) continue
        const score = exato ? Number.MAX_SAFE_INTEGER : u.norm.length
        if (score > melhorScore) { melhor = u; melhorScore = score }
      }
      if (!melhor) return
      const v = parseValorBR(r[cfg.colMetaGasto] ?? '')
      if (Number.isFinite(v)) gastoPorUtm.set(melhor.orig, (gastoPorUtm.get(melhor.orig) ?? 0) + v)
    })
  }

  return Array.from(grupos.entries()).map(([utmVal, { linhas, emails }]) => {
    const emailSet = new Set(emails)
    let compradores = 0, receita = 0

    if (compLista && cfg.colCompEmail) {
      compLista.rows.forEach(r => {
        const e = r[cfg.colCompEmail]?.trim().toLowerCase()
        if (e && emailSet.has(e)) {
          compradores++
          if (cfg.colCompValor) {
            const v = parseValorBR(r[cfg.colCompValor] ?? '')
            if (Number.isFinite(v)) receita += v
          }
        }
      })
    }

    const gasto = gastoPorUtm.get(utmVal) ?? 0

    const leads       = linhas
    const taxaConv    = leads > 0 ? (compradores / leads) * 100 : 0
    const cpa         = compradores > 0 && gasto > 0 ? gasto / compradores : 0
    const roas        = gasto > 0 && receita > 0 ? receita / gasto : 0
    const ticketMedio = compradores > 0 && receita > 0 ? receita / compradores : 0

    return { valor: utmVal, leads, compradores, taxaConv, gasto, receita, cpa, roas, ticketMedio }
  }).sort((a, b) => b.leads - a.leads)
}

function defaultConfigCPA(listas: ListaImportada[], dim: UTMDim): ConfigCPA {
  const leadsL = listas.find(l => l.tipo === 'leads_utm') ?? listas.find(l => l.tipo !== 'meta_ads' && l.tipo !== 'compradores') ?? listas[0]
  const compL  = listas.find(l => l.tipo === 'compradores')
  const metaL  = listas.find(l => l.tipo === 'meta_ads')

  const colUtm = leadsL
    ? (leadsL.mapeamento[dim]
      ?? leadsL.headers.find(h => h.toLowerCase().includes(dim) || h.toLowerCase() === dim.replace('utm_', ''))
      ?? '')
    : ''

  const colEmail = leadsL
    ? (leadsL.mapeamento.email ?? leadsL.campoJoin ?? leadsL.headers.find(h => h.toLowerCase().includes('email')) ?? '')
    : ''

  const colCompEmail = compL
    ? (compL.mapeamento.email ?? compL.campoJoin ?? compL.headers.find(h => h.toLowerCase().includes('email')) ?? '')
    : ''

  const colCompValor = compL ? (compL.mapeamento.valor ?? compL.headers.find(h => ['valor','receita','price','amount'].some(k => h.toLowerCase().includes(k))) ?? '') : ''

  // Priorizar colunas com "nome" — usuário usa nome_campanha, não campaign_id
  const colMetaCamp = metaL ? (
    metaL.mapeamento.campanha ??
    metaL.headers.find(h => { const l = h.toLowerCase(); return (l.includes('nome') || l.includes('name')) && (l.includes('campanha') || l.includes('campaign')) }) ??
    metaL.headers.find(h => h.toLowerCase().includes('campanha') || h.toLowerCase().includes('campaign')) ??
    metaL.headers[0] ?? ''
  ) : ''

  const colMetaGasto = metaL ? (
    metaL.mapeamento.gasto ??
    metaL.headers.find(h => ['valor usado','amount spent','investimento','gasto','spend'].some(k => h.toLowerCase().includes(k))) ??
    ''
  ) : ''

  const colMetaConjunto = metaL ? (
    metaL.mapeamento.conjunto ??
    metaL.headers.find(h => { const l = h.toLowerCase(); return l.includes('conjunto') || l.includes('ad set') || l.includes('adset') }) ??
    ''
  ) : ''

  const colMetaAnuncio = metaL ? (
    metaL.mapeamento.anuncio ??
    metaL.headers.find(h => { const l = h.toLowerCase(); return (l.includes('nome') && l.includes('anúncio')) || (l.includes('nome') && l.includes('anuncio')) || l === 'ad name' }) ??
    ''
  ) : ''

  return {
    listaLeadsId: leadsL?.id ?? '',
    colUtm,
    colEmail,
    listaCompId:   compL?.id ?? '',
    colCompEmail,
    colCompValor,
    listaMetaId:   metaL?.id ?? '',
    colMetaGasto,
    colMetaCamp,
    colMetaConjunto,
    colMetaAnuncio,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function pct(v: number) { return `${v.toFixed(1)}%` }

function downloadCSV(rows: Record<string, string>[], nome: string) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [headers.join(';'), ...rows.map(r => headers.map(h => `"${r[h] ?? ''}"`).join(';'))].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${nome}.csv`; a.click()
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function AnaliseListas({ listasIniciais = [] }: { listasIniciais?: ListaImportada[] }) {
  const [listas, setListas]         = useState<ListaImportada[]>(listasIniciais)
  const [listaSel, setListaSel]     = useState<string | null>(listasIniciais[0]?.id ?? null)
  const [selecionadas, setSelecionadas] = useState<Set<string>>(
    () => new Set(listasIniciais.map(l => l.id)),
  )
  const [aba, setAba]               = useState<AbaAtiva>('listas')
  const [cruzLinhas, setCruzLinhas] = useState<LinhaEnriquecida[]>([])
  const [linhaSel, setLinhaSel]     = useState<string | null>(null)
  const [busca, setBusca]           = useState('')
  const [filtroStatus, setFiltroStatus] = useState<string>('Todos')
  const [dimCPA, setDimCPA]         = useState<UTMDim>('utm_source')
  const [configCPA, setConfigCPA]   = useState<ConfigCPA | null>(null)
  const [configAberta, setConfigAberta] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const listaAtiva   = listas.find(l => l.id === listaSel) ?? null
  const temLeads     = listas.length >= 1
  const cfgAtiva     = useMemo(() => configCPA ?? defaultConfigCPA(listas, dimCPA), [configCPA, listas, dimCPA])
  const dadosCPA     = useMemo(() => calcularCPAporUTM(listas, cfgAtiva, dimCPA), [listas, cfgAtiva, dimCPA])

  const cruzFiltrado = useMemo(() => {
    let d = cruzLinhas
    if (busca) d = d.filter(l => l.chave.toLowerCase().includes(busca.toLowerCase()))
    if (filtroStatus !== 'Todos') d = d.filter(l => l.status.label === filtroStatus)
    return d
  }, [cruzLinhas, busca, filtroStatus])

  const sumario = useMemo(() => ({
    total:       cruzLinhas.length,
    compradores: cruzLinhas.filter(l => l.status.label === 'Comprador').length,
    desistentes: cruzLinhas.filter(l => l.status.label === 'Desistente').length,
    leads:       cruzLinhas.filter(l => l.status.label === 'Lead').length,
  }), [cruzLinhas])

  // Réguas relativas — cada célula é colorida contra a MÉDIA da própria coluna,
  // não contra metas fixas (ROAS 3,5x etc. eram inventados pro negócio do Gabriel)
  const mediasCPA = useMemo(() => ({
    taxaConv: mediaSimples(dadosCPA.map(r => r.taxaConv)),
    cpa:      mediaSimples(dadosCPA.map(r => r.cpa)),
    roas:     mediaSimples(dadosCPA.map(r => r.roas)),
  }), [dadosCPA])
  const mediaScore = useMemo(() => mediaSimples(cruzFiltrado.map(l => l.score)), [cruzFiltrado])

  function importarArquivo(file: File) {
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const { headers, rows } = parseCSV(text)
      if (!headers.length) return
      const tipo       = autoDetectTipo(headers)
      const mapeamento = autoMapear(headers, tipo)
      const campoJoin  = autoJoin(headers, tipo)
      const id = `lista-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      setListas(prev => [...prev, { id, nome: file.name.replace(/\.[^.]+$/, ''), tipo, headers, rows, campoJoin, mapeamento }])
      setSelecionadas(prev => new Set([...prev, id]))
      setListaSel(id)
      setAba('listas')
    }
    reader.readAsText(file, 'UTF-8')
  }

  function removerLista(id: string) {
    setListas(prev => prev.filter(l => l.id !== id))
    setSelecionadas(prev => { const n = new Set(prev); n.delete(id); return n })
    if (listaSel === id) setListaSel(null)
  }

  function atualizarLista(id: string, patch: Partial<ListaImportada>) {
    setListas(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))
  }

  function executarCruzamento() {
    const listasParaCruzar = selecionadas.size > 0
      ? listas.filter(l => selecionadas.has(l.id))
      : listas
    const resultado = cruzarListas(listasParaCruzar)
    setCruzLinhas(resultado)
    setAba('cruzamento')
  }

  // ── Estilos base ──────────────────────────────────────────────────────────
  const th: React.CSSProperties = {
    padding: '0.5rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.62rem',
    fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase',
    letterSpacing: '0.06em', textAlign: 'left', borderBottom: '1px solid var(--color-border-subtle)',
    whiteSpace: 'nowrap', backgroundColor: 'var(--color-bg-secondary)', position: 'sticky', top: 0,
  }
  const td: React.CSSProperties = {
    padding: '0.45rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.78rem',
    color: 'var(--color-text-primary)', borderBottom: '1px solid rgba(28,28,26,0.03)', whiteSpace: 'nowrap',
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--color-bg-primary)' }}>

      {/* ── Painel esquerdo ───────────────────────────────────────────────── */}
      <div style={{ width: '256px', flexShrink: 0, backgroundColor: 'var(--color-bg-secondary)', borderRight: '1px solid var(--color-border-subtle)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '1.25rem 1rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)', flexShrink: 0 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '0.03em', marginBottom: '0.1rem' }}>LISTAS</h1>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
              {selecionadas.size}/{listas.length} selecionadas
            </p>
            {listas.length > 0 && (
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button onClick={() => setSelecionadas(new Set(listas.map(l => l.id)))} style={{ background: 'none', border: 'none', fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '0' }}>Todas</button>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.62rem' }}>·</span>
                <button onClick={() => setSelecionadas(new Set())} style={{ background: 'none', border: 'none', fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '0' }}>Nenhuma</button>
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 0.75rem 0' }}>
          {listas.map(l => {
            const cfg      = TIPOS[l.tipo]
            const previewing = listaSel === l.id
            const checked  = selecionadas.has(l.id)
            return (
              <div key={l.id} style={{ padding: '0.55rem 0.65rem', marginBottom: '0.3rem', borderRadius: 'var(--radius-md)', backgroundColor: previewing ? 'rgba(95,138,60,0.06)' : 'var(--color-bg-card)', border: `1px solid ${previewing ? 'var(--color-ponto-conversao)' : checked ? `${cfg.cor}55` : 'var(--color-border-subtle)'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {/* Checkbox — controla inclusão no cruzamento */}
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => {
                      e.stopPropagation()
                      setSelecionadas(prev => {
                        const n = new Set(prev)
                        if (e.target.checked) n.add(l.id); else n.delete(l.id)
                        return n
                      })
                    }}
                    style={{ accentColor: cfg.cor, width: '13px', height: '13px', cursor: 'pointer', flexShrink: 0 }}
                  />
                  {/* Clique no nome → preview */}
                  <span
                    onClick={() => { setListaSel(l.id); setAba('listas') }}
                    style={{ fontFamily: 'var(--font-body)', fontSize: '0.74rem', fontWeight: 600, color: previewing ? 'var(--color-ponto-conversao)' : 'var(--color-text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                  >
                    {l.nome}
                  </span>
                  <button onClick={e => { e.stopPropagation(); removerLista(l.id) }} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.7rem', opacity: 0.45, padding: '0', lineHeight: 1, flexShrink: 0 }}>✕</button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.2rem', paddingLeft: '1.6rem' }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: cfg.cor, fontWeight: 600 }}>{cfg.label}</span>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>{l.rows.length} linhas</span>
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ padding: '0.75rem', borderTop: '1px solid var(--color-border-subtle)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <input ref={inputRef} type="file" accept=".csv" multiple onChange={e => { Array.from(e.target.files ?? []).forEach(importarArquivo); e.target.value = '' }} style={{ display: 'none' }} />
          <button onClick={() => inputRef.current?.click()} style={{ width: '100%', padding: '0.5rem', backgroundColor: 'var(--color-bg-card)', border: '1px dashed var(--color-border-default)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-body)', fontSize: '0.76rem', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
            + Importar CSV
          </button>
          {listas.length >= 2 && (
            <button
              onClick={executarCruzamento}
              disabled={selecionadas.size < 2 && listas.length >= 2 && selecionadas.size > 0}
              style={{ width: '100%', padding: '0.5rem', backgroundColor: (selecionadas.size === 1) ? 'var(--color-bg-tertiary)' : 'var(--color-ponto-conversao)', border: 'none', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-body)', fontSize: '0.76rem', color: 'white', cursor: selecionadas.size === 1 ? 'not-allowed' : 'pointer', fontWeight: 700, opacity: selecionadas.size === 1 ? 0.5 : 1 }}
            >
              Cruzar {selecionadas.size > 0 ? `${selecionadas.size}` : 'todas as'} lista{selecionadas.size !== 1 ? 's' : ''} →
            </button>
          )}
        </div>
      </div>

      {/* ── Área principal ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border-subtle)', flexShrink: 0, backgroundColor: 'var(--color-bg-secondary)' }}>
          {([
            { id: 'listas',      label: 'Preview'                                              },
            { id: 'cruzamento',  label: `Cruzamento${cruzLinhas.length ? ` (${cruzLinhas.length})` : ''}` },
            ...(temLeads ? [{ id: 'cpa', label: 'CPA por UTM' }] : []),
          ] as { id: AbaAtiva; label: string }[]).map(t => (
            <button key={t.id} onClick={() => setAba(t.id)} style={{ padding: '0.7rem 1.25rem', fontFamily: 'var(--font-body)', fontSize: '0.8rem', background: 'none', border: 'none', borderBottom: `2px solid ${aba === t.id ? 'var(--color-ponto-conversao)' : 'transparent'}`, color: aba === t.id ? 'var(--color-text-primary)' : 'var(--color-text-muted)', cursor: 'pointer', fontWeight: aba === t.id ? 600 : 400, marginBottom: '-1px' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Preview ──────────────────────────────────────────────────────── */}
        {aba === 'listas' && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {!listaAtiva ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--color-text-muted)', letterSpacing: '0.03em' }}>SEM LISTAS</p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--color-text-muted)', maxWidth: '400px', textAlign: 'center' }}>
                  Importe CSVs pelo painel esquerdo. O sistema detecta automaticamente o tipo de cada lista.
                </p>
                <button onClick={() => inputRef.current?.click()} style={{ padding: '0.6rem 1.5rem', backgroundColor: 'var(--color-ponto-conversao)', border: 'none', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'white', cursor: 'pointer', fontWeight: 600 }}>
                  + Importar primeiro CSV
                </button>
              </div>
            ) : (
              <>
                <div style={{ padding: '0.75rem 1.5rem', borderBottom: '1px solid var(--color-border-subtle)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: TIPOS[listaAtiva.tipo].cor }} />
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>{listaAtiva.nome}</p>
                    </div>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-muted)', marginTop: '0.1rem' }}>
                      {listaAtiva.rows.length} linhas · {listaAtiva.headers.length} colunas · join: <strong>{listaAtiva.campoJoin ?? listaAtiva.headers[0] ?? '—'}</strong>
                    </p>
                  </div>
                  <select value={listaAtiva.tipo} onChange={e => { const tipo = e.target.value as TipoLista; atualizarLista(listaAtiva.id, { tipo, mapeamento: autoMapear(listaAtiva.headers, tipo), campoJoin: autoJoin(listaAtiva.headers, tipo) }) }} style={{ padding: '0.28rem 0.55rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                    {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <select value={listaAtiva.campoJoin ?? ''} onChange={e => atualizarLista(listaAtiva.id, { campoJoin: e.target.value || null })} style={{ padding: '0.28rem 0.55rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                    <option value="">— campo de cruzamento —</option>
                    {listaAtiva.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <button onClick={() => downloadCSV(listaAtiva.rows, listaAtiva.nome)} style={{ padding: '0.28rem 0.65rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}>↓</button>
                </div>
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>{listaAtiva.headers.map(h => {
                        const mapeado = Object.values(listaAtiva.mapeamento).includes(h)
                        return <th key={h} style={{ ...th, color: mapeado ? TIPOS[listaAtiva.tipo].cor : 'var(--color-text-muted)' }}>{h}{mapeado ? ' ●' : ''}</th>
                      })}</tr>
                    </thead>
                    <tbody>{listaAtiva.rows.slice(0, 300).map((row, i) => (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(28,28,26,0.02)' }}>
                        {listaAtiva.headers.map(h => <td key={h} style={td}>{row[h] ?? ''}</td>)}
                      </tr>
                    ))}</tbody>
                  </table>
                  {listaAtiva.rows.length > 300 && <p style={{ padding: '0.6rem', fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>Mostrando 300 de {listaAtiva.rows.length} linhas</p>}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Cruzamento ───────────────────────────────────────────────────── */}
        {aba === 'cruzamento' && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {!cruzLinhas.length ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                  Importe 2+ listas e clique em <strong style={{ color: 'var(--color-text-primary)' }}>Cruzar Listas</strong> no painel esquerdo.
                </p>
              </div>
            ) : (
              <>
                {/* Sumário */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0', borderBottom: '1px solid var(--color-border-subtle)', flexShrink: 0 }}>
                  {[
                    { label: 'Leads únicos',  val: sumario.total,       cor: 'var(--color-text-primary)' },
                    { label: 'Compradores',   val: sumario.compradores, cor: '#5F8A3C' },
                    { label: 'Desistentes',   val: sumario.desistentes, cor: '#E0392F' },
                    { label: 'Só Lead',       val: sumario.leads,       cor: '#8A8A7E' },
                  ].map(({ label, val, cor }) => (
                    <div key={label} style={{ padding: '0.85rem 1.25rem', borderRight: '1px solid var(--color-border-subtle)' }}>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-muted)', marginBottom: '0.2rem' }}>{label}</p>
                      <p style={{ fontFamily: 'var(--font-body)', fontSize: '1.5rem', fontWeight: 700, color: cor, lineHeight: 1 }}>{val}</p>
                    </div>
                  ))}
                </div>

                {/* Toolbar */}
                <div style={{ padding: '0.6rem 1.25rem', borderBottom: '1px solid var(--color-border-subtle)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar..." style={{ padding: '0.28rem 0.65rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--color-text-primary)', outline: 'none', width: '220px' }} />
                  <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} style={{ padding: '0.28rem 0.55rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                    {['Todos', 'Comprador', 'Desistente', 'Lead'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>{cruzFiltrado.length} resultado{cruzFiltrado.length !== 1 ? 's' : ''}</p>
                  <button onClick={() => {
                    const listasAtivas = listas.filter(l => l.tipo !== 'meta_ads')
                    const rows = cruzFiltrado.map(l => {
                      const r: Record<string, string> = { identificador: l.chave, status: l.status.label, score: String(l.score), utm_origem: l.utmOrigem ?? '' }
                      listasAtivas.forEach(lista => { r[`em_${lista.nome}`] = l.presenca[lista.id] ? 'sim' : 'não' })
                      return r
                    })
                    downloadCSV(rows, 'cruzamento')
                  }} style={{ marginLeft: 'auto', padding: '0.28rem 0.65rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}>↓ Exportar</button>
                </div>

                {/* Tabela */}
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>Identificador</th>
                        <th style={th}>Status</th>
                        <th style={{ ...th, textAlign: 'right' }}>Score</th>
                        <th style={th}>Listas</th>
                        <th style={th}>UTM origem</th>
                        <th style={{ ...th, width: '32px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {cruzFiltrado.slice(0, 500).map(linha => {
                        const expandido = linhaSel === linha.chave
                        const listasAtivas = listas.filter(l => l.tipo !== 'meta_ads')
                        return (
                          <>
                            <tr key={linha.chave} onClick={() => setLinhaSel(expandido ? null : linha.chave)} style={{ borderBottom: '1px solid rgba(28,28,26,0.03)', cursor: 'pointer', backgroundColor: expandido ? 'rgba(95,138,60,0.05)' : 'transparent' }}>
                              <td style={{ ...td, fontWeight: 500 }}>{linha.chave}</td>
                              <td style={td}>
                                <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 700, color: linha.status.cor, backgroundColor: `${linha.status.cor}22`, padding: '0.12rem 0.5rem', borderRadius: 'var(--radius-pill)' }}>
                                  {linha.status.label}
                                </span>
                              </td>
                              <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: corVsMedia(linha.score, mediaScore) }}>
                                {linha.score}
                              </td>
                              <td style={td}>
                                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                                  {listasAtivas.filter(l => linha.presenca[l.id]).map(l => (
                                    <span key={l.id} style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', fontWeight: 600, color: TIPOS[l.tipo].cor, backgroundColor: `${TIPOS[l.tipo].cor}22`, padding: '0.08rem 0.4rem', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap' }}>
                                      {l.nome}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td style={{ ...td, color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>{linha.utmOrigem ?? '—'}</td>
                              <td style={{ ...td, color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>{expandido ? '▲' : '▼'}</td>
                            </tr>
                            {expandido && (
                              <tr key={`${linha.chave}-exp`}>
                                <td colSpan={6} style={{ padding: 0 }}>
                                  <div style={{ backgroundColor: 'rgba(28,28,26,0.025)', padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.65rem' }}>
                                      {listasAtivas.filter(l => linha.presenca[l.id]).map(l => (
                                        <div key={l.id} style={{ backgroundColor: 'var(--color-bg-card)', border: `1px solid ${TIPOS[l.tipo].cor}33`, borderRadius: 'var(--radius-md)', padding: '0.7rem 0.85rem' }}>
                                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.6rem', fontWeight: 700, color: TIPOS[l.tipo].cor, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.5rem' }}>{l.nome}</p>
                                          {Object.entries(linha.dados[l.id] ?? {}).filter(([, v]) => v).slice(0, 10).map(([k, v]) => (
                                            <div key={k} style={{ display: 'flex', gap: '0.5rem', paddingBlock: '0.15rem', borderBottom: '1px solid rgba(28,28,26,0.03)' }}>
                                              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-muted)', flex: '0 0 120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
                                              <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-primary)', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span>
                                            </div>
                                          ))}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                    </tbody>
                  </table>
                  {/* Truncamento visível — sem isto o header dizia "1200 resultados" e a tabela parava na 500ª em silêncio */}
                  {cruzFiltrado.length > 500 && (
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)', padding: '0.6rem 1.25rem' }}>
                      Mostrando 500 de {cruzFiltrado.length.toLocaleString('pt-BR')} — refine a busca para ver o restante
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── CPA por UTM ──────────────────────────────────────────────────── */}
        {aba === 'cpa' && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

            {/* Painel de configuração */}
            <div style={{ borderBottom: '1px solid var(--color-border-subtle)', flexShrink: 0 }}>
              {/* Toolbar superior */}
              <div style={{ padding: '0.6rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>Granularidade:</p>
                <div style={{ display: 'flex', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                  {UTM_DIMS.map((d, i, arr) => (
                    <button key={d.key} onClick={() => { setDimCPA(d.key); setConfigCPA(null) }} style={{ padding: '0.28rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.74rem', border: 'none', borderRight: i < arr.length - 1 ? '1px solid var(--color-border-subtle)' : 'none', backgroundColor: dimCPA === d.key ? 'var(--color-ponto-conversao)' : 'transparent', color: dimCPA === d.key ? 'white' : 'var(--color-text-muted)', cursor: 'pointer', fontWeight: dimCPA === d.key ? 700 : 400, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px' }}>
                      <span>{d.label}</span>
                      <span style={{ fontSize: '0.55rem', opacity: 0.7 }}>{d.meta}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => setConfigAberta(v => !v)} style={{ padding: '0.28rem 0.65rem', backgroundColor: configAberta ? 'rgba(95,138,60,0.1)' : 'var(--color-bg-card)', border: `1px solid ${configAberta ? 'var(--color-ponto-conversao)' : 'var(--color-border-subtle)'}`, borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: configAberta ? 'var(--color-ponto-conversao)' : 'var(--color-text-muted)', cursor: 'pointer' }}>
                  ⚙ Configurar colunas
                </button>
                {configCPA && (
                  <button onClick={() => setConfigCPA(null)} style={{ padding: '0.28rem 0.65rem', backgroundColor: 'transparent', border: 'none', fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                    Resetar
                  </button>
                )}
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>{dadosCPA.length} origens</p>
                <button onClick={() => downloadCSV(dadosCPA.map(r => ({ [dimCPA]: r.valor, leads: String(r.leads), compradores: String(r.compradores), taxa_conv: pct(r.taxaConv), gasto: r.gasto > 0 ? brl(r.gasto) : '', receita: r.receita > 0 ? brl(r.receita) : '', ticket_medio: r.ticketMedio > 0 ? brl(r.ticketMedio) : '', cpa: r.cpa > 0 ? brl(r.cpa) : '', roas: r.roas > 0 ? r.roas.toFixed(2) + 'x' : '' })), `cpa_por_${dimCPA}`)} style={{ marginLeft: 'auto', padding: '0.28rem 0.65rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}>↓ Exportar</button>
              </div>

              {/* Painel de config expandível */}
              {configAberta && (
                <div style={{ borderTop: '1px solid var(--color-border-subtle)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderBottom: '1px solid var(--color-border-subtle)' }}>

                    {/* ── Bloco 1: Lista com UTMs ── */}
                    {(() => {
                      const l = listas.find(x => x.id === cfgAtiva.listaLeadsId)
                      return (
                        <div style={{ padding: '1rem 1.25rem', borderRight: '1px solid var(--color-border-subtle)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem' }}>
                            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#7D68C0' }} />
                            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>Lista com UTMs</p>
                          </div>
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>Qual lista contém os parâmetros UTM dos leads?</p>
                          <select value={cfgAtiva.listaLeadsId} onChange={e => setConfigCPA({ ...cfgAtiva, listaLeadsId: e.target.value, colUtm: '' })} style={{ width: '100%', padding: '0.4rem 0.6rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--color-text-primary)', marginBottom: '0.65rem', cursor: 'pointer' }}>
                            <option value="">— selecione a lista —</option>
                            {listas.filter(x => x.tipo !== 'meta_ads').map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
                          </select>
                          {l && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                              <div>
                                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>
                                  Coluna UTM {!cfgAtiva.colUtm && <span style={{ color: 'var(--color-signal-red)' }}>*</span>}
                                </p>
                                <select value={cfgAtiva.colUtm} onChange={e => setConfigCPA({ ...cfgAtiva, colUtm: e.target.value })} style={{ width: '100%', padding: '0.35rem 0.5rem', backgroundColor: 'var(--color-bg-card)', border: `1.5px solid ${cfgAtiva.colUtm ? '#5F8A3C' : '#E0392F'}`, borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                                  <option value="">— obrigatório —</option>
                                  {l.headers.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                              </div>
                              <div>
                                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>Coluna Email</p>
                                <select value={cfgAtiva.colEmail} onChange={e => setConfigCPA({ ...cfgAtiva, colEmail: e.target.value })} style={{ width: '100%', padding: '0.35rem 0.5rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                                  <option value="">— opcional —</option>
                                  {l.headers.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })()}

                    {/* ── Bloco 2: Compradores ── */}
                    {(() => {
                      const l = listas.find(x => x.id === cfgAtiva.listaCompId)
                      return (
                        <div style={{ padding: '1rem 1.25rem', borderRight: '1px solid var(--color-border-subtle)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem' }}>
                            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#5F8A3C' }} />
                            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>Lista de Compradores</p>
                          </div>
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>Opcional — para calcular compradores, receita e ticket médio.</p>
                          <select value={cfgAtiva.listaCompId} onChange={e => setConfigCPA({ ...cfgAtiva, listaCompId: e.target.value, colCompEmail: '', colCompValor: '' })} style={{ width: '100%', padding: '0.4rem 0.6rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--color-text-primary)', marginBottom: '0.65rem', cursor: 'pointer' }}>
                            <option value="">— nenhuma —</option>
                            {listas.filter(x => x.tipo !== 'meta_ads').map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
                          </select>
                          {l && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                              <div>
                                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>
                                  Email {cfgAtiva.listaCompId && !cfgAtiva.colCompEmail && <span style={{ color: 'var(--color-signal-red)' }}>*</span>}
                                </p>
                                <select value={cfgAtiva.colCompEmail} onChange={e => setConfigCPA({ ...cfgAtiva, colCompEmail: e.target.value })} style={{ width: '100%', padding: '0.35rem 0.5rem', backgroundColor: 'var(--color-bg-card)', border: `1.5px solid ${cfgAtiva.colCompEmail ? '#5F8A3C' : '#E0392F'}`, borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                                  <option value="">— obrigatório —</option>
                                  {l.headers.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                              </div>
                              <div>
                                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>Valor da Compra</p>
                                <select value={cfgAtiva.colCompValor} onChange={e => setConfigCPA({ ...cfgAtiva, colCompValor: e.target.value })} style={{ width: '100%', padding: '0.35rem 0.5rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                                  <option value="">— opcional —</option>
                                  {l.headers.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })()}

                    {/* ── Bloco 3: Meta Ads ── */}
                    {(() => {
                      const l = listas.find(x => x.id === cfgAtiva.listaMetaId)
                      return (
                        <div style={{ padding: '1rem 1.25rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem' }}>
                            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#5C79C9' }} />
                            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>Meta Ads — Gasto</p>
                          </div>
                          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>Opcional — para calcular CPA e ROAS. O gasto casa pela coluna da granularidade ativa ({UTM_DIMS.find(d => d.key === dimCPA)?.label ?? dimCPA}).</p>
                          <select value={cfgAtiva.listaMetaId} onChange={e => setConfigCPA({ ...cfgAtiva, listaMetaId: e.target.value, colMetaGasto: '', colMetaCamp: '', colMetaConjunto: '', colMetaAnuncio: '' })} style={{ width: '100%', padding: '0.4rem 0.6rem', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--color-text-primary)', marginBottom: '0.65rem', cursor: 'pointer' }}>
                            <option value="">— nenhuma —</option>
                            {listas.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
                          </select>
                          {l && (() => {
                            const colMatch = colMetaParaDim(cfgAtiva, dimCPA)
                            const campoMeta = (label: string, key: 'colMetaCamp' | 'colMetaConjunto' | 'colMetaAnuncio') => {
                              const usado = colMatch === cfgAtiva[key] && !!cfgAtiva[key]
                              return (
                                <div>
                                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: usado ? 'var(--color-ponto-conversao)' : 'var(--color-text-muted)', marginBottom: '0.25rem', fontWeight: usado ? 700 : 400 }}>
                                    {label}{usado ? ' ◂ em uso' : ''}
                                  </p>
                                  <select value={cfgAtiva[key]} onChange={e => setConfigCPA({ ...cfgAtiva, [key]: e.target.value })} style={{ width: '100%', padding: '0.35rem 0.5rem', backgroundColor: 'var(--color-bg-card)', border: `1.5px solid ${usado ? 'var(--color-ponto-conversao)' : cfgAtiva[key] ? '#5F8A3C' : 'var(--color-border-subtle)'}`, borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                                    <option value="">— opcional —</option>
                                    {l.headers.map(h => <option key={h} value={h}>{h}</option>)}
                                  </select>
                                </div>
                              )
                            }
                            return (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                <div>
                                  <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.62rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>
                                    Gasto {cfgAtiva.listaMetaId && !cfgAtiva.colMetaGasto && <span style={{ color: 'var(--color-signal-red)' }}>*</span>}
                                  </p>
                                  <select value={cfgAtiva.colMetaGasto} onChange={e => setConfigCPA({ ...cfgAtiva, colMetaGasto: e.target.value })} style={{ width: '100%', padding: '0.35rem 0.5rem', backgroundColor: 'var(--color-bg-card)', border: `1.5px solid ${cfgAtiva.colMetaGasto ? '#5F8A3C' : '#E0392F'}`, borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                                    <option value="">— obrigatório —</option>
                                    {l.headers.map(h => <option key={h} value={h}>{h}</option>)}
                                  </select>
                                </div>
                                {campoMeta('Nome da Campanha', 'colMetaCamp')}
                                {campoMeta('Nome do Conjunto', 'colMetaConjunto')}
                                {campoMeta('Nome do Anúncio', 'colMetaAnuncio')}
                              </div>
                            )
                          })()}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}
            </div>

            {/* Tabela */}
            {!dadosCPA.length ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '0.75rem' }}>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--color-text-muted)', textAlign: 'center', maxWidth: '400px' }}>
                  Configure as colunas acima — selecione a lista de leads e a coluna com {UTM_DIMS.find(d => d.key === dimCPA)?.label ?? dimCPA}.
                </p>
                <button onClick={() => setConfigAberta(true)} style={{ padding: '0.4rem 1rem', backgroundColor: 'var(--color-ponto-conversao)', border: 'none', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'white', cursor: 'pointer' }}>
                  ⚙ Abrir configuração
                </button>
              </div>
            ) : (
              <div style={{ flex: 1, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>{UTM_DIMS.find(d => d.key === dimCPA)?.label ?? dimCPA}</th>
                      <th style={{ ...th, textAlign: 'right' }}>Leads</th>
                      <th style={{ ...th, textAlign: 'right' }}>Compradores</th>
                      <th style={{ ...th, textAlign: 'right' }}>Taxa Conv.</th>
                      <th style={{ ...th, textAlign: 'right' }}>Gasto</th>
                      <th style={{ ...th, textAlign: 'right' }}>Receita</th>
                      <th style={{ ...th, textAlign: 'right' }}>Ticket Médio</th>
                      <th style={{ ...th, textAlign: 'right' }}>CPA</th>
                      <th style={{ ...th, textAlign: 'right' }}>ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dadosCPA.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(28,28,26,0.03)', backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(28,28,26,0.02)' }}>
                        <td style={{ ...td, fontWeight: 600, maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.valor}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{row.leads}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: row.compradores > 0 ? 'var(--color-signal-green)' : 'var(--color-text-muted)' }}>{row.compradores || '—'}</td>
                        <td style={{ ...td, textAlign: 'right', color: corVsMedia(row.taxaConv, mediasCPA.taxaConv) }}>{row.compradores > 0 ? pct(row.taxaConv) : '—'}</td>
                        <td style={{ ...td, textAlign: 'right', color: 'var(--color-text-muted)' }}>{row.gasto > 0 ? brl(row.gasto) : '—'}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: row.receita > 0 ? 600 : 400, color: row.receita > 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>{row.receita > 0 ? brl(row.receita) : '—'}</td>
                        <td style={{ ...td, textAlign: 'right', color: 'var(--color-text-secondary)' }}>{row.ticketMedio > 0 ? brl(row.ticketMedio) : '—'}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: corVsMedia(row.cpa, mediasCPA.cpa, true) }}>{row.cpa > 0 ? brl(row.cpa) : '—'}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: corVsMedia(row.roas, mediasCPA.roas) }}>{row.roas > 0 ? `${row.roas.toFixed(1)}x` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
