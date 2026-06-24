import { json } from '@sveltejs/kit'
import { ensureSessionUser } from '$lib/server/db'
import { getProgramAdapter } from '$lib/programming/registry'

const COOKIE_NAME = 'kb_session'

export const POST = async ({ request, cookies }) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  })

  const body = await request.json().catch(() => ({}))
  const specInput = body?.spec ?? body
  const adapter = getProgramAdapter(specInput?.kind)
  if (!adapter) return json({ error: 'Unsupported program kind' }, { status: 400 })

  try {
    const spec = adapter.normalizeSpec(specInput)
    const workouts = adapter.generateWorkouts(spec, { runId: 'preview' })
    return json({ spec, workouts })
  } catch (error) {
    return json({ error: (error as any)?.message ?? 'Invalid program spec' }, { status: 400 })
  }
}
