import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { upsertUserProfile, recordSignIn } from '@/lib/db'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const origin = requestUrl.origin

  if (!code) {
    return NextResponse.redirect(
      `${origin}/auth/login?error=auth_failed&detail=${encodeURIComponent('No code in callback URL')}`
    )
  }

  const redirectTo = NextResponse.redirect(`${origin}/`)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: Record<string, unknown>) {
          redirectTo.cookies.set(name, value, options as never)
        },
        remove(name: string, options: Record<string, unknown>) {
          redirectTo.cookies.set(name, '', options as never)
        },
      },
    }
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(
      `${origin}/auth/login?error=auth_failed&detail=${encodeURIComponent(error.message)}`
    )
  }

  // This is the only place a real authentication is observable — a persisted session
  // goes straight to the app without passing through here. Never allowed to block
  // sign-in: recordSignIn swallows its own failures, and the upsert is guarded so a
  // tracking problem cannot lock someone out of the app.
  const email = data.user?.email
  if (email) {
    try {
      const displayName =
        (data.user?.user_metadata?.full_name as string | undefined) ?? email.split('@')[0]
      // Guarantees the profile row exists before recordSignIn updates it, which
      // matters on a brand-new user's very first sign-in.
      await upsertUserProfile(email, displayName)
      await recordSignIn(email)
    } catch (err) {
      console.error('sign-in tracking failed', err)
    }
  }

  return redirectTo
}
