import { json } from '@sveltejs/kit'
import { ensureSessionUser, revokeApiTokenForUser } from '$lib/server/db'

const COOKIE_NAME = 'kb_session'

const withSession = (cookies: any) => {
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

export const DELETE = async ({ params, cookies }) => {
  const session = withSession(cookies)
  if (session.isAnonymous) return json({ error: 'Login required' }, { status: 401 })

  const id = params.id
  if (!id) return json({ error: 'Missing id' }, { status: 400 })
  const revoked = revokeApiTokenForUser(session.userId, id)
  if (!revoked) return json({ error: 'Not found' }, { status: 404 })
  return json({ ok: true })
}
