import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Rotation & Safety Management',
  description: 'Cross-training matrix and rotation scheduler',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
