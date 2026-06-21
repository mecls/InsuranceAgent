import { deleteGoogleCredentials } from '@/lib/db/google-credentials'

export const runtime = 'nodejs'

/** Forget the connected Gmail account (deletes the Vault secret + the row). */
export async function POST() {
  await deleteGoogleCredentials()
  return Response.json({ ok: true })
}
