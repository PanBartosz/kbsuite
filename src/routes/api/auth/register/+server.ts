import { json } from '@sveltejs/kit'
import { createSessionForUser, createUserWithPassword } from '$lib/server/db'

const COOKIE_NAME = 'kb_session'

export const POST = async ({ request, cookies }) => {
  const body = await request.json().catch(() => ({}))
  const { username, password } = body ?? {}
  if (!username || !password) {
    return json({ error: 'username and password required' }, { status: 400 })
  }
  try {
    const userId = createUserWithPassword(username, password)
    const session = createSessionForUser(userId)
    cookies.set(COOKIE_NAME, session.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 365
    })
    return json({ ok: true, userId, username })
  } catch (err) {
    const message = (err as any)?.message ?? 'Registration failed'
    return json({ error: message }, { status: 400 })
  }
}
