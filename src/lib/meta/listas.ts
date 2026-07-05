import { getDadosPorCampanha } from './tendencias'

import { hoje, subDias } from '@/lib/utils/data'

export interface ListaMetaAdsInicial {
  id: string
  nome: string
  tipo: 'meta_ads'
  headers: string[]
  rows: Record<string, string>[]
  campoJoin: string | null
  mapeamento: {
    campanha: string
    resultado: string
    gasto: string
  }
}

export async function getListaMetaAdsInicial(): Promise<ListaMetaAdsInicial> {
  const dados = await getDadosPorCampanha(subDias(89), hoje())

  const rows = dados.map(d => ({
    Data: d.data,
    'Nome da campanha': d.campanhaNome,
    Resultados: String(d.compras),
    'Valor usado (BRL)': d.investimento.toFixed(2),
    Impressões: String(d.impressoes),
    Cliques: String(d.cliques),
    CTR: d.ctr.toFixed(2),
    CPM: d.cpm.toFixed(2),
    ROAS: d.roas.toFixed(2),
    Receita: d.valorGerado.toFixed(2),
    Objetivo: d.objetivo,
    Temperatura: d.temperatura,
  }))

  return {
    id: 'meta-ads-real',
    nome: 'Meta Ads - campanhas 90d',
    tipo: 'meta_ads',
    headers: [
      'Data',
      'Nome da campanha',
      'Resultados',
      'Valor usado (BRL)',
      'Impressões',
      'Cliques',
      'CTR',
      'CPM',
      'ROAS',
      'Receita',
      'Objetivo',
      'Temperatura',
    ],
    rows,
    campoJoin: 'Nome da campanha',
    mapeamento: {
      campanha: 'Nome da campanha',
      resultado: 'Resultados',
      gasto: 'Valor usado (BRL)',
    },
  }
}
