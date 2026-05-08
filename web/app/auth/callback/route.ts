import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(
      `${origin}/auth/login?error=auth_failed&detail=${encodeURIComponent(error.message)}`
    )
  }

  return redirectTo
}
