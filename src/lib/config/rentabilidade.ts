export interface TransacaoGateway {
  id: string
  data: string
  valor: number
  status: 'aprovado' | 'reembolso' | 'chargeback' | 'pendente'
  produto: string
  utm_source: string
  utm_medium: string
  utm_campaign: string
  utm_content: string
  utm_term: string
  // Valor que sobra após as taxas do gateway (vem do CSV/webhook da Hubla).
  // Quando presente, a tela usa a taxa REAL (valor - valorLiquido) em vez da estimada.
  valorLiquido?: number
}

export interface CustoFixo {
  id: string
  nome: string
  valor: number
}

export interface ConfigRentabilidade {
  cmvPct: number          // % do custo do produto sobre receita líquida
  taxaGatewayPct: number  // % da Hubla por venda
  taxaGatewayFixa: number // R$ fixo da Hubla por venda (processamento)
  custosFixos: CustoFixo[]
}

// Configuração inicial da tela de Faturamento — o usuário edita na própria tela
// (edições persistem em localStorage). Custos fixos e CMV começam zerados de
// propósito: são dados do negócio do Gabriel, não podem ser inventados.
// Taxas da Hubla: condições REAIS da conta do Gabriel (painel Hubla, 2026-06-12):
// 4,90% + R$ 2,49 por venda aprovada. Usadas só como estimativa — vendas vindas
// do CSV/webhook trazem o valor líquido real e dispensam a estimativa.
export function getConfigPadrao(): ConfigRentabilidade {
  return {
    cmvPct: 0,
    taxaGatewayPct: 4.9,
    taxaGatewayFixa: 2.49,
    custosFixos: [],
  }
}
