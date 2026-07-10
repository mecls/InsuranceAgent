import Link from 'next/link'
import { SITE_CONFIG } from '@/lib/site-config'
import { AccountMenu } from '@/components/dashboard/account-menu'

const AVATAR_INITIAL = 'M'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-[100dvh] min-h-0 flex-col bg-[var(--color-bg-page)]">
      <nav
        className="flex h-[52px] shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-white px-5"
      >
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-[15px] font-semibold text-[#0F1923]"
          >
            {SITE_CONFIG.brand}
          </Link>
          <span className="h-4 w-px bg-[var(--color-border)]" />
          <span className="text-[13px] text-[var(--color-text-muted)]">
            Compras · Orçamentos
          </span>
        </div>
        <AccountMenu initial={AVATAR_INITIAL} />
      </nav>
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
