'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Station, Employee, AppSettings, Department, UserRole } from '@/lib/types'
import {
  DEFAULT_SKILL_LABELS,
  DEFAULT_CERT_LABELS,
  DEFAULT_COMPETENCY_COLORS,
} from '@/lib/types'
import {
  fetchStations,
  fetchEmployees,
  fetchSettings,
  fetchDepartments,
  fetchUserDepartments,
} from '@/lib/db'
import { createClient } from '@/lib/supabase/client'
import { useRouter, usePathname } from 'next/navigation'
import Sidebar from './Sidebar'

interface AppContextValue {
  stations: Station[]
  employees: Employee[]
  settings: AppSettings
  isLoading: boolean
  refreshData: () => Promise<void>
  refreshStations: () => Promise<void>
  refreshEmployees: () => Promise<void>
  refreshDepartments: () => Promise<void>
  updateSettings: (next: AppSettings) => void
  user: User
  userRole: UserRole
  departments: Department[]
  activeDepartment: Department | null
}

const AppContext = createContext<AppContextValue | null>(null)

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppShell')
  return ctx
}

export default function AppShell({
  user,
  activeDeptId,
  userRole,
  children,
}: {
  user: User
  activeDeptId: string
  userRole: UserRole
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()

  const [stations, setStations] = useState<Station[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [settings, setSettings] = useState<AppSettings>({
    skillLabels: { ...DEFAULT_SKILL_LABELS },
    certLabels: { ...DEFAULT_CERT_LABELS },
    competencyColors: { ...DEFAULT_COMPETENCY_COLORS },
  })
  const [departments, setDepartments] = useState<Department[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('sidebar-collapsed')
    if (stored === 'true') setSidebarCollapsed(true)
  }, [])

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('sidebar-collapsed', String(next))
      return next
    })
  }, [])

  const isAdmin = userRole === 'admin' || userRole === 'superadmin'
  const activeDepartment = departments.find((d) => d.id === activeDeptId) ?? null

  const refreshDepartments = useCallback(async () => {
    const data = isAdmin
      ? await fetchDepartments()
      : await fetchUserDepartments(user.email!)
    setDepartments(data)
  }, [isAdmin, user.email])

  const refreshStations = useCallback(async () => {
    const data = await fetchStations(activeDeptId)
    setStations(data)
  }, [activeDeptId])

  const refreshEmployees = useCallback(async () => {
    const data = await fetchEmployees(activeDeptId)
    setEmployees(data)
  }, [activeDeptId])

  const refreshData = useCallback(async () => {
    setIsLoading(true)
    const [s, e, cfg, depts] = await Promise.all([
      fetchStations(activeDeptId),
      fetchEmployees(activeDeptId),
      fetchSettings(activeDeptId),
      isAdmin ? fetchDepartments() : fetchUserDepartments(user.email!),
    ])
    setStations(s)
    setEmployees(e)
    setSettings(cfg)
    setDepartments(depts)
    setIsLoading(false)
  }, [activeDeptId, isAdmin, user.email])

  useEffect(() => {
    refreshData()
  }, [refreshData])

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const navItems = [
    { href: `/${activeDeptId}/matrix`, label: 'Cross-Training Matrix', icon: '⊞' },
    { href: `/${activeDeptId}/schedule`, label: 'Schedule', icon: '📋' },
    { href: `/${activeDeptId}/rotation`, label: 'Rotation Dashboard', icon: '📊' },
    ...(isAdmin ? [{ href: `/${activeDeptId}/activity`, label: 'Activity Log', icon: '🕐' }] : []),
    ...(isAdmin ? [{ href: `/${activeDeptId}/users`, label: 'Users', icon: '👥' }] : []),
    ...(isAdmin ? [{ href: `/${activeDeptId}/employees`, label: 'Employees', icon: '👤' }] : []),
  ]

  const activeLabel = navItems.find((n) => pathname.startsWith(n.href))?.label ?? 'Rotation & Safety'

  return (
    <AppContext.Provider
      value={{
        stations,
        employees,
        settings,
        isLoading,
        refreshData,
        refreshStations,
        refreshEmployees,
        refreshDepartments,
        updateSettings: setSettings,
        user,
        userRole,
        departments,
        activeDepartment,
      }}
    >
      <div className="flex h-screen overflow-hidden bg-gray-50">
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-20 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside
          className={`fixed lg:static inset-y-0 left-0 z-30 bg-gray-900 text-white flex flex-col transform transition-all duration-200 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          } ${sidebarCollapsed && !sidebarOpen ? 'lg:w-14' : 'w-72'}`}
        >
          <Sidebar
            navItems={navItems}
            pathname={pathname}
            stations={stations}
            settings={settings}
            user={user}
            userRole={userRole}
            departments={departments}
            activeDepartment={activeDepartment}
            activeDeptId={activeDeptId}
            onSignOut={handleSignOut}
            onStationsChange={refreshStations}
            onSettingsChange={setSettings}
            onDepartmentsChange={refreshDepartments}
            collapsed={sidebarCollapsed && !sidebarOpen}
            onToggleCollapsed={toggleSidebarCollapsed}
          />
        </aside>

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1 rounded text-gray-600 hover:text-gray-900"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="font-semibold text-gray-900 text-sm">{activeLabel}</span>
          </div>

          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </AppContext.Provider>
  )
}
