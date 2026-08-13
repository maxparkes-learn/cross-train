'use client'

import { useState, useEffect, useRef } from 'react'
import type { Station, AppSettings } from '@/lib/types'
import { upsertStation, deleteStation, reorderStations, generateId } from '@/lib/db'
import Modal, { fieldLabelClass, inputClass, primaryButtonClass, outlineButtonClass } from './Modal'
import { PlusIcon, XIcon } from './Icons'

/**
 * Station management, lifted out of the old sidebar panel.
 *
 * Every handler below is moved verbatim — same lib/db calls, same argument order,
 * same confirm copy — because this is a reskin. Deliberately NOT role-gated, matching
 * the sidebar: managers could add, edit and delete stations before, and adding a gate
 * here would silently remove that capability.
 */
export default function StationsModal({
  open,
  onClose,
  stations,
  settings,
  activeDeptId,
  departmentName,
  onStationsChange,
  initialEditId,
}: {
  open: boolean
  onClose: () => void
  stations: Station[]
  settings: AppSettings
  activeDeptId: string
  departmentName: string
  onStationsChange: () => Promise<void>
  /** Opens straight into a station's edit form, for the "edit" affordance in the menu. */
  initialEditId?: string | null
}) {
  const [localStations, setLocalStations] = useState(stations)
  const isDraggingStn = useRef(false)
  const [dragStnIdx, setDragStnIdx] = useState<number | null>(null)
  const [dragOverStnIdx, setDragOverStnIdx] = useState<number | null>(null)

  // The ref guard keeps an in-flight drag from being clobbered by a refresh.
  useEffect(() => {
    if (!isDraggingStn.current) setLocalStations(stations)
  }, [stations])

  const [newName, setNewName] = useState('')
  const [newSkill, setNewSkill] = useState(0)
  const [newCert, setNewCert] = useState(0)
  const [newHeadcount, setNewHeadcount] = useState(1)
  const [adding, setAdding] = useState(false)

  const [editingStationId, setEditingStationId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSkill, setEditSkill] = useState(0)
  const [editCert, setEditCert] = useState(0)
  const [editHeadcount, setEditHeadcount] = useState(1)
  const [savingStation, setSavingStation] = useState(false)

  const settingsSkillLevels = Object.keys(settings.skillLabels).map(Number).sort((a, b) => a - b)
  const settingsCertLevels = Object.keys(settings.certLabels).map(Number).sort((a, b) => a - b)

  const handleStartEditStation = (s: Station) => {
    setEditingStationId(s.id)
    setEditName(s.name)
    setEditSkill(s.required_skill_level)
    setEditCert(s.required_certification)
    setEditHeadcount(s.required_headcount)
  }

  // Jump straight to a station's edit form when opened from the header menu.
  useEffect(() => {
    if (!open) { setEditingStationId(null); return }
    if (!initialEditId) return
    const s = stations.find((x) => x.id === initialEditId)
    if (s) handleStartEditStation(s)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialEditId])

  const handleStnDragStart = (i: number) => { isDraggingStn.current = true; setDragStnIdx(i) }
  const handleStnDragOver = (e: React.DragEvent, i: number) => { e.preventDefault(); setDragOverStnIdx(i) }
  const handleStnDrop = async (i: number) => {
    if (dragStnIdx === null || dragStnIdx === i) { isDraggingStn.current = false; setDragStnIdx(null); setDragOverStnIdx(null); return }
    const next = [...localStations]
    const [moved] = next.splice(dragStnIdx, 1)
    next.splice(i, 0, moved)
    setLocalStations(next)
    isDraggingStn.current = false
    setDragStnIdx(null)
    setDragOverStnIdx(null)
    await reorderStations(next.map((s) => s.id))
  }

  const handleAddStation = async () => {
    if (!newName.trim()) return
    setAdding(true)
    try {
      await upsertStation(
        { id: generateId('stn'), name: newName.trim(), required_skill_level: newSkill, required_certification: newCert, required_headcount: newHeadcount },
        activeDeptId,
      )
      setNewName(''); setNewSkill(0); setNewCert(0); setNewHeadcount(1)
      await onStationsChange()
    } finally {
      setAdding(false)
    }
  }

  const handleSaveStation = async () => {
    if (!editName.trim() || !editingStationId) return
    setSavingStation(true)
    try {
      await upsertStation(
        { id: editingStationId, name: editName.trim(), required_skill_level: editSkill, required_certification: editCert, required_headcount: editHeadcount },
        activeDeptId,
      )
      setEditingStationId(null)
      await onStationsChange()
    } finally {
      setSavingStation(false)
    }
  }

  const handleDeleteStation = async (id: string) => {
    if (!confirm('Delete this station? This will also remove all competency data for this station.')) return
    await deleteStation(id)
    await onStationsChange()
  }

  const levelSelect = (
    value: number,
    onChange: (v: number) => void,
    levels: number[],
    labels: Record<number, string>,
  ) => (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-9 w-full rounded-lg border border-line bg-white px-2 text-[13px] text-ink outline-none transition-shadow duration-[120ms] focus:border-brand focus:shadow-focus"
    >
      {levels.map((l) => (
        <option key={l} value={l}>{l} — {labels[l]}</option>
      ))}
    </select>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Stations"
      description={departmentName}
      width={560}
    >
      <div className="space-y-1">
        {localStations.length === 0 && (
          <p className="py-6 text-center text-sm text-ink-faint">
            No stations yet. Add the first one below.
          </p>
        )}

        {localStations.map((s, i) =>
          editingStationId === s.id ? (
            <div key={s.id} className="rounded-xl border border-line bg-canvas p-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="col-span-2">
                  <label className={fieldLabelClass}>Station name</label>
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={fieldLabelClass}>Required competency</label>
                  {levelSelect(editSkill, setEditSkill, settingsSkillLevels, settings.skillLabels)}
                </div>
                <div>
                  <label className={fieldLabelClass}>Required certification</label>
                  {levelSelect(editCert, setEditCert, settingsCertLevels, settings.certLabels)}
                </div>
                <div>
                  <label className={fieldLabelClass}>Headcount</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={editHeadcount}
                    onChange={(e) => setEditHeadcount(Number(e.target.value))}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={handleSaveStation}
                  disabled={savingStation || !editName.trim()}
                  className={primaryButtonClass}
                >
                  {savingStation ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditingStationId(null)} className={outlineButtonClass}>
                  Cancel
                </button>
                <button
                  onClick={() => handleDeleteStation(s.id)}
                  className="ml-auto inline-flex h-9 items-center rounded-lg px-3 text-[13px] font-medium text-ink-faint transition-colors duration-[120ms] hover:bg-red-50 hover:text-red-500"
                >
                  Delete station
                </button>
              </div>
            </div>
          ) : (
            <div
              key={s.id}
              draggable
              onDragStart={() => handleStnDragStart(i)}
              onDragOver={(e) => handleStnDragOver(e, i)}
              onDrop={() => handleStnDrop(i)}
              onDragEnd={() => { isDraggingStn.current = false; setDragStnIdx(null); setDragOverStnIdx(null) }}
              className={`group flex h-11 cursor-grab items-center gap-2.5 rounded-lg px-2 transition-colors duration-[120ms] hover:bg-canvas active:cursor-grabbing ${
                dragOverStnIdx === i && dragStnIdx !== i ? 'border-t-2 border-t-brand' : ''
              }`}
            >
              <span className="select-none text-sm text-ink-faint">⠿</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{s.name}</span>
              <span className="flex-none text-xs-plus text-ink-faint">
                req. {settings.skillLabels[s.required_skill_level] ?? s.required_skill_level}
                {s.required_headcount > 1 && ` · ${s.required_headcount} needed`}
              </span>
              <button
                onClick={() => handleStartEditStation(s)}
                className="flex-none rounded-md px-2 py-1 text-xs font-medium text-ink-faint opacity-0 transition-opacity duration-[120ms] hover:text-ink focus:opacity-100 group-hover:opacity-100"
              >
                Edit
              </button>
              <button
                onClick={() => handleDeleteStation(s.id)}
                aria-label={`Delete ${s.name}`}
                className="flex-none rounded-md p-1 text-ink-faint opacity-0 transition-opacity duration-[120ms] hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
              >
                <XIcon size={14} />
              </button>
            </div>
          ),
        )}
      </div>

      <div className="mt-5 rounded-xl border border-line-soft bg-canvas p-3">
        <h3 className="mb-2.5 text-[13px] font-semibold text-ink">Add station</h3>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="col-span-2">
            <label className={fieldLabelClass}>Station name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              // Enter submits from the name field only. Deliberately not a <form>:
              // that would make Enter in the headcount field submit too.
              onKeyDown={(e) => e.key === 'Enter' && handleAddStation()}
              placeholder="e.g. Brake and tire"
              className={inputClass}
            />
          </div>
          <div>
            <label className={fieldLabelClass}>Required competency</label>
            {levelSelect(newSkill, setNewSkill, settingsSkillLevels, settings.skillLabels)}
          </div>
          <div>
            <label className={fieldLabelClass}>Required certification</label>
            {levelSelect(newCert, setNewCert, settingsCertLevels, settings.certLabels)}
          </div>
          <div>
            <label className={fieldLabelClass}>Headcount</label>
            <input
              type="number"
              min={1}
              max={20}
              value={newHeadcount}
              onChange={(e) => setNewHeadcount(Number(e.target.value))}
              className={inputClass}
            />
          </div>
        </div>
        <button
          onClick={handleAddStation}
          disabled={adding || !newName.trim()}
          className={`${primaryButtonClass} mt-3 gap-1.5`}
        >
          <PlusIcon size={15} />
          {adding ? 'Adding…' : 'Add station'}
        </button>
      </div>
    </Modal>
  )
}
