import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { SITE_CONFIG } from '@/lib/site-config'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: SITE_CONFIG.brand,
  description: SITE_CONFIG.description,
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#FAFAF7',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-[100dvh] flex-col bg-[var(--background)] text-[var(--foreground)]">
        {children}
      </body>
    </html>
  )
}
