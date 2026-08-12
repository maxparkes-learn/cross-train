import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { syncSignedInUser, recordSignIn } from '@/lib/db'

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

  const email = data.user?.email
  if (!email) {
    return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
  }

  const displayName =
    (data.user?.user_metadata?.full_name as string | undefined) ?? email.split('@')[0]

  // Invite-only gate. Rejecting here rather than only in the layout means a stranger
  // never holds a usable session at all. This route sits outside the middleware
  // matcher, so it can redirect to the login page directly once the session is cleared.
  const profile = await syncSignedInUser(email, displayName)
  if (!profile) {
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/auth/login?error=not_invited`)
  }

  // The only place a real authentication is observable — a persisted session goes
  // straight to the app without passing through here. Tracking must never block a
  // legitimate sign-in, so failures are swallowed and logged.
  try {
    await recordSignIn(email)
  } catch (err) {
    console.error('sign-in tracking failed', err)
  }

  return redirectTo
}
