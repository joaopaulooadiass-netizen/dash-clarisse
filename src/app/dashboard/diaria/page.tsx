import { getCampanhaMetricasDiarias, getCampanhasAtivas } from '@/lib/meta/campanhas'
import { TabelaDiaria } from './TabelaDiaria'

export const dynamic = 'force-dynamic'

import { hoje, subDias } from '@/lib/utils/data'

export default async function DashboardDiariaPage() {
  // Dados por campanha/dia — a tabela filtra as campanhas (filtro inteligente)
  // e re-agrega para a visão da conta inteira. O mapa de status alimenta o
  // checkbox "Campanha ativa"; cada fetch degrada sozinho.
  // Janela de 90 dias: série diária por campanha em 365d gerava dezenas de
  // chamadas e estourava o rate limit da Meta (conta em development_access).
  const log = (tag: string) => (e: unknown) => { console.error(`[diaria] ${tag} falhou:`, (e as Error).message) }
  // Flag de falha: tabela vazia por rate limit não pode parecer "conta sem veiculação"
  let metaFalhou = false
  const [dados, ativas] = await Promise.all([
    getCampanhaMetricasDiarias(subDias(89), hoje()).catch(e => { log('dados')(e); metaFalhou = true; return [] }),
    getCampanhasAtivas().catch(e => { log('status')(e); return {} }),
  ])

  return <TabelaDiaria dados={dados} campanhasAtivas={ativas} metaFalhou={metaFalhou} />
}
