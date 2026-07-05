'use client'

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem', padding: '2rem', backgroundColor: 'var(--color-bg-primary)' }}>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '0.03em' }}>ALGO DEU ERRADO</p>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--color-text-muted)', maxWidth: '360px', textAlign: 'center' }}>{error.message}</p>
      <button onClick={reset} style={{ padding: '0.5rem 1.25rem', backgroundColor: 'var(--color-ponto-conversao)', border: 'none', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'white', cursor: 'pointer', fontWeight: 600 }}>
        Tentar novamente
      </button>
    </div>
  )
}
