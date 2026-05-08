'use client'

import { useState, useEffect } from 'react'
import { useApp } from '@/components/AppShell'
import { fetchAuditLogs } from '@/lib/db'
import type { AuditLog } from '@/lib/types'
import { redirect } from 'next/navigation'

export default function ActivityPage() {
  const { userRole, activeDepartment } = useApp()

  if (userRole !== 'admin' && userRole !== 'superadmin') {
    redirect(`/${activeDepartment?.id ?? ''}/matrix`)
  }

  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAuditLogs(100).then((data) => {
      setLogs(data)
      setLoading(false)
    })
  }, [])

  const formatTimestamp = (ts: string) => {
    try {
      const dt = new Date(ts)
      return dt.toLocaleString('en-CA', {
        timeZone: 'America/Toronto',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    } catch {
      return ts
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Activity Log</h1>
        <button
          onClick={() => {
            setLoading(true)
            fetchAuditLogs(100).then((data) => {
              setLogs(data)
              setLoading(false)
            })
          }}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
            Loading…
          </div>
        ) : logs.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
            No activity recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap">
                    Timestamp
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-600">User</th>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-600">Action</th>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-600">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => (
                  <tr key={log.id ?? i} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">
                      {formatTimestamp(log.timestamp)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{log.user_email}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{log.action}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
