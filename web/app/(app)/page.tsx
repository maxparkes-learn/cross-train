import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { fetchDepartments, fetchUserDepartments, fetchUserProfile } from '@/lib/db'

async function signOut() {
  'use server'
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/auth/login')
}

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
            ? 'Create your first department from the account menu in the header to get started.'
            : 'Your account is pending department access. Contact max.parkes@clutch.ca to be added.'}
        </p>
        {!isAdmin && (
          <form action={signOut} className="mt-6">
            <button
              type="submit"
              className="text-xs text-gray-400 hover:text-gray-600 underline transition-colors"
            >
              Sign out
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
