import { json } from '@sveltejs/kit'
import { ensureSessionUser } from '$lib/server/db'

const COOKIE_NAME = 'kb_session'

export const GET = async ({ cookies }) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365 // 1 year
  })

  return json({
    userId: session.userId,
    username: session.username ?? null,
    isAnonymous: session.isAnonymous
  })
}
