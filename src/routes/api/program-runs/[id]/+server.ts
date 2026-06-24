import { json } from '@sveltejs/kit'
import { ensureSessionUser, getDb } from '$lib/server/db'
import { getProgramRunForUser } from '$lib/server/programming'

const COOKIE_NAME = 'kb_session'

const touchSession = (cookies: any) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  })
  return session
}

export const GET = async ({ params, cookies }) => {
  const session = touchSession(cookies)
  const id = params.id
  if (!id) return json({ error: 'Missing id' }, { status: 400 })
  const item = getProgramRunForUser(id, session.userId)
  if (!item) return json({ error: 'Not found' }, { status: 404 })
  return json({ item })
}

export const DELETE = async ({ params, cookies }) => {
  const session = touchSession(cookies)
  const id = params.id
  if (!id) return json({ error: 'Missing id' }, { status: 400 })
  const db = getDb()
  db.prepare('DELETE FROM program_runs WHERE id = ? AND user_id = ?').run(id, session.userId)
  return json({ ok: true })
}
