'use client'

import { useState, useEffect, useRef } from 'react'

export interface FiltroState {
  corredor: string[]   // C1, C2, C3
  objetivo: string[]   // VENDAS, LEADS, CPT
  contem: string
  naoContem: string
  exatamente: string
  ativoCampanha?: boolean
  ativoConjunto?: boolean
  ativoAnuncio?: boolean
  teveVeiculacao?: boolean
}

export const FILTRO_VAZIO: FiltroState = {
  corredor: [], objetivo: [], contem: '', naoContem: '', exatamente: '',
  ativoCampanha: false, ativoConjunto: false, ativoAnuncio: false, teveVeiculacao: false,
}

// Estado inicial das telas: começa com "teve veiculação" ativo para esconder
// campanhas/anúncios sem nenhuma impressão no período por padrão.
export const FILTRO_PADRAO: FiltroState = {
  ...FILTRO_VAZIO,
  teveVeiculacao: true,
}

export function temFiltroAtivo(f: FiltroState) {
  return f.corredor.length > 0 || f.objetivo.length > 0 || !!f.contem || !!f.naoContem || !!f.exatamente
    || !!f.ativoCampanha || !!f.ativoConjunto || !!f.ativoAnuncio || !!f.teveVeiculacao
}

// Filtro por nome — lógica canônica usada por todas as telas.
// Flags de status (ativo/teve veiculação) dependem de dados de cada tela e ficam fora.
export function passaFiltroNome(nome: string, f: FiltroState): boolean {
  const n = nome.toLowerCase()
  if (f.corredor.length > 0 && !f.corredor.some(t => nome.includes(`[${t}]`))) return false
  if (f.objetivo.length > 0 && !f.objetivo.some(t => nome.includes(`[${t}]`))) return false
  if (f.contem && !n.includes(f.contem.toLowerCase())) return false
  if (f.naoContem && n.includes(f.naoContem.toLowerCase())) return false
  if (f.exatamente && n !== f.exatamente.toLowerCase()) return false
  return true
}

interface Preset { nome: string; filtro: FiltroState }

// Níveis de status que a tela consegue filtrar de verdade. Checkbox sem dado
// por trás não aparece — controle morto é pior que controle ausente.
export type NivelStatus = 'campanha' | 'conjunto' | 'anuncio' | 'veiculacao'

interface Props {
  filtro: FiltroState
  onChange: (f: FiltroState) => void
  isAdmin?: boolean
  storageKey?: string
  niveis?: NivelStatus[]
}

const CORREDOR = [
  { tag: 'C1', desc: 'Atração de Seguidor' },
  { tag: 'C2', desc: 'Distribuição de Conteúdo' },
  { tag: 'C3', desc: 'Quebra de Objeção' },
]

const OBJETIVO = [
  { tag: 'VENDAS', desc: 'Campanhas de Vendas' },
  { tag: 'LEADS',  desc: 'Campanhas de Leads' },
  { tag: 'CPT',    desc: 'Captação' },
]

const STATUS: { key: 'ativoCampanha' | 'ativoConjunto' | 'ativoAnuncio' | 'teveVeiculacao'; nivel: NivelStatus; label: string; desc: string }[] = [
  { key: 'ativoCampanha',  nivel: 'campanha',   label: 'Campanha ativa', desc: 'A campanha está ativa' },
  { key: 'ativoConjunto',  nivel: 'conjunto',   label: 'Conjunto ativo',  desc: 'O conjunto de anúncios está ativo' },
  { key: 'ativoAnuncio',   nivel: 'anuncio',    label: 'Anúncio ativo',   desc: 'O anúncio está ativo' },
  { key: 'teveVeiculacao', nivel: 'veiculacao', label: 'Teve veiculação', desc: 'Recebeu impressões no período' },
]

export function FiltroFunil({ filtro, onChange, isAdmin = true, storageKey = 'filtro-funil-v2', niveis = ['campanha', 'conjunto', 'anuncio', 'veiculacao'] }: Props) {
  const [aberto, setAberto]       = useState(false)
  const [presets, setPresets]     = useState<Preset[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = window.localStorage.getItem(storageKey)
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [salvando, setSalvando]   = useState(false)
  const [nomePreset, setNome]     = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const ativo = temFiltroAtivo(filtro)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function set(partial: Partial<FiltroState>) { onChange({ ...filtro, ...partial }) }

  function toggleList(key: 'corredor' | 'objetivo', tag: string) {
    const lista = filtro[key]
    set({ [key]: lista.includes(tag) ? lista.filter(t => t !== tag) : [...lista, tag] })
  }

  function salvar() {
    if (!nomePreset.trim()) return
    const novos = [...presets.filter(p => p.nome !== nomePreset.trim()), { nome: nomePreset.trim(), filtro }]
    setPresets(novos)
    localStorage.setItem(storageKey, JSON.stringify(novos))
    setSalvando(false)
    setNome('')
  }

  function remover(nome: string) {
    const novos = presets.filter(p => p.nome !== nome)
    setPresets(novos)
    localStorage.setItem(storageKey, JSON.stringify(novos))
  }

  const presetAtivo = presets.find(p => JSON.stringify(p.filtro) === JSON.stringify(filtro))

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>

      {/* Botão principal */}
      <button
        onClick={() => setAberto(!aberto)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.4rem',
          padding: '0.4rem 0.8rem',
          fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: ativo ? 700 : 400,
          color: ativo ? 'white' : 'var(--color-text-secondary)',
          backgroundColor: ativo ? 'var(--color-ponto-conversao)' : 'var(--color-bg-card)',
          border: `1px solid ${ativo ? 'var(--color-ponto-conversao)' : 'var(--color-border-subtle)'}`,
          borderRadius: 'var(--radius-md)', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: '0.8rem' }}>⚡</span>
        Filtro inteligente
        {ativo && <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>ativo</span>}
      </button>

      {/* Presets salvos */}
      {presets.map(p => {
        const selecionado = presetAtivo?.nome === p.nome
        return (
          <div key={p.nome} style={{ display: 'flex' }}>
            <button onClick={() => onChange(selecionado ? FILTRO_VAZIO : p.filtro)}
              style={{ padding: '0.38rem 0.65rem', fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: selecionado ? 'white' : 'var(--color-text-secondary)', backgroundColor: selecionado ? 'var(--color-bg-tertiary)' : 'transparent', border: '1px solid var(--color-border-subtle)', borderRight: 'none', borderRadius: 'var(--radius-md) 0 0 var(--radius-md)', cursor: 'pointer', fontWeight: selecionado ? 700 : 400 }}>
              {p.nome}
            </button>
            {isAdmin && (
              <button onClick={() => remover(p.nome)}
                style={{ padding: '0.38rem 0.4rem', fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-muted)', backgroundColor: 'transparent', border: '1px solid var(--color-border-subtle)', borderRadius: '0 var(--radius-md) var(--radius-md) 0', cursor: 'pointer' }}>
                ✕
              </button>
            )}
          </div>
        )
      })}

      {/* Limpar */}
      {ativo && (
        <button onClick={() => onChange(FILTRO_VAZIO)}
          style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline dotted' }}>
          limpar
        </button>
      )}

      {/* Painel */}
      {aberto && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 0.5rem)', left: 0, zIndex: 100,
          backgroundColor: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border-default)',
          borderRadius: 'var(--radius-lg)', padding: '1.25rem',
          minWidth: '320px', maxWidth: '380px',
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', gap: '1.25rem',
        }}>

          {/* Corredor polonês */}
          <Secao titulo="Corredor polonês">
            {CORREDOR.map(({ tag, desc }) => (
              <OpcaoToggle key={tag}
                ativo={filtro.corredor.includes(tag)}
                onClick={() => toggleList('corredor', tag)}
                label={tag} desc={desc}
              />
            ))}
          </Secao>

          <Divider />

          {/* Objetivo */}
          <Secao titulo="Por objetivo de campanha">
            {OBJETIVO.map(({ tag, desc }) => (
              <OpcaoToggle key={tag}
                ativo={filtro.objetivo.includes(tag)}
                onClick={() => toggleList('objetivo', tag)}
                label={tag} desc={desc}
              />
            ))}
          </Secao>

          <Divider />

          {/* Status — só os níveis que esta tela filtra de verdade */}
          {STATUS.some(s => niveis.includes(s.nivel)) && (
            <>
              <Secao titulo="Status">
                {STATUS.filter(s => niveis.includes(s.nivel)).map(({ key, label, desc }) => (
                  <OpcaoCheckbox key={key}
                    ativo={!!filtro[key]}
                    onClick={() => set({ [key]: !filtro[key] })}
                    label={label} desc={desc}
                  />
                ))}
              </Secao>

              <Divider />
            </>
          )}

          {/* Personalizado */}
          <Secao titulo="Personalizado">
            <CampoTexto
              label="Contém"
              value={filtro.contem}
              onChange={v => set({ contem: v, exatamente: v ? '' : filtro.exatamente })}
              placeholder="ex: WCC"
            />
            <CampoTexto
              label="Não contém"
              value={filtro.naoContem}
              onChange={v => set({ naoContem: v })}
              placeholder="ex: TESTE"
            />
            <CampoTexto
              label="Exatamente"
              value={filtro.exatamente}
              onChange={v => set({ exatamente: v, contem: v ? '' : filtro.contem })}
              placeholder="ex: [CPD] [VENDAS] [Q]"
            />
          </Secao>

          {/* Rodapé */}
          {isAdmin && ativo && (
            <>
              <Divider />
              {salvando ? (
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <input autoFocus value={nomePreset} onChange={e => setNome(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') setSalvando(false) }}
                    placeholder="Nome da visualização..."
                    style={{ flex: 1, padding: '0.3rem 0.5rem', background: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)', fontSize: '0.78rem', outline: 'none' }}
                  />
                  <button onClick={salvar}
                    style={{ padding: '0.3rem 0.7rem', fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 600, color: 'white', backgroundColor: 'var(--color-ponto-conversao)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>
                    OK
                  </button>
                  <button onClick={() => setSalvando(false)}
                    style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                </div>
              ) : (
                <button onClick={() => setSalvando(true)}
                  style={{ alignSelf: 'flex-start', fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--color-ponto-conversao)', background: 'none', border: 'none', cursor: 'pointer' }}>
                  + Salvar visualização
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Subcomponentes ────────────────────────────────────────────────────────────

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.1rem' }}>
        {titulo}
      </p>
      {children}
    </div>
  )
}

function OpcaoToggle({ label, desc, ativo, onClick }: { label: string; desc: string; ativo: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: '0.6rem',
      padding: '0.45rem 0.65rem',
      backgroundColor: ativo ? 'rgba(95,138,60,0.12)' : 'var(--color-bg-card)',
      border: `1px solid ${ativo ? 'var(--color-ponto-conversao)' : 'var(--color-border-subtle)'}`,
      borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'left', width: '100%',
    }}>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 700, color: ativo ? 'var(--color-ponto-conversao)' : 'var(--color-text-primary)', minWidth: '40px' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
        {desc}
      </span>
      {ativo && <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--color-ponto-conversao)' }}>✓</span>}
    </button>
  )
}

function OpcaoCheckbox({ label, desc, ativo, onClick }: { label: string; desc: string; ativo: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: '0.6rem',
      padding: '0.45rem 0.65rem',
      backgroundColor: ativo ? 'rgba(95,138,60,0.12)' : 'var(--color-bg-card)',
      border: `1px solid ${ativo ? 'var(--color-ponto-conversao)' : 'var(--color-border-subtle)'}`,
      borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'left', width: '100%',
    }}>
      <span style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '16px', height: '16px', flexShrink: 0,
        backgroundColor: ativo ? 'var(--color-ponto-conversao)' : 'transparent',
        border: `1px solid ${ativo ? 'var(--color-ponto-conversao)' : 'var(--color-border-default)'}`,
        borderRadius: '4px', fontSize: '0.65rem', color: 'white',
      }}>
        {ativo && '✓'}
      </span>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: ativo ? 700 : 400, color: ativo ? 'var(--color-ponto-conversao)' : 'var(--color-text-primary)' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
        {desc}
      </span>
    </button>
  )
}

function CampoTexto({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--color-text-secondary)', minWidth: '80px' }}>{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ flex: 1, padding: '0.3rem 0.5rem', background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)', color: value ? 'var(--color-text-primary)' : 'var(--color-text-muted)', fontFamily: 'var(--font-body)', fontSize: '0.78rem', outline: 'none' }}
      />
    </div>
  )
}

function Divider() {
  return <div style={{ height: '1px', backgroundColor: 'var(--color-border-subtle)' }} />
}
