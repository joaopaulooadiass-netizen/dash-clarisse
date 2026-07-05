export interface MetricasCampanhaDia {
  campanhaId: string
  data: string // YYYY-MM-DD
  gasto: number
  impressoes: number
  cliques: number
  conversoes: number
  receita: number
  seguidores: number // follow — o cache diário coleta; sem repassar, a coluna da Diária ficava '—' com dado real
  // calculados
  ctr: number
  cpl: number
  roas: number
  taxaConversao: number
}

export interface MetricasFunilDia {
  clienteId: string
  data: string // YYYY-MM-DD
  sessoes: number
  leads: number
  vendas: number
  receita: number
  // calculados
  taxaLeadSessao: number
  taxaVendaLead: number
  ticketMedio: number
}
