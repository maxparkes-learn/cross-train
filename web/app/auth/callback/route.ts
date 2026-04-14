import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

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
        return NextResponse.redirect(
          `${origin}/auth/login?error=unauthorized_domain`,
        )
      }

      return NextResponse.redirect(`${origin}/matrix`)
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
}
