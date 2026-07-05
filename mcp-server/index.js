import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  getMetricasDiarias,
  getCampanhas,
  getResumoPeriodo,
  getTopCampanhas,
  getCriativos,
  FILTRO_TAGS,
} from './data.js'

// Conta multi-objetivo (venda, lead, atração, distribuição) — toda tool aceita
// filtro_tag para isolar um corredor pela convenção de nomes ([VENDAS], [C1]...).
// Sem metas/benchmarks fictícios: a IA julga cada corredor pela métrica própria.

const server = new McpServer({
  name: 'dashboard-copy-que-vende',
  version: '2.0.0',
})

const filtroTagSchema = z.enum(FILTRO_TAGS).default('todas')
  .describe('Filtra campanhas pela tag no nome: VENDAS, LEADS, CPT (objetivo) ou C1 atração / C2 distribuição / C3 quebra de objeção (corredor)')

const METRICAS_DIARIAS = ['todas', 'gasto', 'impressoes', 'cliques', 'ctr', 'cpc', 'cpm', 'page_views', 'compras', 'receita_pixel', 'leads', 'seguidores', 'cpl', 'cac', 'roas_pixel', 'custo_por_seguidor']
const CRITERIOS_RANKING = ['gasto', 'compras', 'leads', 'seguidores', 'receita_pixel', 'roas_pixel', 'cliques', 'impressoes']

// ─── Tool: resumo do período ──────────────────────────────────────────────────

server.tool(
  'get_resumo_periodo',
  'Resumo do desempenho nos últimos N dias com o funil completo separado por tipo de conversão: gasto, impressões, cliques, page views, compras, receita_pixel, leads, seguidores e custos derivados (CPL, CAC, custo/seguidor). Aceita filtro por corredor/objetivo. receita_pixel = só o que o pixel rastreia (receita oficial virá da Hubla).',
  {
    dias: z.number().int().min(1).max(365).default(30).describe('Quantidade de dias a analisar (padrão: 30)'),
    filtro_tag: filtroTagSchema,
  },
  async ({ dias, filtro_tag }) => {
    const resumo = await getResumoPeriodo(dias, filtro_tag)
    return { content: [{ type: 'text', text: JSON.stringify(resumo, null, 2) }] }
  }
)

// ─── Tool: métricas diárias ───────────────────────────────────────────────────

server.tool(
  'get_metricas_diarias',
  'Métricas dia a dia com conversões separadas por tipo (compras ≠ leads ≠ seguidores). Útil para padrões, tendências e dias anômalos. Aceita filtro por corredor/objetivo.',
  {
    dias: z.number().int().min(1).max(365).default(30).describe('Quantidade de dias'),
    filtro_tag: filtroTagSchema,
    metrica: z.enum(METRICAS_DIARIAS).default('todas').describe('Retornar só uma métrica específica'),
  },
  async ({ dias, filtro_tag, metrica }) => {
    const dados = await getMetricasDiarias(dias, filtro_tag)
    const resultado = metrica === 'todas' ? dados : dados.map(d => ({
      data: d.data,
      [metrica]: d[metrica],
    }))
    return { content: [{ type: 'text', text: JSON.stringify(resultado, null, 2) }] }
  }
)

// ─── Tool: campanhas ──────────────────────────────────────────────────────────

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
  async ({ apenas_ativas, filtro_tag, temperatura, ordenar_por, dias }) => {
    let campanhas = await getCampanhas(dias, filtro_tag)
    if (apenas_ativas) campanhas = campanhas.filter(c => c.ativa)
    if (temperatura !== 'todas') campanhas = campanhas.filter(c => c.temperatura === temperatura)
    campanhas = campanhas.sort((a, b) => (Number(b[ordenar_por]) || 0) - (Number(a[ordenar_por]) || 0))

    const total = campanhas.reduce((s, c) => s + c.gasto, 0)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          total_campanhas: campanhas.length,
          gasto_total: Math.round(total * 100) / 100,
          campanhas,
        }, null, 2),
      }],
    }
  }
)

// ─── Tool: top campanhas ──────────────────────────────────────────────────────

server.tool(
  'get_top_campanhas',
  'Top N campanhas ativas pelo critério escolhido (padrão: gasto — sempre comparável; use compras/leads/seguidores conforme o corredor analisado).',
  {
    limite: z.number().int().min(1).max(12).default(5).describe('Quantidade de campanhas a retornar'),
    criterio: z.enum(CRITERIOS_RANKING).default('gasto').describe('Critério do ranking'),
    dias: z.number().int().min(1).max(365).default(30).describe('Período das métricas'),
  },
  async ({ limite, criterio, dias }) => {
    const top = await getTopCampanhas(limite, criterio, dias)
    return { content: [{ type: 'text', text: JSON.stringify(top, null, 2) }] }
  }
)

// ─── Tool: criativos ─────────────────────────────────────────────────────────

server.tool(
  'get_criativos',
  'Lista criativos (nível anúncio) com funil separado por tipo de conversão. Sem vereditos automáticos — julgue pelo corredor: atração olha custo/seguidor, venda olha CAC.',
  {
    tipo: z.enum(['todos', 'vídeo', 'imagem', 'carrossel']).default('todos').describe('Filtrar por tipo de criativo'),
    dias: z.number().int().min(1).max(90).default(14).describe('Período das métricas'),
  },
  async ({ tipo, dias }) => {
    const criativos = await getCriativos(dias, tipo)
    return { content: [{ type: 'text', text: JSON.stringify({ total: criativos.length, criativos }, null, 2) }] }
  }
)

// ─── Tool: análise de tendência ───────────────────────────────────────────────

const METRICAS_TENDENCIA = ['gasto', 'impressoes', 'cliques', 'ctr', 'page_views', 'compras', 'receita_pixel', 'leads', 'seguidores', 'cpl', 'cac', 'roas_pixel', 'custo_por_seguidor']

server.tool(
  'get_tendencia',
  'Compara a primeira metade do período com a segunda para identificar tendência de alta ou queda em cada métrica do funil. Aceita filtro por corredor/objetivo.',
  {
    dias: z.number().int().min(7).max(365).default(30).describe('Período total a analisar'),
    filtro_tag: filtroTagSchema,
  },
  async ({ dias, filtro_tag }) => {
    const todos = await getMetricasDiarias(dias, filtro_tag)
    const metade = Math.floor(todos.length / 2)
    const primeira = todos.slice(0, metade)
    const segunda = todos.slice(metade)

    const avg = (arr, campo) => {
      const vals = arr.map(d => Number(d[campo])).filter(v => v > 0)
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
    }
    const variacao = (ant, atual) => ant > 0 ? Math.round(((atual - ant) / ant) * 10000) / 100 : null

    const resultado = {}
    for (const m of METRICAS_TENDENCIA) {
      const ant = avg(primeira, m)
      const atual = avg(segunda, m)
      const v = variacao(ant, atual)
      resultado[m] = {
        primeira_metade: Math.round(ant * 100) / 100,
        segunda_metade: Math.round(atual * 100) / 100,
        variacao_pct: v,
        tendencia: (v ?? 0) > 5 ? '↑ alta' : (v ?? 0) < -5 ? '↓ queda' : '→ estável',
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify({ periodo_dias: dias, filtro: filtro_tag, ...resultado }, null, 2) }] }
  }
)

// ─── Iniciar servidor ─────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
