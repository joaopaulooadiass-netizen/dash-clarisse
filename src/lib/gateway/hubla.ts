import type { TransacaoGateway } from '@/lib/config/rentabilidade'

// ─── Hubla — eventos de webhook (v2) ──────────────────────────────────────────
// A Hubla não tem API pública de consulta: as vendas chegam por webhook.
// Docs: https://hubla.gitbook.io/docs/webhooks (invoice.payment_succeeded,
// invoice.status_updated). Autenticidade via header `x-hubla-token`;
// deduplicação via `x-hubla-idempotency`.
//
// Este módulo é a ponte Hubla → dashboard: o webhook plugará `mapHublaInvoice` na
// API route que recebe o webhook, e a tela de Faturamento já entende o resultado.

export type HublaInvoiceStatus =
  | 'draft'
  | 'unpaid'
  | 'overdue'
  | 'paid'
  | 'refunded'
  | 'disputed'
  | 'chargeback'

export interface HublaUTM {
  source?: string
  medium?: string
  campaign?: string
  content?: string
  term?: string
}

export interface HublaInvoice {
  id: string
  status: HublaInvoiceStatus
  type?: string                      // 'sell', renovação etc.
  paymentMethod?: string             // credit_card, pix, ...
  currency?: string                  // BRL
  installments?: number
  amount?: {
    subtotalCents?: number
    discountCents?: number
    installmentFeeCents?: number
    totalCents?: number
  }
  saleDate?: string                  // ISO 8601
  createdAt?: string
  firstPaymentSession?: {
    ip?: string
    utm?: HublaUTM
  }
}

export interface HublaInvoiceEvent {
  type: string                       // 'invoice.payment_succeeded' | 'invoice.status_updated' | ...
  version: string                    // '2.0.0'
  event: {
    product?: { id?: string; name?: string }
    payer?: { id?: string; email?: string; firstName?: string; lastName?: string }
    invoice?: HublaInvoice
    // Alguns eventos trazem UTM/sessão no nível do evento em vez de dentro da fatura
    firstPaymentSession?: { ip?: string; utm?: HublaUTM }
  }
}

// Status da Hubla → status da tela de Faturamento
const STATUS_MAP: Record<HublaInvoiceStatus, TransacaoGateway['status']> = {
  paid:       'aprovado',
  refunded:   'reembolso',
  chargeback: 'chargeback',
  disputed:   'chargeback',
  unpaid:     'pendente',
  overdue:    'pendente',
  draft:      'pendente',
}

// ─── Importação de CSV (export "Vendas" do painel da Hubla) ──────────────────
// Caminho interim enquanto o webhook não existe — e única fonte do histórico
// (webhook só captura vendas a partir da ativação).

// O export da Hubla pode vir em UTF-8 ou Windows-1252 — escolhe a decodificação
// com menos anomalias ('�' indica byte inválido p/ UTF-8; 'Ã£'/'Ã©' indica
// arquivo UTF-8 lido como 1252, o clássico "JoÃ£o")
export function decodificarCSV(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf)
  if (!utf8.includes('�')) return utf8
  const cp1252 = new TextDecoder('windows-1252').decode(buf)
  const anomalias = (s: string) => (s.match(/�|Ã[£©­ºµ¡§]/g) ?? []).length
  return anomalias(cp1252) < anomalias(utf8) ? cp1252 : utf8
}

// Parser CSV com suporte a aspas (campo com vírgula, aspa escapada "" e quebra
// de linha DENTRO de aspas — RFC 4180). Exportado: a tela de Listas usa o mesmo
// parser (a versão antiga de lá quebrava a linha em \n antes de olhar as aspas).
export function parseLinhasCSV(texto: string, sep = ','): string[][] {
  const linhas: string[][] = []
  let campo = ''
  let linha: string[] = []
  let aspas = false

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++ } else aspas = false
      } else campo += c
    } else if (c === '"') {
      aspas = true
    } else if (c === sep) {
      linha.push(campo); campo = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++
      linha.push(campo); campo = ''
      if (linha.some(v => v.trim() !== '')) linhas.push(linha)
      linha = []
    } else campo += c
  }
  linha.push(campo)
  if (linha.some(v => v.trim() !== '')) linhas.push(linha)
  return linhas
}

// Normaliza header para casar mesmo com acentos quebrados por encoding
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/gi, '').toLowerCase().trim()
}

const STATUS_CSV: [RegExp, TransacaoGateway['status'] | null][] = [
  [/^paga/, 'aprovado'],
  [/reembols/, 'reembolso'],
  [/chargeback|disput|estorn/, 'chargeback'],
  [/aguard|pendente|process/, 'pendente'],
  [/recusad|expirad|cancelad/, null],    // nunca foi venda — não entra
]

function dataBR(s: string): string | null {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

// Converte valor monetário do CSV ("R$ 1.997,00", "1997,5", "1997.50") em número.
// Regra pt-BR: vírgula é o decimal; ponto só é decimal quando NÃO há vírgula e
// não casa com padrão de milhar ("1.997" → 1997). O replace(',', '.') antigo
// transformava "1.997,00" em "1.997.00" e o parseFloat parava no primeiro ponto:
// uma venda de R$ 1.997,00 era registrada como R$ 1,99.
// Exportado: a tela de Listas usa nos CSVs de compradores/gasto Meta (mesmo formato).
export function parseValorBR(bruto: string): number {
  const s = bruto.replace(/[^\d.,-]/g, '')
  if (!s) return NaN
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.'))
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return parseFloat(s.replace(/\./g, ''))
  return parseFloat(s)
}

// O checkout da Hubla tem URLs com '??utm_source=' (bug deles) que perdem o
// utm_source da coluna — recuperamos parseando a URL de compra.
function utmsDaURL(url: string): Partial<Record<'source' | 'medium' | 'campaign' | 'content' | 'term', string>> {
  if (!url) return {}
  try {
    const query = url.split('?').slice(1).join('&')
    const params = new URLSearchParams(query)
    const limpo = (v: string | null) => (v && v !== 'null' ? v : '')
    return {
      source: limpo(params.get('utm_source')),
      medium: limpo(params.get('utm_medium')),
      campaign: limpo(params.get('utm_campaign')),
      content: limpo(params.get('utm_content')),
      term: limpo(params.get('utm_term')),
    }
  } catch {
    return {}
  }
}

// Converte o CSV de vendas da Hubla em TransacaoGateway[].
// Guarda SÓ os campos do dashboard — nada de PII (nome, CPF, e-mail ficam fora).
export function parseHublaCSV(texto: string): TransacaoGateway[] {
  const linhas = parseLinhasCSV(texto)
  if (linhas.length < 2) return []

  const headers = linhas[0].map(normalizar)
  const idx = (...nomes: string[]) => {
    for (const nome of nomes) {
      const i = headers.findIndex(h => h === nome)
      if (i >= 0) return i
    }
    return -1
  }

  const iId = idx('id da fatura')
  const iStatus = idx('status da fatura')
  const iPagamento = idx('data de pagamento')
  const iCriacao = idx('data de criacao')
  const iReembolso = idx('data de reembolso')
  const iProduto = idx('nome do produto')
  const iOferta = idx('nome da oferta')
  const iValor = idx('valor total')
  const iLiquido = idx('valor liquido')
  const iSource = idx('utm origem')
  const iMedium = idx('utm midia')
  const iCampaign = idx('utm campanha')
  const iContent = idx('utm conteudo')
  const iTerm = idx('utm termo')
  const iURL = idx('url de compra')

  if (iId < 0 || iStatus < 0 || iValor < 0) return []

  const col = (linha: string[], i: number) => (i >= 0 ? (linha[i] ?? '').trim() : '')
  const transacoes: TransacaoGateway[] = []

  for (const linha of linhas.slice(1)) {
    const statusBruto = normalizar(col(linha, iStatus))
    const regra = STATUS_CSV.find(([re]) => re.test(statusBruto))
    if (!regra) continue
    const status = regra[1]
    if (status === null) continue

    const valor = parseValorBR(col(linha, iValor))
    if (!Number.isFinite(valor) || valor <= 0) continue

    const data =
      (status === 'reembolso' ? dataBR(col(linha, iReembolso)) : null) ??
      dataBR(col(linha, iPagamento)) ??
      dataBR(col(linha, iCriacao))
    if (!data) continue

    const liquido = parseValorBR(col(linha, iLiquido))
    const daURL = utmsDaURL(col(linha, iURL))

    transacoes.push({
      id: col(linha, iId),
      data,
      valor,
      status,
      produto: col(linha, iProduto) || col(linha, iOferta) || '(produto)',
      utm_source: col(linha, iSource) || daURL.source || '',
      utm_medium: col(linha, iMedium) || daURL.medium || '',
      utm_campaign: col(linha, iCampaign) || daURL.campaign || '',
      utm_content: col(linha, iContent) || daURL.content || '',
      utm_term: col(linha, iTerm) || daURL.term || '',
      // liquido > valor indicaria coluna trocada/CSV corrompido → ignora o campo
      // (a tela cai na estimativa de taxa) em vez de exibir taxa negativa
      ...(Number.isFinite(liquido) && liquido > 0 && liquido <= valor ? { valorLiquido: liquido } : {}),
    })
  }

  // Dedup por id (re-importar o mesmo período não duplica)
  const porId = new Map<string, TransacaoGateway>()
  for (const t of transacoes) porId.set(t.id, t)
  return Array.from(porId.values()).sort((a, b) => a.data.localeCompare(b.data))
}

// Converte um evento de fatura da Hubla em TransacaoGateway.
// Retorna null para eventos sem fatura ou sem valor (ex.: lead, draft sem total).
export function mapHublaInvoice(evt: HublaInvoiceEvent): TransacaoGateway | null {
  const inv = evt.event?.invoice
  if (!inv?.id || !inv.status) return null

  const totalCents = inv.amount?.totalCents
  if (typeof totalCents !== 'number' || totalCents <= 0) return null

  const dataISO = inv.saleDate ?? inv.createdAt
  if (!dataISO) return null

  const utm = inv.firstPaymentSession?.utm ?? evt.event?.firstPaymentSession?.utm ?? {}

  return {
    id:           inv.id,
    data:         dataISO.slice(0, 10),
    valor:        totalCents / 100,
    status:       STATUS_MAP[inv.status] ?? 'pendente',
    produto:      evt.event?.product?.name ?? '(produto)',
    utm_source:   utm.source ?? '',
    utm_medium:   utm.medium ?? '',
    utm_campaign: utm.campaign ?? '',
    utm_content:  utm.content ?? '',
    utm_term:     utm.term ?? '',
  }
}
