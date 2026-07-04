import { json } from '@sveltejs/kit'
import { ensureSessionUser, getDb } from '$lib/server/db'
import { deleteHrAttachment, readHrAttachment, saveHrAttachment } from '$lib/server/hr'

const COOKIE_NAME = 'kb_session'
const SAFE_CLIENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

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

const assertOwnsCompletedWorkout = (userId: string, id: string) => {
  const row = getDb()
    .prepare('SELECT user_id FROM completed_workouts WHERE id = ?')
    .get(id) as { user_id: string } | undefined
  return !!row && row.user_id === userId
}

const updateWorkoutTiming = (
  id: string,
  summary: { startTime?: number | null; durationSeconds?: number | null } | null
) => {
  if (!summary?.startTime || !summary?.durationSeconds) return
  getDb()
    .prepare(
      `UPDATE completed_workouts
       SET started_at = ?, finished_at = ?, duration_s = ?
       WHERE id = ?`
    )
    .run(
      summary.startTime,
      summary.startTime + summary.durationSeconds * 1000,
      summary.durationSeconds,
      id
    )
}

type ValidationResult = { ok: true; id: string } | { ok: false; response: Response }

const validateRequest = (cookies: any, id: string | undefined): ValidationResult => {
  const session = withSession(cookies)
  if (!id) {
    return {
      ok: false,
      response: json({ attached: false, files: [], error: 'Missing id' }, { status: 400 })
    }
  }
  if (!SAFE_CLIENT_ID_RE.test(id)) {
    return {
      ok: false,
      response: json({ attached: false, files: [], error: 'Invalid id' }, { status: 400 })
    }
  }
  if (!assertOwnsCompletedWorkout(session.userId, id)) {
    return {
      ok: false,
      response: json({ attached: false, files: [], error: 'Not found' }, { status: 404 })
    }
  }
  return { ok: true, id }
}

export const GET = async ({ params, cookies, url }) => {
  const validated = validateRequest(cookies, params.id)
  if (!validated.ok) return validated.response

  const details = url.searchParams.get('details') === '1'
  const full = url.searchParams.get('full') === '1'
  return json(await readHrAttachment(validated.id, { details, full }))
}

export const POST = async ({ request, params, cookies }) => {
  const validated = validateRequest(cookies, params.id)
  if (!validated.ok) return validated.response

  const form = await request.formData()
  const file = form.get('file') as File | null
  if (!file) return json({ ok: false, error: 'No file provided' }, { status: 400 })

  try {
    const saved = await saveHrAttachment(validated.id, file)
    updateWorkoutTiming(validated.id, saved.summary)
    return json({ ok: true, filename: saved.filename, summary: saved.summary })
  } catch (error) {
    return json({ ok: false, error: (error as any)?.message ?? 'Failed to save HR file' }, { status: 400 })
  }
}

export const DELETE = async ({ params, cookies }) => {
  const validated = validateRequest(cookies, params.id)
  if (!validated.ok) return validated.response

  await deleteHrAttachment(validated.id)
  return json({ ok: true })
}
