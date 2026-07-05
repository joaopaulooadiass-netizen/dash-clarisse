// ─── Fonte ÚNICA de datas do app — fuso do NEGÓCIO (America/Sao_Paulo) ────────
// `new Date().toISOString()` é UTC: entre 21h e 23h59 BRT ele já devolve AMANHÃ.
// Antes deste helper, cada tela tinha sua cópia de hoje()/subDias() em UTC, o que
// encurtava períodos ("7d" virava 6 dias de dado), mostrava data futura no seletor
// e desalinhava o time_range enviado à Meta (conta anunciante em horário de Brasília).
// Vale no navegador E na Vercel (UTC) — Intl resolve o fuso independente do runtime.

const TZ = 'America/Sao_Paulo'

// Hoje no fuso de Brasília, formato YYYY-MM-DD ('en-CA' emite ISO)
export function hoje(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

// n dias antes de `base` (default: hoje BRT). Aritmética ancorada em 12:00Z —
// imune a fuso e a horário de verão.
export function subDias(n: number, base?: string): string {
  const d = new Date(`${base ?? hoje()}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

// n dias depois de `iso`
export function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Diferença em dias entre duas datas ISO (ate - de)
export function difDias(de: string, ate: string): number {
  return Math.round((new Date(`${ate}T12:00:00Z`).getTime() - new Date(`${de}T12:00:00Z`).getTime()) / 86_400_000)
}
