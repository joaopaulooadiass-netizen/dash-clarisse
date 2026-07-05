import { AnaliseCriativos } from './AnaliseCriativos'
import { getCriativosComMetricas } from '@/lib/meta/criativos'

export const dynamic = 'force-dynamic'

import { hoje, subDias } from '@/lib/utils/data'

export default async function CriativoPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>
}) {
  const params = await searchParams
  const de = params.de ?? subDias(13)
  const ate = params.ate ?? hoje()

  // Rate limit do Meta não pode derrubar a tela — degrada para vazio
  const dados = await getCriativosComMetricas(de, ate).catch(e => {
    console.error('[criativo] fetch falhou:', (e as Error).message)
    return []
  })

  return (
    <AnaliseCriativos
      criativos={dados.map(d => d.criativo)}
      metricasReais={dados.map(d => d.metricas)}
      de={de}
      ate={ate}
    />
  )
}
