import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin

  // Collect cookies Supabase wants to set (PKCE code verifier)
  const pendingCookies: { name: string; value: string; options: Record<string, unknown> }[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          pendingCookies.push(
            ...cookies.map(({ name, value, options }) => ({
              name,
              value,
              options: (options ?? {}) as Record<string, unknown>,
            })),
          )
        },
      },
    },
  )

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${origin}/auth/callback`,
      queryParams: {
        access_type: 'offline',
        prompt: 'select_account',
      },
    },
  })

  if (error || !data.url) {
    return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
  }

  // Redirect to Google with the PKCE verifier cookie attached
  const response = NextResponse.redirect(data.url)
  pendingCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2])
  })

  return response
}
