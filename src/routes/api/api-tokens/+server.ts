import { json } from '@sveltejs/kit'
import {
  createApiTokenForUser,
  ensureSessionUser,
  listApiTokensForUser
} from '$lib/server/db'

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

const requireRegisteredSession = (cookies: any) => {
  const session = withSession(cookies)
  if (session.isAnonymous) {
    return json({ error: 'Login required' }, { status: 401 })
  }
  return session
}

export const GET = async ({ cookies }) => {
  const result = requireRegisteredSession(cookies)
  if (result instanceof Response) return result
  return json({ items: listApiTokensForUser(result.userId) })
}

export const POST = async ({ request, cookies }) => {
  const result = requireRegisteredSession(cookies)
  if (result instanceof Response) return result

  const body = await request.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name : ''
  const created = createApiTokenForUser(result.userId, name)
  return json({ item: created.item, token: created.token }, { status: 201 })
}
