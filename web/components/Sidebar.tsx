'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { User } from '@supabase/supabase-js'
import type { Station, AppSettings } from '@/lib/types'
import { DEFAULT_SKILL_LABELS, DEFAULT_CERT_LABELS, DEFAULT_COMPETENCY_COLORS } from '@/lib/types'
import { upsertStation, deleteStation, generateId, upsertSetting } from '@/lib/db'

interface NavItem {
  href: string
  label: string
  icon: string
}

interface SidebarProps {
  navItems: NavItem[]
  pathname: string
  stations: Station[]
  settings: AppSettings
  user: User
  onSignOut: () => void
  onStationsChange: () => Promise<void>
  onSettingsChange: (s: AppSettings) => void
}

export default function Sidebar({
  navItems,
  pathname,
  stations,
  settings,
  user,
  onSignOut,
  onStationsChange,
  onSettingsChange,
}: SidebarProps) {
  const [stationsOpen, setStationsOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Add station form
  const [newName, setNewName] = useState('')
  const [newSkill, setNewSkill] = useState(0)
  const [newCert, setNewCert] = useState(0)
  const [newHeadcount, setNewHeadcount] = useState(1)
  const [adding, setAdding] = useState(false)

  // Settings form
  const [localSkillLabels, setLocalSkillLabels] = useState<Record<number, string>>(() => ({
    ...settings.skillLabels,
  }))
  const [localCertLabels, setLocalCertLabels] = useState<Record<number, string>>(() => ({
    ...settings.certLabels,
  }))
  const [localColors, setLocalColors] = useState<Record<number, string>>(() => ({
    ...settings.competencyColors,
  }))
  const [saving, setSaving] = useState(false)

  const handleAddStation = async () => {
    if (!newName.trim()) return
    setAdding(true)
    try {
      await upsertStation({
        id: generateId('stn'),
        name: newName.trim(),
        required_skill_level: newSkill,
        required_certification: newCert,
        required_headcount: newHeadcount,
      })
      setNewName('')
      setNewSkill(0)
      setNewCert(0)
      setNewHeadcount(1)
      await onStationsChange()
    } finally {
      setAdding(false)
    }
  }

  const handleDeleteStation = async (id: string) => {
    if (!confirm('Delete this station? This will also remove all competency data for this station.')) return
    await deleteStation(id)
    await onStationsChange()
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      await Promise.all([
        upsertSetting('skill_labels', localSkillLabels),
        upsertSetting('cert_labels', localCertLabels),
        upsertSetting('competency_colors', localColors),
      ])
      onSettingsChange({
        skillLabels: { ...localSkillLabels },
        certLabels: { ...localCertLabels },
        competencyColors: { ...localColors },
      })
    } finally {
      setSaving(false)
    }
  }

  const handleResetSettings = async () => {
    const reset = {
      skillLabels: { ...DEFAULT_SKILL_LABELS },
      certLabels: { ...DEFAULT_CERT_LABELS },
      competencyColors: { ...DEFAULT_COMPETENCY_COLORS },
    }
    setLocalSkillLabels({ ...DEFAULT_SKILL_LABELS })
    setLocalCertLabels({ ...DEFAULT_CERT_LABELS })
    setLocalColors({ ...DEFAULT_COMPETENCY_COLORS })
    await Promise.all([
      upsertSetting('skill_labels', reset.skillLabels),
      upsertSetting('cert_labels', reset.certLabels),
      upsertSetting('competency_colors', reset.competencyColors),
    ])
    onSettingsChange(reset)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-xl">🏭</span>
          <span className="font-semibold text-sm leading-tight">
            Rotation &amp; Safety
            <br />
            <span className="text-gray-400 text-xs font-normal">Management System</span>
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="px-3 py-4 space-y-0.5">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              pathname === item.href
                ? 'bg-white/10 text-white font-medium'
                : 'text-gray-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            <span>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">
        {/* Stations */}
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setStationsOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium text-gray-300 hover:text-white"
          >
            <span>🏭 Stations ({stations.length})</span>
            <span className="text-gray-500">{stationsOpen ? '▲' : '▼'}</span>
          </button>

          {stationsOpen && (
            <div className="px-3 pb-3 space-y-3 border-t border-gray-700 pt-3">
              {/* Existing stations */}
              {stations.length > 0 && (
                <div className="space-y-1">
                  {stations.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between text-xs text-gray-400 group"
                    >
                      <span className="truncate">{s.name}</span>
                      <button
                        onClick={() => handleDeleteStation(s.id)}
                        className="ml-2 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add station form */}
              <div className="space-y-2 pt-1 border-t border-gray-700">
                <p className="text-xs text-gray-500 font-medium">Add Station</p>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Station name"
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-gray-400"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddStation()}
                />
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="text-xs text-gray-500">Competency</label>
                    <select
                      value={newSkill}
                      onChange={(e) => setNewSkill(Number(e.target.value))}
                      className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none"
                    >
                      {[0, 1, 2, 3, 4].map((l) => (
                        <option key={l} value={l}>
                          {l} - {settings.skillLabels[l]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Certification</label>
                    <select
                      value={newCert}
                      onChange={(e) => setNewCert(Number(e.target.value))}
                      className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none"
                    >
                      {[0, 1, 2].map((l) => (
                        <option key={l} value={l}>
                          {l} - {settings.certLabels[l]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Headcount</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={newHeadcount}
                    onChange={(e) => setNewHeadcount(Number(e.target.value))}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none"
                  />
                </div>
                <button
                  onClick={handleAddStation}
                  disabled={adding || !newName.trim()}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded py-1.5 transition-colors"
                >
                  {adding ? 'Adding…' : '+ Add Station'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Settings */}
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setSettingsOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium text-gray-300 hover:text-white"
          >
            <span>⚙️ Settings</span>
            <span className="text-gray-500">{settingsOpen ? '▲' : '▼'}</span>
          </button>

          {settingsOpen && (
            <div className="px-3 pb-3 space-y-4 border-t border-gray-700 pt-3">
              {/* Skill labels */}
              <div>
                <p className="text-xs text-gray-400 font-medium mb-2">Competency Labels</p>
                {[0, 1, 2, 3, 4].map((l) => (
                  <div key={l} className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-gray-500 w-5">{l}</span>
                    <input
                      value={localSkillLabels[l] ?? ''}
                      onChange={(e) =>
                        setLocalSkillLabels((prev) => ({ ...prev, [l]: e.target.value }))
                      }
                      className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none"
                    />
                  </div>
                ))}
              </div>

              {/* Cert labels */}
              <div>
                <p className="text-xs text-gray-400 font-medium mb-2">Certification Labels</p>
                {[0, 1, 2].map((l) => (
                  <div key={l} className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-gray-500 w-5">{l}</span>
                    <input
                      value={localCertLabels[l] ?? ''}
                      onChange={(e) =>
                        setLocalCertLabels((prev) => ({ ...prev, [l]: e.target.value }))
                      }
                      className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none"
                    />
                  </div>
                ))}
              </div>

              {/* Colors */}
              <div>
                <p className="text-xs text-gray-400 font-medium mb-2">Competency Colors</p>
                {[0, 1, 2, 3, 4].map((l) => (
                  <div key={l} className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-gray-500 w-5">{l}</span>
                    <input
                      type="color"
                      value={localColors[l] ?? '#E8E8E8'}
                      onChange={(e) =>
                        setLocalColors((prev) => ({ ...prev, [l]: e.target.value }))
                      }
                      className="w-8 h-6 rounded border border-gray-600 cursor-pointer bg-transparent"
                    />
                    <span
                      className="flex-1 h-6 rounded text-xs flex items-center px-2"
                      style={{ backgroundColor: localColors[l] }}
                    >
                      {localSkillLabels[l]}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSaveSettings}
                  disabled={saving}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded py-1.5 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={handleResetSettings}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded py-1.5 transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* User footer */}
      <div className="px-4 py-3 border-t border-gray-800">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400 truncate">{user.email}</span>
          <button
            onClick={onSignOut}
            className="text-xs text-gray-500 hover:text-white transition-colors ml-2 shrink-0"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
