import { getConnectedAccount } from '@/lib/db/google-credentials'

export const runtime = 'nodejs'

/**
 * Lightweight Gmail connection status for the account menu: whether an account is
 * linked and, if so, its email. Avoids the thread-list call `/api/gmail/threads`
 * makes, so the menu can check status cheaply.
 */
export async function GET() {
  try {
    const account = await getConnectedAccount()
    if (!account) return Response.json({ connected: false })
    return Response.json({ connected: true, email: account.email })
  } catch (e) {
    console.error('[gmail-status] lookup failed', e)
    return Response.json({ connected: false })
  }
}
