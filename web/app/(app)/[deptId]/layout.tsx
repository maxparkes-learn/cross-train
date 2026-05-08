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
  const userRole: UserRole = profile?.role ?? 'manager'
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
