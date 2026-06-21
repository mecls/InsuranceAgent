import { type NextRequest } from 'next/server'
import { getConnectedAccount } from '@/lib/db/google-credentials'
import { getThreadMeta } from '@/lib/services/gmail'

export const runtime = 'nodejs'

/**
 * Read one thread's metadata for the submission composer: sender, body, and
 * attachment names + sizes (no bytes). Used when the user adds a Gmail thread as
 * a document source so the form can hydrate broker fields and list the files. The
 * bytes are fetched server-side later, on submit, in `startSubmissionRun`.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params

  let account
  try {
    account = await getConnectedAccount()
  } catch {
    return Response.json({ connected: false })
  }
  if (!account) return Response.json({ connected: false })

  try {
    const meta = await getThreadMeta(threadId)
    return Response.json({ connected: true, meta })
  } catch (e) {
    console.error('[gmail-thread] meta failed', e)
    return Response.json({ connected: true, error: 'Could not read that thread.' })
  }
}
