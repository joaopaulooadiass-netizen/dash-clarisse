import { getPlacementsDiarios } from '@/lib/meta/publicos'
import { getCampanhasAtivas } from '@/lib/meta/campanhas'
import { AnalisePosicionamento } from './AnalisePosicionamento'

export const dynamic = 'force-dynamic'

import { hoje, subDias } from '@/lib/utils/data'

export default async function PosicionamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>
}) {
  const params = await searchParams
  const de  = params.de  ?? subDias(29)
  const ate = params.ate ?? hoje()

  // Mapa de status alimenta o checkbox "Campanha ativa" — cada fetch degrada sozinho
  const log = (tag: string) => (e: unknown) => { console.error(`[posicionamento] ${tag} falhou:`, (e as Error).message) }
  const [placements, ativas] = await Promise.all([
    getPlacementsDiarios(de, ate).catch(e => { log('placements')(e); return [] }),
    getCampanhasAtivas().catch(e => { log('status')(e); return {} }),
  ])

  return <AnalisePosicionamento placements={placements} campanhasAtivas={ativas} de={de} ate={ate} />
}
