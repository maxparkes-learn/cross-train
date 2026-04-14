import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const errorParam = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  // Supabase/Google sent back an error directly
  if (errorParam) {
    const msg = encodeURIComponent(errorDescription ?? errorParam)
    return NextResponse.redirect(`${origin}/auth/login?error=auth_failed&detail=${msg}`)
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      const allowedDomain = process.env.NEXT_PUBLIC_ALLOWED_DOMAIN ?? 'clutch.ca'
      if (!user?.email?.toLowerCase().endsWith(`@${allowedDomain}`)) {
        await supabase.auth.signOut()
        return NextResponse.redirect(`${origin}/auth/login?error=unauthorized_domain`)
      }

      return NextResponse.redirect(`${origin}/matrix`)
    }

    const msg = encodeURIComponent(error.message)
    return NextResponse.redirect(`${origin}/auth/login?error=auth_failed&detail=${msg}`)
  }

  return NextResponse.redirect(`${origin}/auth/login?error=auth_failed&detail=no_code`)
}
