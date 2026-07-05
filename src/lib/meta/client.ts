const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v21.0'
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`
const TIMEOUT_MS = 30_000

export class MetaAPIError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    const msg = (body as { error?: { message?: string } })?.error?.message
    super(msg ?? `Meta API ${status}: ${JSON.stringify(body)}`)
    this.name = 'MetaAPIError'
  }
}

export function accountPath(): string {
  const id = process.env.META_AD_ACCOUNT_ID
  if (!id) throw new Error('META_AD_ACCOUNT_ID não definido em .env.local')
  return id.startsWith('act_') ? id : `act_${id}`
}

export async function metaGet<T>(
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  // O token nunca pode chegar ao navegador — esta lib é exclusiva do servidor
  if (typeof window !== 'undefined') {
    throw new Error('metaGet só pode rodar no servidor (token da Meta não vai para o cliente)')
  }

  const token = process.env.META_ACCESS_TOKEN
  if (!token) throw new Error('META_ACCESS_TOKEN não definido em .env.local')

  const url = new URL(`${BASE}/${path}`)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }

  // Token no header (não na URL) para não vazar em logs de acesso/proxies
  const doFetch = () => fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 1800 }, // cache de 30 min no servidor Next.js
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  let res = await doFetch()

  // Uma nova tentativa em erro transitório (rate limit / instabilidade da Meta)
  if (res.status === 429 || res.status >= 500) {
    await new Promise(r => setTimeout(r, 1500))
    res = await doFetch()
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new MetaAPIError(res.status, body)
  }

  return res.json() as T
}

export interface MetaPaged<T> {
  data: T[]
  paging?: {
    cursors?: { after?: string }
    next?: string
  }
}

// A Meta rejeita consultas com série diária em períodos muito longos (erro
// genérico code 1, subcode 99 — verificado: 365d falha, 180d passa). Quem busca
// time_increment=1 deve fatiar o período em janelas e concatenar os resultados.
export function fatiarPeriodo(since: string, until: string, maxDias = 90): { since: string; until: string }[] {
  const janelas: { since: string; until: string }[] = []
  let ini = new Date(`${since}T12:00:00`)
  const fim = new Date(`${until}T12:00:00`)

  while (ini <= fim) {
    const f = new Date(ini)
    f.setDate(f.getDate() + maxDias - 1)
    const fimJanela = f < fim ? f : fim
    janelas.push({ since: ini.toISOString().slice(0, 10), until: fimJanela.toISOString().slice(0, 10) })
    ini = new Date(fimJanela)
    ini.setDate(ini.getDate() + 1)
  }

  return janelas
}

export async function metaGetAll<T>(
  path: string,
  params: Record<string, string> = {},
  maxPages = 10,
): Promise<T[]> {
  const rows: T[] = []
  let after: string | undefined

  for (let page = 0; page < maxPages; page++) {
    const resp = await metaGet<MetaPaged<T>>(
      path,
      after ? { ...params, after } : params,
    )
    rows.push(...resp.data)

    after = resp.paging?.cursors?.after
    if (!after || !resp.paging?.next) break
  }

  return rows
}
