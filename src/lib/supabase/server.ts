import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cliente: SupabaseClient | null | undefined

// Cliente com service_role — só para uso server-side (API routes, cron job).
// Nunca expor ao navegador: bypassa RLS.
//
// O Supabase é OPCIONAL: sem as envs, retorna null e o dashboard busca tudo
// direto da API da Meta (sem cache). Lazy de propósito — instanciar no load
// do módulo derrubava o build na Vercel quando as envs não existiam.
export function getSupabaseServer(): SupabaseClient | null {
  if (cliente !== undefined) return cliente
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  cliente = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null
  return cliente
}

export function supabaseConfigurado(): boolean {
  return getSupabaseServer() !== null
}
