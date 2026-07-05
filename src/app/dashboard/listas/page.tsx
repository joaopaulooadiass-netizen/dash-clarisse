import { AnaliseListas } from './AnaliseListas'
import { getListaMetaAdsInicial } from '@/lib/meta/listas'

export const dynamic = 'force-dynamic'

export default async function ListasPage() {
  const listaMetaAds = await getListaMetaAdsInicial()

  return <AnaliseListas listasIniciais={[listaMetaAds]} />
}
