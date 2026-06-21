import { type NextRequest } from 'next/server'
import { getConnectedAccount } from '@/lib/db/google-credentials'
import { listThreads } from '@/lib/services/gmail'

export const runtime = 'nodejs'

/**
 * List candidate broker threads for the picker. Returns {connected:false} when no
 * Gmail account is linked. Default query surfaces recent threads with attachments.
 */
export async function GET(req: NextRequest) {
  // Treat any lookup failure (e.g. migration not applied yet) as "not connected"
  // so the UI shows the Connect button rather than erroring.
  let account
  try {
    account = await getConnectedAccount()
  } catch (e) {
    console.error('[gmail-threads] account lookup failed', e)
    return Response.json({ connected: false })
  }
  if (!account) return Response.json({ connected: false })

  const q =
    new URL(req.url).searchParams.get('q')?.trim() || 'has:attachment newer_than:1y'
  try {
    const threads = await listThreads(q, 15)
    return Response.json({ connected: true, email: account.email, threads })
  } catch (e) {
    console.error('[gmail-threads] list failed', e)
    return Response.json({
      connected: true,
      email: account.email,
      threads: [],
      error: 'Could not read Gmail. Try reconnecting.',
    })
  }
}
