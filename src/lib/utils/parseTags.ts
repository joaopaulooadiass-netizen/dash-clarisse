// Extrai todos os [TAGS] de um nome de campanha
export function extrairTags(nome: string): string[] {
  const matches = nome.match(/\[([^\]]+)\]/g) ?? []
  return matches.map(m => m.slice(1, -1).toUpperCase().trim())
}

// Categorias conhecidas — expandir quando João enviar o MD completo
const CATEGORIAS: Record<string, string> = {
  // Produto / Lançamento
  CPD: 'Produto', CCV: 'Produto', CAPTURA: 'Produto',
  WEBINAR: 'Produto', WCC: 'Produto', WCV: 'Produto',

  // Objetivo
  VENDAS: 'Objetivo', LEAD: 'Objetivo', LEADS: 'Objetivo',
  C1: 'Objetivo', TRAFEGO: 'Objetivo',

  // Temperatura / Audiência
  Q: 'Audiência', F: 'Audiência', BASE: 'Audiência',
  ESTADOS: 'Audiência',

  // Tipo de campanha
  LAUNCH: 'Tipo', IMPULSIONAR: 'Tipo', SITE: 'Tipo',
  'TESTES CRIATIVOS': 'Tipo', REMARKETING: 'Tipo',

  // Ambiente / Conta
  CPT: 'Conta',
}

export function categorizarTag(tag: string): string {
  return CATEGORIAS[tag] ?? 'Outros'
}

export type GrupoTags = Record<string, string[]>

export function agruparTags(todasTags: string[]): GrupoTags {
  const grupos: GrupoTags = {}
  for (const tag of todasTags) {
    const cat = categorizarTag(tag)
    if (!grupos[cat]) grupos[cat] = []
    if (!grupos[cat].includes(tag)) grupos[cat].push(tag)
  }
  return grupos
}

// Verifica se um nome de campanha passa pelo filtro (AND: todas as tags selecionadas devem estar presentes)
export function passaFiltro(nome: string, tagsSelecionadas: string[]): boolean {
  if (!tagsSelecionadas.length) return true
  const tags = extrairTags(nome)
  return tagsSelecionadas.every(t => tags.includes(t))
}
