import { NextResponse } from 'next/server'
import { buildAuthUrl } from '@/lib/services/gmail'

export const runtime = 'nodejs'

/** Kick off the Connect Gmail consent flow. Sets a CSRF state cookie. */
export async function GET() {
  const state = crypto.randomUUID()
  const res = NextResponse.redirect(buildAuthUrl(state))
  res.cookies.set('gmail_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return res
}
