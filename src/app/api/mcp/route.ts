import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import {
  getMetricasDiarias,
  getCampanhas,
  getResumoPeriodo,
  getTopCampanhas,
  getCriativos,
  FILTRO_TAGS,
} from '../../../../mcp-server/data.js'

// Endpoint MCP remoto — espelha as tools de mcp-server/index.js (uso local via stdio)
// para permitir conectar o app Claude.ai diretamente neste domínio.
// Autenticação: bearer token estático (MCP_API_TOKEN) via header OU ?key= na URL
// (o conector custom do claude.ai não suporta header — manter o ?key=).
//
// Conta multi-objetivo: toda tool aceita filtro_tag ([VENDAS], [LEADS], [C1]...).
// Sem metas/benchmarks fictícios. receita_pixel = só o que o pixel rastreia.

const filtroTagSchema = z.enum(FILTRO_TAGS as [string, ...string[]]).default('todas')
  .describe('Filtra campanhas pela tag no nome: VENDAS, LEADS, CPT (objetivo) ou C1 atração / C2 distribuição / C3 quebra de objeção (corredor)')

const METRICAS_DIARIAS = ['todas', 'gasto', 'impressoes', 'cliques', 'ctr', 'cpc', 'cpm', 'page_views', 'compras', 'receita_pixel', 'leads', 'seguidores', 'cpl', 'cac', 'roas_pixel', 'custo_por_seguidor'] as const
const CRITERIOS_RANKING = ['gasto', 'compras', 'leads', 'seguidores', 'receita_pixel', 'roas_pixel', 'cliques', 'impressoes'] as const

function criarServidor() {
  const server = new McpServer({ name: 'dashboard-salto-para-o-dolar', version: '2.0.0' })

  server.tool(
    'get_resumo_periodo',
    'Resumo do desempenho nos últimos N dias com o funil completo separado por tipo de conversão: gasto, impressões, cliques, page views, compras, receita_pixel, leads, seguidores e custos derivados (CPL, CAC, custo/seguidor). Aceita filtro por corredor/objetivo. receita_pixel = só o que o pixel rastreia (receita oficial virá da Hubla).',
    {
      dias: z.number().int().min(1).max(365).default(30).describe('Quantidade de dias a analisar (padrão: 30)'),
      filtro_tag: filtroTagSchema,
    },
    async ({ dias, filtro_tag }: { dias: number; filtro_tag: string }) => {
      const resumo = await getResumoPeriodo(dias, filtro_tag)
      return { content: [{ type: 'text' as const, text: JSON.stringify(resumo, null, 2) }] }
    }
  )

  server.tool(
    'get_metricas_diarias',
    'Métricas dia a dia com conversões separadas por tipo (compras ≠ leads ≠ seguidores). Útil para padrões, tendências e dias anômalos. Aceita filtro por corredor/objetivo.',
    {
      dias: z.number().int().min(1).max(365).default(30).describe('Quantidade de dias'),
      filtro_tag: filtroTagSchema,
      metrica: z.enum(METRICAS_DIARIAS).default('todas').describe('Retornar só uma métrica específica'),
    },
    async ({ dias, filtro_tag, metrica }: { dias: number; filtro_tag: string; metrica: string }) => {
      const dados = await getMetricasDiarias(dias, filtro_tag)
      type Linha = (typeof dados)[number]
      const resultado = metrica === 'todas'
        ? dados
        : dados.map((d: Linha) => ({ data: d.data, [metrica]: (d as never)[metrica] }))
      return { content: [{ type: 'text' as const, text: JSON.stringify(resultado, null, 2) }] }
    }
  )

  server.tool(
    'get_campanhas',
    'Lista campanhas com funil completo separado (gasto, compras, leads, seguidores, page views, receita_pixel e custos derivados). Filtros por status, temperatura ([F]/[Q]) e corredor/objetivo.',
    {
      apenas_ativas: z.boolean().default(false).describe('Se true, retorna apenas campanhas ativas'),
      filtro_tag: filtroTagSchema,
      temperatura: z.enum(['todas', 'fundo', 'quente', 'neutro']).default('todas').describe('Filtrar por temperatura de audiência'),
      ordenar_por: z.enum(CRITERIOS_RANKING).default('gasto').describe('Campo para ordenação decrescente'),
      dias: z.number().int().min(1).max(365).default(30).describe('Período das métricas'),
    },
    async ({ apenas_ativas, filtro_tag, temperatura, ordenar_por, dias }: { apenas_ativas: boolean; filtro_tag: string; temperatura: string; ordenar_por: string; dias: number }) => {
      let campanhas = await getCampanhas(dias, filtro_tag)
      if (apenas_ativas) campanhas = campanhas.filter((c: { ativa: boolean }) => c.ativa)
      if (temperatura !== 'todas') campanhas = campanhas.filter((c: { temperatura: string }) => c.temperatura === temperatura)
      campanhas = campanhas.sort((a: Record<string, unknown>, b: Record<string, unknown>) => (Number(b[ordenar_por]) || 0) - (Number(a[ordenar_por]) || 0))

      const total = campanhas.reduce((s: number, c: { gasto: number }) => s + c.gasto, 0)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total_campanhas: campanhas.length,
            gasto_total: Math.round(total * 100) / 100,
            campanhas,
          }, null, 2),
        }],
      }
    }
  )

  server.tool(
    'get_top_campanhas',
    'Top N campanhas ativas pelo critério escolhido (padrão: gasto — sempre comparável; use compras/leads/seguidores conforme o corredor analisado).',
    {
      limite: z.number().int().min(1).max(12).default(5).describe('Quantidade de campanhas a retornar'),
      criterio: z.enum(CRITERIOS_RANKING).default('gasto').describe('Critério do ranking'),
      dias: z.number().int().min(1).max(365).default(30).describe('Período das métricas'),
    },
    async ({ limite, criterio, dias }: { limite: number; criterio: string; dias: number }) => {
      const top = await getTopCampanhas(limite, criterio, dias)
      return { content: [{ type: 'text' as const, text: JSON.stringify(top, null, 2) }] }
    }
  )

  server.tool(
    'get_criativos',
    'Lista criativos (nível anúncio) com funil separado por tipo de conversão. Sem vereditos automáticos — julgue pelo corredor: atração olha custo/seguidor, venda olha CAC.',
    {
      tipo: z.enum(['todos', 'vídeo', 'imagem', 'carrossel']).default('todos').describe('Filtrar por tipo de criativo'),
      dias: z.number().int().min(1).max(90).default(14).describe('Período das métricas'),
    },
    async ({ tipo, dias }: { tipo: string; dias: number }) => {
      const criativos = await getCriativos(dias, tipo)
      return { content: [{ type: 'text' as const, text: JSON.stringify({ total: criativos.length, criativos }, null, 2) }] }
    }
  )

  const METRICAS_TENDENCIA = ['gasto', 'impressoes', 'cliques', 'ctr', 'page_views', 'compras', 'receita_pixel', 'leads', 'seguidores', 'cpl', 'cac', 'roas_pixel', 'custo_por_seguidor']

  server.tool(
    'get_tendencia',
    'Compara a primeira metade do período com a segunda para identificar tendência de alta ou queda em cada métrica do funil. Aceita filtro por corredor/objetivo.',
    {
      dias: z.number().int().min(7).max(365).default(30).describe('Período total a analisar'),
      filtro_tag: filtroTagSchema,
    },
    async ({ dias, filtro_tag }: { dias: number; filtro_tag: string }) => {
      // Dia corrente fica fora: parcial (ainda rodando) puxaria a 2ª metade pra
      // baixo e quase toda consulta matinal apontaria "queda" falsa
      const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
      const todos = (await getMetricasDiarias(dias, filtro_tag)).filter((d: { data: string }) => d.data !== hoje)
      const metade = Math.floor(todos.length / 2)
      const primeira = todos.slice(0, metade)
      const segunda = todos.slice(metade)

      // Contagens/receita: zero é dado real (dia sem venda EXISTE) — entra na
      // média. Taxas/custos: zero = sem amostra — fica fora (média ficaria falsa).
      const CAMPOS_CONTAGEM = new Set(['gasto', 'impressoes', 'cliques', 'page_views', 'compras', 'receita_pixel', 'leads', 'seguidores'])
      const avg = (arr: Record<string, unknown>[], campo: string) => {
        const vals = arr.map(d => Number(d[campo])).filter(v => CAMPOS_CONTAGEM.has(campo) ? Number.isFinite(v) : v > 0)
        return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
      }
      const variacao = (ant: number, atual: number) => ant > 0 ? Math.round(((atual - ant) / ant) * 10000) / 100 : null

      const resultado: Record<string, unknown> = {}
      for (const m of METRICAS_TENDENCIA) {
        const ant = avg(primeira, m)
        const atual = avg(segunda, m)
        const v = variacao(ant, atual)
        resultado[m] = {
          primeira_metade: Math.round(ant * 100) / 100,
          segunda_metade: Math.round(atual * 100) / 100,
          variacao_pct: v,
          // v === null significa base zero: crescer de 0 → N é alta real
          // (antes aparecia como "estável"), e 0 → 0 é estável de fato
          tendencia: v === null
            ? (atual > 0 ? '↑ alta (sem base anterior)' : '→ estável')
            : v > 5 ? '↑ alta' : v < -5 ? '↓ queda' : '→ estável',
        }
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ periodo_dias: dias, filtro: filtro_tag, ...resultado }, null, 2) }] }
    }
  )

  return server
}

function autenticado(req: Request): boolean {
  const esperado = process.env.MCP_API_TOKEN
  if (!esperado) return false

  const auth = req.headers.get('authorization') ?? ''
  const tokenHeader = auth.replace(/^Bearer\s+/i, '').trim()
  if (tokenHeader === esperado) return true

  const url = new URL(req.url)
  const tokenQuery = url.searchParams.get('key') ?? url.searchParams.get('token')
  return tokenQuery === esperado
}

function naoAutorizado(): Response {
  return new Response(JSON.stringify({ error: 'unauthorized', message: 'Token Bearer ausente ou inválido.' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="dashboard-salto-para-o-dolar"' },
  })
}

async function handle(req: Request): Promise<Response> {
  if (!autenticado(req)) return naoAutorizado()

  const server = criarServidor()
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  return transport.handleRequest(req)
}

export async function GET(req: Request) { return handle(req) }
export async function POST(req: Request) { return handle(req) }
export async function DELETE(req: Request) { return handle(req) }
