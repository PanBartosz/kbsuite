import { json } from '@sveltejs/kit'
import { ensureSessionUser, getDb } from '$lib/server/db'

const COOKIE_NAME = 'kb_session'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  const db = getDb()
  const row = db
    .prepare('SELECT user_id FROM completed_workouts WHERE id = ?')
    .get(id) as { user_id: string } | undefined
  return !!row && row.user_id === userId
}

export const GET = async ({ params, cookies }) => {
  const session = withSession(cookies)
  const id = params.id
  if (!id) return json({ analysis: null, error: 'Missing id' }, { status: 400 })
  if (!UUID_RE.test(id)) return json({ analysis: null, error: 'Invalid id' }, { status: 400 })
  if (!assertOwnsCompletedWorkout(session.userId, id)) {
    return json({ analysis: null, error: 'Not found' }, { status: 404 })
  }

  const db = getDb()
  const row = db
    .prepare(
      `SELECT version, settings_json, analysis_json, created_at, updated_at
       FROM hr_interval_analysis
       WHERE completed_workout_id = ? AND user_id = ?`
    )
    .get(id, session.userId) as
    | { version: string; settings_json: string; analysis_json: string; created_at: number; updated_at: number }
    | undefined

  if (!row) return json({ analysis: null })

  let analysis: any = null
  let settings: any = null
  try {
    analysis = JSON.parse(row.analysis_json)
  } catch {
    analysis = null
  }
  try {
    settings = JSON.parse(row.settings_json)
  } catch {
    settings = null
  }

  return json({
    analysis,
    settings,
    meta: { version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }
  })
}

export const POST = async ({ params, cookies, request }) => {
  const session = withSession(cookies)
  const id = params.id
  if (!id) return json({ ok: false, error: 'Missing id' }, { status: 400 })
  if (!UUID_RE.test(id)) return json({ ok: false, error: 'Invalid id' }, { status: 400 })
  if (!assertOwnsCompletedWorkout(session.userId, id)) {
    return json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const analysis = (body as any)?.analysis ?? body
  if (!analysis || typeof analysis !== 'object') {
    return json({ ok: false, error: 'Invalid payload' }, { status: 400 })
  }

  const settings = {
    block: (analysis as any)?.block ?? null,
    config: (analysis as any)?.config ?? null
  }

  const now = Date.now()
  const db = getDb()
  const version = typeof (analysis as any)?.version === 'string' ? (analysis as any).version : 'v1'

  db.prepare(
    `INSERT INTO hr_interval_analysis
      (completed_workout_id, user_id, version, settings_json, analysis_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(completed_workout_id) DO UPDATE SET
       user_id = excluded.user_id,
       version = excluded.version,
       settings_json = excluded.settings_json,
       analysis_json = excluded.analysis_json,
       updated_at = excluded.updated_at`
  ).run(id, session.userId, version, JSON.stringify(settings), JSON.stringify(analysis), now, now)

  return json({ ok: true, updatedAt: now })
}

