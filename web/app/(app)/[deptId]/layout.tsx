import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { fetchUserDepartments, fetchUserProfile } from '@/lib/db'
import AppShell from '@/components/AppShell'
import type { UserRole } from '@/lib/types'

export default async function DeptLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { deptId: string }
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const profile = await fetchUserProfile(user.email!)
  // Defence in depth. The parent layout already ejects accounts with no profile, but
  // this must not fall back to 'manager' — defaulting a stranger to a real role is
  // exactly how unintended access happens.
  if (!profile) redirect('/auth/signout?reason=not_invited')

  const userRole: UserRole = profile.role
  const isAdmin = userRole === 'admin' || userRole === 'superadmin'

  if (!isAdmin) {
    const userDepts = await fetchUserDepartments(user.email!)
    if (!userDepts.some((d) => d.id === params.deptId)) {
      redirect('/')
    }
  }

  return (
    <AppShell user={user} activeDeptId={params.deptId} userRole={userRole}>
      {children}
    </AppShell>
  )
}
