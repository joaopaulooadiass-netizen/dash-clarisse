'use client'

import { useState, useRef, useEffect } from 'react'
import { DayPicker, DateRange } from 'react-day-picker'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import 'react-day-picker/src/style.css'

export interface PeriodoState {
  de: string
  ate: string
}

interface Props {
  de: string
  ate: string
  onDe: (v: string) => void
  onAte: (v: string) => void
  atalhos?: number[]
  minData?: string
  maxData?: string
}

// Datas no fuso do negócio (BRT) — fonte única em lib/utils/data.ts.
// Re-exportadas daqui por compatibilidade: várias telas importam deste arquivo.
import { hoje, subDias } from '@/lib/utils/data'

export { hoje, subDias }

function fmtDisplay(iso: string): string {
  try { return format(parseISO(iso), 'dd/MM/yy') } catch { return iso }
}

export function SeletorPeriodo({ de, ate, onDe, onAte, atalhos = [7, 30, 60, 90], minData, maxData }: Props) {
  const [aberto, setAberto] = useState(false)
  const [selecionando, setSelecionando] = useState<DateRange | undefined>({ from: parseISO(de), to: parseISO(ate) })
  const ref = useRef<HTMLDivElement>(null)
  const max = maxData ?? hoje()
  const rangeSelecionado = aberto ? selecionando : { from: parseISO(de), to: parseISO(ate) }

  useEffect(() => {
    function fechar(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fechar)
    return () => document.removeEventListener('mousedown', fechar)
  }, [])

  function atalho(dias: number) {
    const novoD = subDias(dias - 1)
    const novoA = hoje()
    onDe(novoD)
    onAte(novoA)
    setSelecionando({ from: parseISO(novoD), to: parseISO(novoA) })
    setAberto(false)
  }

  function isAtalhoAtivo(dias: number): boolean {
    return de === subDias(dias - 1) && ate === hoje()
  }

  function handleSelect(range: DateRange | undefined) {
    setSelecionando(range)
  }

  function abrirCalendario() {
    setSelecionando({ from: parseISO(de), to: parseISO(ate) })
    setAberto(true)
  }

  function aplicar() {
    if (selecionando?.from && selecionando?.to) {
      onDe(format(selecionando.from, 'yyyy-MM-dd'))
      onAte(format(selecionando.to, 'yyyy-MM-dd'))
      setAberto(false)
    }
  }

  function cancelar() {
    setSelecionando({ from: parseISO(de), to: parseISO(ate) })
    setAberto(false)
  }

  return (
    <div ref={ref} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', position: 'relative' }}>
      {/* Atalhos */}
      <div style={{
        display: 'flex',
        backgroundColor: 'var(--color-bg-card)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}>
        {atalhos.map((p, i) => {
          const ativo = isAtalhoAtivo(p)
          return (
            <button key={p} onClick={() => atalho(p)} style={{
              padding: '0.38rem 0.7rem',
              fontFamily: 'var(--font-body)',
              fontSize: '0.78rem',
              border: 'none',
              borderRight: i < atalhos.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
              cursor: 'pointer',
              color: ativo ? 'white' : 'var(--color-text-muted)',
              backgroundColor: ativo ? 'var(--color-ponto-conversao)' : 'transparent',
              fontWeight: ativo ? 700 : 400,
              transition: 'background-color 0.15s, color 0.15s',
            }}>
              {p}d
            </button>
          )
        })}
      </div>

      {/* Botão de intervalo personalizado */}
      <button
        onClick={() => (aberto ? setAberto(false) : abrirCalendario())}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.45rem',
          backgroundColor: aberto ? 'var(--color-ponto-conversao)' : 'var(--color-bg-card)',
          border: `1px solid ${aberto ? 'var(--color-ponto-conversao)' : 'var(--color-border-subtle)'}`,
          borderRadius: 'var(--radius-md)',
          padding: '0.38rem 0.75rem',
          cursor: 'pointer',
          color: aberto ? 'white' : 'var(--color-text-primary)',
          fontFamily: 'var(--font-body)',
          fontSize: '0.78rem',
          fontWeight: aberto ? 700 : 500,
          transition: 'background-color 0.15s, color 0.15s, border-color 0.15s',
          whiteSpace: 'nowrap',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.8 }}>
          <rect x="1" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M1 7h14" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        {fmtDisplay(de)} → {fmtDisplay(ate)}
      </button>

      {/* Calendário flutuante */}
      {aberto && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          zIndex: 999,
          backgroundColor: 'var(--color-bg-card)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: '1.1rem',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}>
          {/* Cabeçalho com feedback da seleção em curso */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
            marginBottom: '0.9rem', paddingBottom: '0.9rem',
            borderBottom: '1px solid var(--color-border-subtle)',
          }}>
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 700,
              letterSpacing: '0.02em', color: 'var(--color-text-primary)',
            }}>
              Selecionar período
            </span>
            <span style={{
              fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 600,
              color: selecionando?.from && selecionando?.to ? 'var(--color-ponto-conversao)' : 'var(--color-text-muted)',
              whiteSpace: 'nowrap',
            }}>
              {selecionando?.from
                ? selecionando.to
                  ? `${format(selecionando.from, 'dd/MM/yy')} → ${format(selecionando.to, 'dd/MM/yy')}`
                  : `${format(selecionando.from, 'dd/MM/yy')} → escolha o fim`
                : 'Escolha a data inicial'}
            </span>
          </div>

          <DayPicker
            mode="range"
            selected={rangeSelecionado}
            onSelect={handleSelect}
            locale={ptBR}
            numberOfMonths={2}
            disabled={[
              ...(minData ? [{ before: parseISO(minData) }] : []),
              { after: parseISO(max) },
            ]}
            defaultMonth={parseISO(de)}
            style={{ margin: 0 }}
          />
          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: '0.6rem',
            borderTop: '1px solid var(--color-border-subtle)', paddingTop: '0.9rem', marginTop: '0.4rem',
          }}>
            <button onClick={cancelar} style={{
              padding: '0.4rem 1rem', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border-subtle)',
              background: 'transparent', color: 'var(--color-text-secondary)',
              fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer',
              transition: 'background-color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)'; e.currentTarget.style.borderColor = 'var(--color-border-default)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = 'var(--color-border-subtle)' }}
            >Cancelar</button>
            <button
              onClick={aplicar}
              disabled={!(selecionando?.from && selecionando?.to)}
              style={{
                padding: '0.4rem 1.1rem', borderRadius: 'var(--radius-md)',
                border: 'none',
                background: selecionando?.from && selecionando?.to ? 'var(--color-ponto-conversao)' : 'var(--color-bg-tertiary)',
                color: selecionando?.from && selecionando?.to ? 'white' : 'var(--color-text-muted)',
                fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 700,
                cursor: selecionando?.from && selecionando?.to ? 'pointer' : 'not-allowed',
                transition: 'background-color 0.15s',
              }}
              onMouseEnter={e => { if (selecionando?.from && selecionando?.to) e.currentTarget.style.backgroundColor = 'var(--color-accent-hover)' }}
              onMouseLeave={e => { if (selecionando?.from && selecionando?.to) e.currentTarget.style.backgroundColor = 'var(--color-ponto-conversao)' }}
            >Aplicar</button>
          </div>
        </div>
      )}

      <style>{`
        .rdp-root {
          --rdp-accent-color: #5F8A3C;
          --rdp-accent-background-color: rgba(95,138,60,0.16);
          color: var(--color-text-primary);
          font-family: var(--font-body);
        }
        .rdp-range_middle, .rdp-range_start, .rdp-range_end { background: rgba(95,138,60,0.16) !important; border-radius: 0 !important; }
        .rdp-range_start { border-top-left-radius: var(--radius-sm) !important; border-bottom-left-radius: var(--radius-sm) !important; }
        .rdp-range_end { border-top-right-radius: var(--radius-sm) !important; border-bottom-right-radius: var(--radius-sm) !important; }
        .rdp-selected .rdp-day_button, .rdp-selected .rdp-day_button:hover { background-color: #5F8A3C !important; color: white !important; border: none !important; }
        .rdp-range_middle .rdp-day_button { background-color: transparent !important; color: var(--color-text-primary) !important; border: none !important; }
        .rdp-range_start .rdp-day_button, .rdp-range_end .rdp-day_button { background-color: #5F8A3C !important; color: white !important; border: none !important; }
        .rdp-caption_label { color: var(--color-text-primary); font-family: var(--font-display); font-weight: 700; font-size: 0.95rem; letter-spacing: 0.02em; text-transform: capitalize; }
        .rdp-weekday { color: var(--color-text-muted); font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
        .rdp-day_button { color: var(--color-text-secondary); font-size: 0.8rem; font-weight: 500; border-radius: var(--radius-sm) !important; transition: background-color 0.12s, color 0.12s; }
        .rdp-day_button:hover:not([disabled]) { background-color: var(--color-bg-tertiary) !important; color: var(--color-text-primary) !important; }
        .rdp-today:not(.rdp-selected):not(.rdp-range_start):not(.rdp-range_end):not(.rdp-range_middle) .rdp-day_button { color: var(--color-ponto-conversao) !important; font-weight: 700; }
        .rdp-disabled { opacity: 0.25; }
        .rdp-chevron { fill: var(--color-text-muted); transition: fill 0.12s; }
        .rdp-button_previous, .rdp-button_next { color: var(--color-text-muted); border-radius: var(--radius-sm) !important; }
        .rdp-button_previous:hover, .rdp-button_next:hover { background-color: var(--color-bg-tertiary) !important; }
        .rdp-button_previous:hover .rdp-chevron, .rdp-button_next:hover .rdp-chevron { fill: var(--color-ponto-conversao); }
        .rdp-months { gap: 1.25rem; }
      `}</style>
    </div>
  )
}
