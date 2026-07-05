import { getConfigPadrao } from '@/lib/config/rentabilidade'
import { getMetricasDiarias } from '@/lib/meta/insights'
import { TelaFaturamento } from './TelaFaturamento'

export const dynamic = 'force-dynamic'

import { hoje, subDias } from '@/lib/utils/data'

export default async function FaturamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>
}) {
  // Período vem da URL (o SeletorPeriodo da tela faz router.push) — antes o
  // tráfego da Meta vinha em janela fixa de 90d e período mais antigo ficava sem dado
  const params = await searchParams
  const de  = params.de  ?? subDias(29)
  const ate = params.ate ?? hoje()

  // Rate limit / falha do Meta não derruba a tela — degrada para vazio, MAS a
  // tela precisa saber que falhou: sem a flag, "Investimento Ads R$ 0,00" entrava
  // na cascata como dado real e o Lucro Líquido saía inflado pelo gasto de ads.
  // Só buscamos o investimento real (gasto de ads). As VENDAS vêm exclusivamente
  // do CSV/webhook da Hubla (importado no cliente) — nunca estimadas do pixel,
  // pra não fabricar transação que não existe.
  let metaFalhou = false
  const metricas = await getMetricasDiarias(de, ate).catch((e: unknown) => {
    console.error('[faturamento] metricas falhou:', (e as Error).message)
    metaFalhou = true
    return []
  })

  return <TelaFaturamento metricas={metricas} metaFalhou={metaFalhou} configInicial={getConfigPadrao()} de={de} ate={ate} />
}
