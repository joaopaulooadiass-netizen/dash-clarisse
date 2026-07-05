import { getCampanhasComMetricas } from '@/lib/meta/campanhas'
import { getPublicosComMetricas, getAnunciosComMetricas } from '@/lib/meta/publicos'
import { AnalisePublicos } from './AnalisePublicos'

export const dynamic = 'force-dynamic'

import { hoje, subDias } from '@/lib/utils/data'

// Não deixa o rate limit do Meta (ou erro em um fetch) derrubar a tela inteira:
// cada bloco que falhar volta vazio e o resto da tela renderiza normalmente.
async function ouVazio<T>(p: Promise<T[]>): Promise<T[]> {
  try { return await p } catch (e) {
    console.error('[publicos] fetch falhou:', (e as Error).message)
    return []
  }
}

export default async function PublicosPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>
}) {
  const params = await searchParams
  const de  = params.de  ?? subDias(13)
  const ate = params.ate ?? hoje()

  const [campanhas, publicos, anuncios] = await Promise.all([
    ouVazio(getCampanhasComMetricas(de, ate)),
    ouVazio(getPublicosComMetricas(de, ate)),
    ouVazio(getAnunciosComMetricas(de, ate)),
  ])

  return (
    <AnalisePublicos
      campanhas={campanhas}
      publicos={publicos}
      anuncios={anuncios}
      de={de}
      ate={ate}
    />
  )
}
