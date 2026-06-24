import { json } from '@sveltejs/kit'
import { ensureSessionUser, getDb } from '$lib/server/db'
import { serializeProgramRun } from '$lib/server/programming'

const COOKIE_NAME = 'kb_session'

export const GET = async ({ params, cookies }) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  })
  const id = params.id
  if (!id) return json({ error: 'Missing id' }, { status: 400 })

  const db = getDb()
  const source = db
    .prepare('SELECT * FROM program_runs WHERE id = ? AND user_id = ?')
    .get(id, session.userId) as any
  if (!source) return json({ error: 'Not found' }, { status: 404 })

  const workoutsStmt = db.prepare(
    `SELECT * FROM program_workouts
     WHERE program_run_id = ? AND user_id = ?
     ORDER BY cycle_index ASC, day_index ASC, planned_for ASC`
  )
  const sourceItem = serializeProgramRun(source, workoutsStmt.all(source.id, session.userId))

  const rows = db
    .prepare(
      `SELECT * FROM program_runs
       WHERE user_id = ? AND kind = ? AND id != ?
       ORDER BY created_at DESC
       LIMIT 12`
    )
    .all(session.userId, source.kind, id) as any[]

  const candidates = rows.map((row) =>
    serializeProgramRun(row, workoutsStmt.all(row.id, session.userId))
  )

  return json({ source: sourceItem, candidates })
}
