import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { fetchDepartments, fetchUserDepartments, fetchUserProfile } from '@/lib/db'

export default async function RootPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const profile = await fetchUserProfile(user.email!)
  const isAdmin = profile?.role === 'admin' || profile?.role === 'superadmin'
  const depts = isAdmin
    ? await fetchDepartments()
    : await fetchUserDepartments(user.email!)

  if (depts.length > 0) {
    redirect(`/${depts[0].id}/matrix`)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 w-full max-w-md text-center">
        <div className="mb-3 text-4xl">🏭</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">
          {isAdmin ? 'No Departments Yet' : 'Waiting for Access'}
        </h1>
        <p className="text-sm text-gray-500">
          {isAdmin
            ? 'Create your first department from the sidebar to get started.'
            : 'Your account is pending department access. Please contact the admin.'}
        </p>
      </div>
    </div>
  )
}
