import { getCampanhasComMetricas, getEstruturaCampanhas, getCampanhaMetricasDiarias } from '@/lib/meta/campanhas'
import { VisaoGeral } from './VisaoGeral'

export const dynamic = 'force-dynamic'

import { hoje, subDias, difDias } from '@/lib/utils/data'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>
}) {
  const params = await searchParams
  const de = params.de ?? subDias(6)
  const ate = params.ate ?? hoje()

  // Período anterior (mesma duração, imediatamente antes) — buscado junto para
  // permitir comparação sem refetch, fatiado no cliente como já era feito antes.
  // deAnt = de - dias ⇒ janela [deAnt, de-1] tem exatamente `dias` dias (mesma
  // fórmula do cliente em VisaoGeral.tsx — manter os dois em sincronia).
  const dias  = difDias(de, ate) + 1
  const deAnt = subDias(dias, de)

  // Rate limit / falha do Meta não pode derrubar a tela — cada bloco degrada
  // sozinho, MAS a tela precisa saber: sem a flag, KPIs zerados de fetch falho
  // apareciam idênticos a "conta sem gasto" (estrutura falha fica de fora — a
  // tela funciona sem ela, só sem colunas de conjuntos/anúncios).
  let metaFalhou = false
  const log = (tag: string, marca: boolean) => (e: unknown) => {
    console.error(`[dashboard] ${tag} falhou:`, (e as Error).message)
    if (marca) metaFalhou = true
    return undefined
  }
  const [campanhas, estrutura, metricasDiarias] = await Promise.all([
    getCampanhasComMetricas(de, ate).catch(log('campanhas', true)),
    getEstruturaCampanhas().catch(log('estrutura', false)),
    getCampanhaMetricasDiarias(deAnt, ate).catch(log('metricasDiarias', true)),
  ])

  return (
    <VisaoGeral
      campanhas={campanhas ?? []}
      estrutura={estrutura ?? {}}
      metricasDiarias={metricasDiarias ?? []}
      metaFalhou={metaFalhou}
      de={de}
      ate={ate}
    />
  )
}
