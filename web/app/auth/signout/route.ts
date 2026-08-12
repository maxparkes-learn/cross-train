import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Signs the current user out and returns them to the login page.
 *
 * This exists because access is invite-only: a signed-in account with no profile has
 * to be ejected, and redirecting it straight to /auth/login would loop forever —
 * middleware bounces any signed-in user off /auth/* back to /, which rejects them
 * again. Clearing the session first breaks that cycle.
 *
 * Must stay excluded from the middleware matcher, like /auth/callback.
 */
export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin
  const reason = new URL(request.url).searchParams.get('reason')

  const redirectTo = NextResponse.redirect(
    reason ? `${origin}/auth/login?error=${encodeURIComponent(reason)}` : `${origin}/auth/login`,
  )

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
    },
  )

  await supabase.auth.signOut()

  return redirectTo
}
