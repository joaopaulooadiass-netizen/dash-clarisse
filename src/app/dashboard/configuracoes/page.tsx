import { TelaConfiguracoes } from './TelaConfiguracoes'

export const metadata = { title: 'Configurações — Dashboard Salto para o Dólar' }

export default function Page() {
  // Conta real do env (server-side) — o ID da conta não é segredo (aparece em
  // URLs do Gerenciador); o que jamais desce ao cliente é o ACCESS_TOKEN.
  const raw = process.env.META_AD_ACCOUNT_ID
  const contaId = raw ? (raw.startsWith('act_') ? raw : `act_${raw}`) : undefined
  return <TelaConfiguracoes contaId={contaId} />
}
