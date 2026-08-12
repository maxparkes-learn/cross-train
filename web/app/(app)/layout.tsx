import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { syncSignedInUser } from '@/lib/db'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email!.split('@')[0]

  // Invite-only: an account with no profile is ejected rather than silently granted
  // the manager role. Routed through /auth/signout because middleware bounces any
  // signed-in user off /auth/login, which would otherwise loop forever.
  const profile = await syncSignedInUser(user.email!, displayName)
  if (!profile) redirect('/auth/signout?reason=not_invited')

  return <>{children}</>
}
