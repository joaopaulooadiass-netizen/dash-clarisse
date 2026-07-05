import type { QuadranteCriativo } from '@/lib/types'

// ─── Classificação relativa à média ──────────────────────────────────────────
// Em vez de metas absolutas inventadas (ex.: ROAS 3,5x = "estrela"), cada item é
// julgado contra a MÉDIA do próprio conjunto. Assim a régua se adapta à conta:
// numa conta de atração (ROAS ~0) o que importa é quem está acima da média de
// CTR — não quem bate um número de e-commerce que não se aplica ao negócio.

// Impressões mínimas pra um item ter CTR confiável o bastante pra ser julgado.
export const MIN_IMPRESSOES_AMOSTRA = 500

// 'novo' = sem amostra suficiente pra julgar (falta de dado, não é demérito).
export function classificarPorMedia(valor: number, media: number, temAmostra: boolean): QuadranteCriativo {
  if (!temAmostra) return 'novo'
  return valor >= media ? 'acima' : 'abaixo'
}

// CTR de referência do conjunto: média ponderada por impressões (= CTR agregado),
// contando só itens com amostra mínima pra ruído não distorcer a régua.
export function ctrMedioPonderado(
  itens: { ctr: number; impressoes: number }[],
  minImpressoes = MIN_IMPRESSOES_AMOSTRA,
): number {
  let somaImp = 0
  let somaPond = 0
  for (const it of itens) {
    if (it.impressoes < minImpressoes) continue
    somaImp += it.impressoes
    somaPond += it.ctr * it.impressoes
  }
  return somaImp > 0 ? somaPond / somaImp : 0
}

// Média simples de uma métrica, ignorando zeros (quem não tem o dado não conta).
export function mediaSimples(valores: number[]): number {
  const xs = valores.filter(v => v > 0)
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0
}

// Cor de célula relativa à média do conjunto: acima = verde, abaixo = neutro,
// sem dado (zero) ou sem referência = neutro. inverso=true p/ métricas onde
// MENOR é melhor (CAC, CPA, CPV...).
export function corVsMedia(valor: number, media: number, inverso = false): string {
  if (valor <= 0 || media <= 0) return 'var(--color-text-secondary)'
  const bom = inverso ? valor <= media : valor >= media
  return bom ? 'var(--color-signal-green)' : 'var(--color-text-muted)'
}
