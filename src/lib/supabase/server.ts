import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL não definido')
if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY não definido')

// Cliente com service_role — só para uso server-side (API routes, cron job).
// Nunca expor ao navegador: bypassa RLS.
export const supabaseServer = createClient(url, key, {
  auth: { persistSession: false },
})
