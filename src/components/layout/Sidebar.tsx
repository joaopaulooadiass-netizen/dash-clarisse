'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'

const nav = [
  { href: '/dashboard',                label: 'Visão Geral'    },
  { href: '/dashboard/diaria',         label: 'Visão Diária'   },
  { href: '/dashboard/tendencias',     label: 'Tendências'     },
  { href: '/dashboard/publicos',       label: 'Públicos'       },
  { href: '/dashboard/posicionamento', label: 'Posicionamento' },
  { href: '/dashboard/criativo',       label: 'Criativos'      },
  { href: '/dashboard/rentabilidade',  label: 'Faturamento'    },
  { href: '/dashboard/listas',         label: 'Listas'         },
]

function IconSettings({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" stroke={color} strokeWidth="1.4"/>
      <path d="M13.3 8c0-.2 0-.5-.1-.7l1.5-1.2-1.4-2.4-1.8.7c-.4-.3-.8-.5-1.3-.7L10 2H7.9l-.3 1.8c-.4.1-.9.4-1.2.7l-1.9-.7-1.4 2.4L4.7 7.3c0 .2-.1.5-.1.7s0 .5.1.7L3.1 9.9l1.4 2.4 1.9-.7c.4.3.8.5 1.2.7l.3 1.7H10l.3-1.7c.4-.2.9-.4 1.3-.7l1.8.7 1.4-2.4-1.5-1.2c0-.2.1-.5.1-.7Z" stroke={color} strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const activeConfig = pathname === '/dashboard/configuracoes'

  return (
    <aside style={{
      width: '220px',
      height: '100%',
      backgroundColor: 'var(--color-bg-secondary)',
      borderRight: '1px solid var(--color-border-subtle)',
      display: 'flex',
      flexDirection: 'column',
      padding: '1.5rem 0',
      flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{ padding: '1.25rem 1.25rem 1.25rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
        <Image
          src="/brand/logo.svg"
          alt="Salto para o Dólar"
          width={239}
          height={106}
          style={{ width: '100%', height: 'auto', maxHeight: '72px', objectFit: 'contain', objectPosition: 'left' }}
          priority
        />
      </div>

      {/* Navegação principal */}
      <nav style={{ padding: '1rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
        {nav.map(({ href, label }) => {
          const active = pathname === href
          return (
            <Link key={href} href={href} style={{
              display: 'block',
              padding: '0.6rem 0.75rem',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'var(--font-body)',
              fontSize: '0.875rem',
              fontWeight: active ? 600 : 400,
              color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              backgroundColor: active ? 'var(--color-bg-tertiary)' : 'transparent',
              textDecoration: 'none',
              borderLeft: active ? '2px solid var(--color-ponto-conversao)' : '2px solid transparent',
              transition: 'all 0.15s',
            }}>
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Configurações */}
      <div style={{ padding: '0.5rem 0.75rem', borderTop: '1px solid var(--color-border-subtle)' }}>
        <Link href="/dashboard/configuracoes" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.55rem',
          padding: '0.6rem 0.75rem',
          borderRadius: 'var(--radius-md)',
          fontFamily: 'var(--font-body)',
          fontSize: '0.875rem',
          fontWeight: activeConfig ? 600 : 400,
          color: activeConfig ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          backgroundColor: activeConfig ? 'var(--color-bg-tertiary)' : 'transparent',
          textDecoration: 'none',
          borderLeft: activeConfig ? '2px solid var(--color-ponto-conversao)' : '2px solid transparent',
          transition: 'all 0.15s',
        }}>
          <IconSettings color={activeConfig ? 'var(--color-text-primary)' : 'var(--color-text-muted)'} />
          Configurações
        </Link>
      </div>

      {/* Rodapé */}
      <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--color-border-subtle)' }}>
        <div>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--color-text-muted)', margin: 0 }}>
            Clarisse Teresa
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.65rem', color: 'var(--color-text-muted)', opacity: 0.6, margin: 0 }}>
            cliente
          </p>
        </div>
      </div>
    </aside>
  )
}
