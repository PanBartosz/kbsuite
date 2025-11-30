import { json } from '@sveltejs/kit'
import { ensureSessionUser, getSettingsForUser, saveSettingsForUser } from '$lib/server/db'

const COOKIE_NAME = 'kb_session'

export const GET = async ({ cookies }) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  })
  const settings = getSettingsForUser(session.userId)
  return json({ settings, userId: session.userId })
}

export const PUT = async ({ request, cookies }) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  })
  const body = await request.json().catch(() => ({}))
  if (body && typeof body === 'object' && body.settings) {
    saveSettingsForUser(session.userId, body.settings)
  }
  return json({ ok: true })
}
