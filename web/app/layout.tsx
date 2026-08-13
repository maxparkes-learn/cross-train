import type { Metadata } from 'next'
import { Poppins } from 'next/font/google'
import './globals.css'

// Downloaded at build time and self-hosted by Next, so there is no runtime request
// to Google. Exposed as a CSS variable and wired into fontFamily.sans in the Tailwind
// config, so every existing font-medium / font-bold picks it up with no page edits.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-poppins',
})

export const metadata: Metadata = {
  title: 'Rotation & Safety Management',
  description: 'Cross-training matrix and rotation scheduler',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>{children}</body>
    </html>
  )
}
