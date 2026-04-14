'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Station, Employee, AppSettings } from '@/lib/types'
import {
  DEFAULT_SKILL_LABELS,
  DEFAULT_CERT_LABELS,
  DEFAULT_COMPETENCY_COLORS,
  ADMIN_EMAIL,
} from '@/lib/types'
import { fetchStations, fetchEmployees, fetchSettings } from '@/lib/db'
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
  updateSettings: (next: AppSettings) => void
  user: User
}

const AppContext = createContext<AppContextValue | null>(null)

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppShell')
  return ctx
}

export default function AppShell({
  user,
  children,
}: {
  user: User
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
  const [isLoading, setIsLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const refreshStations = useCallback(async () => {
    const data = await fetchStations()
    setStations(data)
  }, [])

  const refreshEmployees = useCallback(async () => {
    const data = await fetchEmployees()
    setEmployees(data)
  }, [])

  const refreshData = useCallback(async () => {
    setIsLoading(true)
    const [s, e, cfg] = await Promise.all([fetchStations(), fetchEmployees(), fetchSettings()])
    setStations(s)
    setEmployees(e)
    setSettings(cfg)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    refreshData()
  }, [refreshData])

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const isAdmin = user.email === ADMIN_EMAIL

  const navItems = [
    { href: '/matrix', label: 'Cross-Training Matrix', icon: '⊞' },
    { href: '/schedule', label: 'Schedule', icon: '📋' },
    { href: '/rotation', label: 'Rotation Dashboard', icon: '📊' },
    ...(isAdmin ? [{ href: '/activity', label: 'Activity Log', icon: '🕐' }] : []),
  ]

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
        updateSettings: setSettings,
        user,
      }}
    >
      <div className="flex h-screen overflow-hidden bg-gray-50">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-20 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`fixed lg:static inset-y-0 left-0 z-30 w-72 bg-gray-900 text-white flex flex-col transform transition-transform duration-200 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          }`}
        >
          <Sidebar
            navItems={navItems}
            pathname={pathname}
            stations={stations}
            settings={settings}
            user={user}
            onSignOut={handleSignOut}
            onStationsChange={refreshStations}
            onSettingsChange={setSettings}
          />
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Mobile header */}
          <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1 rounded text-gray-600 hover:text-gray-900"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="font-semibold text-gray-900 text-sm">
              {navItems.find((n) => n.href === pathname)?.label ?? 'Rotation & Safety'}
            </span>
          </div>

          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </AppContext.Provider>
  )
}
