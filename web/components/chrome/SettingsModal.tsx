'use client'

import { useState, useEffect } from 'react'
import type { AppSettings } from '@/lib/types'
import { DEFAULT_SKILL_LABELS, DEFAULT_CERT_LABELS, DEFAULT_COMPETENCY_COLORS } from '@/lib/types'
import { upsertSetting } from '@/lib/db'
import Modal, { inputClass, primaryButtonClass, outlineButtonClass } from './Modal'
import { PlusIcon, XIcon } from './Icons'

/**
 * Competency labels, certification labels and level colours — lifted from the old
 * sidebar panel. This is the app's ONLY editor for these three settings keys.
 *
 * Handlers are moved verbatim, including Reset's write-immediately-without-confirming
 * behaviour, because this is a reskin. Like the sidebar panel it is not role-gated.
 *
 * One addition: the sidebar kept drafts alive when its panel collapsed, but a modal
 * unmounting would destroy them silently. So closing while dirty now asks first.
 */
export default function SettingsModal({
  open,
  onClose,
  settings,
  activeDeptId,
  departmentName,
  onSettingsChange,
}: {
  open: boolean
  onClose: () => void
  settings: AppSettings
  activeDeptId: string
  departmentName: string
  onSettingsChange: (s: AppSettings) => void
}) {
  const [localSkillLabels, setLocalSkillLabels] = useState<Record<number, string>>(() => ({ ...settings.skillLabels }))
  const [localCertLabels, setLocalCertLabels] = useState<Record<number, string>>(() => ({ ...settings.certLabels }))
  const [localColors, setLocalColors] = useState<Record<number, string>>(() => ({ ...settings.competencyColors }))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLocalSkillLabels({ ...settings.skillLabels })
    setLocalCertLabels({ ...settings.certLabels })
    setLocalColors({ ...settings.competencyColors })
  }, [settings])

  const skillLevels = Object.keys(localSkillLabels).map(Number).sort((a, b) => a - b)
  const certLevels = Object.keys(localCertLabels).map(Number).sort((a, b) => a - b)

  const isDirty =
    JSON.stringify(localSkillLabels) !== JSON.stringify(settings.skillLabels) ||
    JSON.stringify(localCertLabels) !== JSON.stringify(settings.certLabels) ||
    JSON.stringify(localColors) !== JSON.stringify(settings.competencyColors)

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      await Promise.all([
        upsertSetting('skill_labels', localSkillLabels, activeDeptId),
        upsertSetting('cert_labels', localCertLabels, activeDeptId),
        upsertSetting('competency_colors', localColors, activeDeptId),
      ])
      onSettingsChange({ skillLabels: { ...localSkillLabels }, certLabels: { ...localCertLabels }, competencyColors: { ...localColors } })
    } finally {
      setSaving(false)
    }
  }

  const handleResetSettings = async () => {
    const reset = { skillLabels: { ...DEFAULT_SKILL_LABELS }, certLabels: { ...DEFAULT_CERT_LABELS }, competencyColors: { ...DEFAULT_COMPETENCY_COLORS } }
    setLocalSkillLabels({ ...DEFAULT_SKILL_LABELS })
    setLocalCertLabels({ ...DEFAULT_CERT_LABELS })
    setLocalColors({ ...DEFAULT_COMPETENCY_COLORS })
    await Promise.all([
      upsertSetting('skill_labels', reset.skillLabels, activeDeptId),
      upsertSetting('cert_labels', reset.certLabels, activeDeptId),
      upsertSetting('competency_colors', reset.competencyColors, activeDeptId),
    ])
    onSettingsChange(reset)
  }

  const handleAddSkillLevel = () => {
    const next = Math.max(...skillLevels) + 1
    setLocalSkillLabels((p) => ({ ...p, [next]: `Level ${next}` }))
    setLocalColors((p) => ({ ...p, [next]: '#B8D4F8' }))
  }

  const handleRemoveSkillLevel = (l: number) => {
    if (l === 0) return
    setLocalSkillLabels((p) => { const n = { ...p }; delete n[l]; return n })
    setLocalColors((p) => { const n = { ...p }; delete n[l]; return n })
  }

  const handleAddCertLevel = () => {
    const next = Math.max(...certLevels) + 1
    setLocalCertLabels((p) => ({ ...p, [next]: `Level ${next}` }))
  }

  const handleRemoveCertLevel = (l: number) => {
    if (l === 0) return
    setLocalCertLabels((p) => { const n = { ...p }; delete n[l]; return n })
  }

  const sectionTitle = 'mb-2 text-[13px] font-semibold text-ink'
  const addLinkClass =
    'inline-flex items-center gap-1 text-xs font-medium text-brand transition-colors duration-[120ms] hover:text-brand-hover'

  return (
    <Modal
      open={open}
      onClose={onClose}
      onRequestClose={() =>
        !isDirty || confirm('Discard unsaved changes to labels and colours?')
      }
      title="Settings"
      description={departmentName}
      width={560}
    >
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className={`${sectionTitle} mb-0`}>Competency labels</h3>
          <button onClick={handleAddSkillLevel} className={addLinkClass}>
            <PlusIcon size={13} /> Add level
          </button>
        </div>
        <div className="space-y-1.5">
          {skillLevels.map((l) => (
            <div key={l} className="group flex items-center gap-2">
              <span className="w-5 flex-none text-center text-xs text-ink-faint">{l}</span>
              <input
                value={localSkillLabels[l]}
                onChange={(e) => setLocalSkillLabels((p) => ({ ...p, [l]: e.target.value }))}
                className={inputClass}
              />
              <input
                type="color"
                value={localColors[l] ?? '#E8E8E8'}
                onChange={(e) => setLocalColors((p) => ({ ...p, [l]: e.target.value }))}
                aria-label={`Colour for level ${l}`}
                className="h-9 w-10 flex-none cursor-pointer rounded-lg border border-line bg-white p-0.5"
              />
              <button
                onClick={() => handleRemoveSkillLevel(l)}
                aria-label={`Remove level ${l}`}
                disabled={l === 0}
                className="flex-none rounded-md p-1 text-ink-faint opacity-0 transition-opacity duration-[120ms] hover:text-red-500 focus:opacity-100 disabled:invisible group-hover:opacity-100"
              >
                <XIcon size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {skillLevels.map((l) => (
            <span
              key={l}
              className="inline-flex h-6 items-center rounded-full px-2.5 text-xs-plus font-medium"
              style={{ backgroundColor: localColors[l] ?? '#E8E8E8', color: '#272727' }}
            >
              {l} · {localSkillLabels[l]}
            </span>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className={`${sectionTitle} mb-0`}>Certification labels</h3>
          <button onClick={handleAddCertLevel} className={addLinkClass}>
            <PlusIcon size={13} /> Add level
          </button>
        </div>
        <div className="space-y-1.5">
          {certLevels.map((l) => (
            <div key={l} className="group flex items-center gap-2">
              <span className="w-5 flex-none text-center text-xs text-ink-faint">{l}</span>
              <input
                value={localCertLabels[l]}
                onChange={(e) => setLocalCertLabels((p) => ({ ...p, [l]: e.target.value }))}
                className={inputClass}
              />
              <button
                onClick={() => handleRemoveCertLevel(l)}
                aria-label={`Remove certification level ${l}`}
                disabled={l === 0}
                className="flex-none rounded-md p-1 text-ink-faint opacity-0 transition-opacity duration-[120ms] hover:text-red-500 focus:opacity-100 disabled:invisible group-hover:opacity-100"
              >
                <XIcon size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-2 border-t border-line-soft pt-4">
        <button onClick={handleSaveSettings} disabled={saving} className={primaryButtonClass}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        <button onClick={handleResetSettings} className={outlineButtonClass}>
          Reset to defaults
        </button>
        {isDirty && <span className="ml-auto text-xs text-ink-faint">Unsaved changes</span>}
      </div>
    </Modal>
  )
}
