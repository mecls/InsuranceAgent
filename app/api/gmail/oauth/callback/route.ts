import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { exchangeCodeForTokens, getUserInfo, getProfileEmail } from '@/lib/services/gmail'
import { saveGoogleCredentials } from '@/lib/db/google-credentials'

export const runtime = 'nodejs'

/**
 * OAuth callback. Verifies the CSRF state, exchanges the code for tokens, stores
 * the refresh token, and returns to the dashboard. Read-only scope only.
 */
export async function GET(req: NextRequest) {
  const base = env.appBaseUrl()
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieState = req.cookies.get('gmail_oauth_state')?.value

  const fail = (reason: string) =>
    NextResponse.redirect(`${base}/dashboard?gmail=${reason}`)

  if (url.searchParams.get('error')) return fail('denied')
  if (!code || !state || !cookieState || state !== cookieState) return fail('error')

  try {
    const tokens = await exchangeCodeForTokens(code)
    if (!tokens.refresh_token) return fail('notoken')
    const info = await getUserInfo(tokens.access_token)
    const email = info.email ?? (await getProfileEmail(tokens.access_token))
    if (!email) return fail('error') // need an email to resolve the account
    await saveGoogleCredentials({
      email,
      googleSub: info.sub,
      refreshToken: tokens.refresh_token,
      scope: tokens.scope ?? null,
    })
    const res = NextResponse.redirect(`${base}/dashboard?gmail=connected`)
    res.cookies.delete('gmail_oauth_state')
    return res
  } catch (e) {
    console.error('[gmail-oauth] callback failed', e)
    return fail('error')
  }
}
