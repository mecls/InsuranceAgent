import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { SITE_CONFIG } from '@/lib/site-config'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-[100dvh] min-h-0 flex-col">
      <nav className="flex items-center gap-2 border-b border-black/10 bg-white px-5 py-2.5">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-[var(--brand-accent)] text-white">
            <ShieldCheck className="size-4" />
          </span>
          <span className="text-sm font-semibold">{SITE_CONFIG.brand}</span>
        </Link>
        <span className="ml-1 hidden text-xs text-neutral-400 sm:inline">
          {SITE_CONFIG.lineOfBusinessLabel} underwriting
        </span>
      </nav>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  )
}
