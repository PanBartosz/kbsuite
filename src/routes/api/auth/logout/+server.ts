import { json } from '@sveltejs/kit'
import { deleteSession } from '$lib/server/db'

const COOKIE_NAME = 'kb_session'

export const POST = async ({ cookies }) => {
  const token = cookies.get(COOKIE_NAME)
  if (token) {
    deleteSession(token)
  }
  cookies.delete(COOKIE_NAME, { path: '/' })
  return json({ ok: true })
}
