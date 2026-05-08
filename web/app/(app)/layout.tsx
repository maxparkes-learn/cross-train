import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { upsertUserProfile } from '@/lib/db'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email!.split('@')[0]
  await upsertUserProfile(user.email!, displayName)

  return <>{children}</>
}
