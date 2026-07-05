import { TelaTendencias } from './TelaTendencias'
import { getDadosPorCampanha, getGeoRegioesPorCampanha, getGeoPaisesPorCampanha } from '@/lib/meta/tendencias'
import { getCampanhasAtivas } from '@/lib/meta/campanhas'

export const dynamic = 'force-dynamic'

import { hoje, subDias } from '@/lib/utils/data'

export default async function TendenciasPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>
}) {
  // Período vem da URL (o SeletorPeriodo da tela faz router.push) — antes a
  // página buscava janela fixa e o seletor não tinha efeito real nos dados.
  const params = await searchParams
  const de  = params.de  ?? subDias(29)
  const ate = params.ate ?? hoje()

  // Rate limit/falha do Meta não derruba a tela — cada bloco degrada para vazio
  // e a tela mostra o estado "sem dados" (nunca dados inventados).
  const log = (tag: string) => (e: unknown) => { console.error(`[tendencias] ${tag} falhou:`, (e as Error).message) }
  const [dadosCampanha, geoRegioes, geoPaises, ativas] = await Promise.all([
    getDadosPorCampanha(de, ate).catch(e => { log('campanhas')(e); return [] }),
    getGeoRegioesPorCampanha(de, ate).catch(e => { log('regioes')(e); return [] }),
    getGeoPaisesPorCampanha(de, ate).catch(e => { log('paises')(e); return [] }),
    getCampanhasAtivas().catch(e => { log('status')(e); return {} }),
  ])

  return (
    <TelaTendencias
      dadosCampanha={dadosCampanha}
      geoRegioes={geoRegioes}
      geoPaises={geoPaises}
      campanhasAtivas={ativas}
      de={de}
      ate={ate}
    />
  )
}
