import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// TODO: substituir por auth guard com @supabase/ssr quando o Auth entrar
// Referência: https://supabase.com/docs/guides/auth/server-side/nextjs
export function middleware(_request: NextRequest) {
  return NextResponse.next()
}
