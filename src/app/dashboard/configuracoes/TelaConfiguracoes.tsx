'use client'

import { useState } from 'react'

// ─── Dados de exibição ────────────────────────────────────────────────────────
// Regra do projeto: NADA inventado. O que aparece aqui é real (pessoas do
// projeto, tools do MCP, conta vinda do env via page.tsx); blocos sem backend
// (webhooks, convites) mostram estado vazio honesto até a integração existir.

const usuarios = [
  { id: 1, nome: 'Clarisse Teresa', papel: 'Cliente',        cor: '#5F8A3C' },
  { id: 2, nome: 'João Paulo',      papel: 'Gestor',         cor: '#8FA0DC' },
]

// Descrições espelham o comportamento real das tools (src/app/api/mcp/route.ts)
const mcpTools = [
  { nome: 'get_resumo_periodo',   desc: 'KPIs consolidados do período'  },
  { nome: 'get_metricas_diarias', desc: 'Série diária + anomalias'      },
  { nome: 'get_campanhas',        desc: 'Lista com filtros e ordenação' },
  { nome: 'get_top_campanhas',    desc: 'Ranking pelo critério escolhido' },
  { nome: 'get_criativos',        desc: 'Métricas por anúncio/criativo' },
  { nome: 'get_tendencia',        desc: 'Variação % 1ª vs 2ª metade'    },
]


// ─── Primitivos ───────────────────────────────────────────────────────────────

function Dot({ color }: { color: string }) {
  return <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color, display: 'inline-block', flexShrink: 0 }} />
}

function Chip({ label, color, bg, border }: { label: string; color: string; bg: string; border: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '0.18rem 0.55rem', borderRadius: 999,
      fontSize: '0.67rem', fontWeight: 700, fontFamily: 'var(--font-body)',
      letterSpacing: '0.05em', textTransform: 'uppercase',
      color, backgroundColor: bg, border: `1px solid ${border}`,
    }}>
      <Dot color={color} />
      {label}
    </span>
  )
}


function CopyBtn({ text, size = 'sm' }: { text: string; size?: 'sm' | 'xs' }) {
  const [ok, setOk] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 2000) })
  }
  const pad = size === 'xs' ? '0.22rem 0.55rem' : '0.3rem 0.7rem'
  const fs  = size === 'xs' ? '0.68rem' : '0.72rem'
  return (
    <button onClick={copy} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: pad, borderRadius: 6,
      border: `1px solid ${ok ? 'rgba(95,138,60,0.3)' : 'var(--color-border-default)'}`,
      background: ok ? 'rgba(95,138,60,0.08)' : 'var(--color-bg-tertiary)',
      color: ok ? '#5F8A3C' : 'var(--color-text-muted)',
      fontFamily: 'var(--font-body)', fontSize: fs, fontWeight: 600,
      cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
    }}>
      {ok
        ? <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        : <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" stroke="currentColor" strokeWidth="1.5"/></svg>
      }
      {ok ? 'Copiado' : 'Copiar'}
    </button>
  )
}

function BtnGhost({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '0.32rem 0.8rem', borderRadius: 7,
      border: '1px solid var(--color-border-default)',
      background: 'transparent',
      color: disabled ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
      fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 600,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1, transition: 'all 0.15s',
    }}>
      {children}
    </button>
  )
}

function Card({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      backgroundColor: 'var(--color-bg-card)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 12, overflow: 'hidden', ...style,
    }}>
      {children}
    </div>
  )
}

function Row({ label, sub, right, last }: { label: string; sub?: string; right: React.ReactNode; last?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0.9rem 1.25rem',
      borderBottom: last ? 'none' : '1px solid var(--color-border-subtle)',
    }}>
      <div>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>{label}</p>
        {sub && <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)', margin: '2px 0 0' }}>{sub}</p>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        {right}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 700,
      color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em',
      margin: '0 0 0.6rem',
    }}>
      {children}
    </p>
  )
}

// ─── Blocos ───────────────────────────────────────────────────────────────────

function BlocoAparencia() {
  return (
    <Card>
      <Row
        label="Tema"
        sub="Modo claro — modo escuro em breve"
        right={
          <>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              Claro
            </span>
            <Chip label="Em breve" color="#8FA0DC" bg="rgba(143,160,220,0.1)" border="rgba(143,160,220,0.2)" />
          </>
        }
        last
      />
    </Card>
  )
}

function BlocoIdioma() {
  return (
    <Card>
      <Row
        label="Idioma da interface"
        sub="Português — Brasil"
        right={
          <>
            <Chip label="Em breve" color="#8FA0DC" bg="rgba(143,160,220,0.1)" border="rgba(143,160,220,0.2)" />
            <BtnGhost disabled>Alterar</BtnGhost>
          </>
        }
        last
      />
    </Card>
  )
}

function BlocoMcp() {
  const [aberto, setAberto] = useState(false)
  return (
    <Card>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1rem 1.25rem',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Chip label="Ativo" color="#5F8A3C" bg="rgba(95,138,60,0.1)" border="rgba(95,138,60,0.2)" />
          <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Integração com IA — MCP
          </span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            {mcpTools.length} ferramentas
          </span>
        </div>
        <button
          onClick={() => setAberto(v => !v)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '0.3rem 0.75rem', borderRadius: 7,
            border: '1px solid var(--color-border-default)',
            background: aberto ? 'var(--color-bg-tertiary)' : 'transparent',
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s',
          }}
        >
          {aberto ? 'Fechar' : 'Configurar'}
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"
            style={{ transform: aberto ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Tools grid — sempre visível */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '0.5rem', padding: '1rem 1.25rem',
        borderBottom: aberto ? '1px solid var(--color-border-subtle)' : 'none',
      }}>
        {mcpTools.map(t => (
          <div key={t.nome} style={{
            backgroundColor: 'var(--color-bg-tertiary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 8, padding: '0.55rem 0.7rem',
          }}>
            <code style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#5F8A3C', display: 'block', marginBottom: 3 }}>
              {t.nome}
            </code>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
              {t.desc}
            </span>
          </div>
        ))}
      </div>

      {/* Configuração expandida */}
      {aberto && (
        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Claude.ai App */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
                  Claude.ai — Web / Desktop
                </p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)', margin: '2px 0 0' }}>
                  Para equipe e diretoria. Requer deploy do servidor remoto.
                </p>
              </div>
              <Chip label="Aguardando deploy" color="#E8BE0B" bg="rgba(232,190,11,0.1)" border="rgba(232,190,11,0.2)" />
            </div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '0 0 0.75rem' }}>
              Em <strong style={{ color: 'var(--color-text-secondary)' }}>Settings → Connectors → Add custom connector</strong>:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {[
                { label: 'Name',                  value: 'Dashboard Salto para o Dólar',                 mono: false },
                { label: 'Remote MCP server URL', value: 'https://[dominio].vercel.app/api/mcp',     mono: true  },
                { label: 'OAuth Client ID',        value: '— não necessário',                         mono: false },
                { label: 'OAuth Client Secret',    value: '— não necessário',                         mono: false },
              ].map(f => (
                <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{
                    fontFamily: 'var(--font-body)', fontSize: '0.72rem',
                    color: 'var(--color-text-muted)', width: 170, flexShrink: 0,
                  }}>
                    {f.label}
                  </span>
                  <div style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    backgroundColor: 'var(--color-bg-tertiary)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: 7, padding: '0.42rem 0.7rem',
                  }}>
                    <span style={{
                      fontFamily: f.mono ? 'monospace' : 'var(--font-body)',
                      fontSize: f.mono ? '0.75rem' : '0.8rem',
                      color: f.value.startsWith('—') ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                      fontStyle: f.value.startsWith('—') ? 'italic' : 'normal',
                    }}>
                      {f.value}
                    </span>
                    {!f.value.startsWith('—') && <CopyBtn text={f.value} size="xs" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function Avatar({ nome, cor }: { nome: string; cor: string }) {
  const initials = nome.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{
      width: 30, height: 30, borderRadius: '50%',
      backgroundColor: `${cor}18`,
      border: `1px solid ${cor}40`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-body)', fontSize: '0.68rem', fontWeight: 800,
      color: cor, flexShrink: 0,
    }}>
      {initials}
    </div>
  )
}

function BlocoUsuarios() {
  return (
    <Card>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.85rem 1.25rem',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
          Usuários do sistema
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
            {usuarios.length} membros
          </span>
          <BtnGhost disabled>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
            Convidar
          </BtnGhost>
        </div>
      </div>

      {usuarios.map((u, i) => (
        <div key={u.id} style={{
          display: 'flex', alignItems: 'center',
          padding: '0.75rem 1.25rem',
          borderBottom: i < usuarios.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
          gap: '0.75rem',
        }}>
          <Avatar nome={u.nome} cor={u.cor} />
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
              {u.nome}
            </p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)', margin: '1px 0 0' }}>
              login disponível após autenticação
            </p>
          </div>
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: '0.72rem', fontWeight: 600,
            color: u.cor, opacity: 0.9,
          }}>
            {u.papel}
          </span>
        </div>
      ))}

      <div style={{ padding: '0.65rem 1.25rem', borderTop: '1px solid var(--color-border-subtle)' }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)', margin: 0, opacity: 0.7 }}>
          Convites por e-mail disponíveis após a integração com autenticação.
        </p>
      </div>
    </Card>
  )
}

// Recebe a conta REAL do servidor (env META_AD_ACCOUNT_ID via page.tsx) — nada
// de IDs de exemplo: ou mostra a conta configurada, ou o vazio honesto.
function BlocoContas({ contaId }: { contaId?: string }) {
  return (
    <Card>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.85rem 1.25rem',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
          Contas de anúncio
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
            Meta Ads
          </span>
          <BtnGhost disabled>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
            Conectar
          </BtnGhost>
        </div>
      </div>

      {contaId ? (
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '0.8rem 1.25rem',
          gap: '0.75rem',
        }}>
          {/* Meta logo */}
          <div style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            backgroundColor: 'rgba(24,119,242,0.1)',
            border: '1px solid rgba(24,119,242,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#1877f2">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
              Salto para o Dólar
            </p>
            <p style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'var(--color-text-muted)', margin: '2px 0 0' }}>
              {contaId}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Chip
              label="Configurada"
              color="#5F8A3C"
              bg="rgba(95,138,60,0.1)"
              border="rgba(95,138,60,0.2)"
            />
            <CopyBtn text={contaId} size="xs" />
          </div>
        </div>
      ) : (
        <div style={{ padding: '1rem 1.25rem' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: 0 }}>
            Nenhuma conta configurada — defina META_AD_ACCOUNT_ID no ambiente.
          </p>
        </div>
      )}

      <div style={{ padding: '0.65rem 1.25rem', borderTop: '1px solid var(--color-border-subtle)' }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)', margin: 0, opacity: 0.7 }}>
          Conexão via API do Meta Ads. Novas contas serão adicionadas pelo painel de admin.
        </p>
      </div>
    </Card>
  )
}

// Sem backend de webhooks ainda — vazio honesto (a lista de exemplo antiga
// mostrava disparos e status "Ativo" fictícios, violando a regra do projeto).
function BlocoWebhooks() {
  return (
    <Card>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.85rem 1.25rem',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Webhooks
          </span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
            nenhum configurado
          </span>
        </div>
        <BtnGhost disabled>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
          Novo webhook
        </BtnGhost>
      </div>

      <div style={{ padding: '1.1rem 1.25rem' }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--color-text-secondary)', margin: 0, fontWeight: 600 }}>
          Nenhum webhook configurado
        </p>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--color-text-muted)', margin: '0.3rem 0 0', lineHeight: 1.5 }}>
          Alertas automáticos (anomalias, relatórios, campanha pausada) serão configuráveis aqui
          quando o backend de webhooks existir.
        </p>
      </div>

      <div style={{ padding: '0.65rem 1.25rem', borderTop: '1px solid var(--color-border-subtle)' }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)', margin: 0, opacity: 0.7 }}>
          Criação e remoção de webhooks disponível após a integração com o backend.
        </p>
      </div>
    </Card>
  )
}

// ─── Tela ─────────────────────────────────────────────────────────────────────

export function TelaConfiguracoes({ contaId }: { contaId?: string }) {
  return (
    <div style={{ padding: '2rem 2.5rem' }}>

      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.7rem', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
          Configurações
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '0.3rem' }}>
          Preferências, integrações e gestão de acesso.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

        {/* Preferências — 2 cards lado a lado */}
        <div>
          <SectionTitle>Preferências</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <BlocoAparencia />
            <BlocoIdioma />
          </div>
        </div>

        {/* Integrações — MCP + Webhooks */}
        <div>
          <SectionTitle>Integrações</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <BlocoMcp />
            <BlocoWebhooks />
          </div>
        </div>

        {/* Acesso — largura total */}
        <div>
          <SectionTitle>Acesso</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <BlocoUsuarios />
            <BlocoContas contaId={contaId} />
          </div>
        </div>

      </div>

    </div>
  )
}
