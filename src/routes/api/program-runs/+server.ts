import { json } from '@sveltejs/kit'
import crypto from 'node:crypto'
import { ensureSessionUser, getDb } from '$lib/server/db'
import { getProgramAdapter, listProgramAdapters } from '$lib/programming/registry'
import { serializeProgramRun } from '$lib/server/programming'

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

export const GET = async ({ cookies }) => {
  const session = touchSession(cookies)
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM program_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(session.userId) as any[]
  const workoutsStmt = db.prepare(
    `SELECT * FROM program_workouts
     WHERE program_run_id = ? AND user_id = ?
     ORDER BY cycle_index ASC, day_index ASC, planned_for ASC`
  )

  return json({
    adapters: listProgramAdapters(),
    items: rows.map((row) => serializeProgramRun(row, workoutsStmt.all(row.id, session.userId)))
  })
}

export const POST = async ({ request, cookies }) => {
  const session = touchSession(cookies)
  const body = await request.json().catch(() => ({}))
  const specInput = body?.spec ?? body
  const adapter = getProgramAdapter(specInput?.kind)
  if (!adapter) return json({ error: 'Unsupported program kind' }, { status: 400 })

  let spec: any
  try {
    spec = adapter.normalizeSpec(specInput)
  } catch (error) {
    return json({ error: (error as any)?.message ?? 'Invalid program spec' }, { status: 400 })
  }

  const id = crypto.randomUUID()
  const now = Date.now()
  const db = getDb()
  db.prepare(
    `INSERT INTO program_runs
      (id, user_id, kind, title, spec_json, state_json, status, started_at, ended_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, NULL, ?, ?)`
  ).run(
    id,
    session.userId,
    adapter.id,
    spec.title,
    JSON.stringify(spec),
    JSON.stringify({ generatedAt: null }),
    Date.parse(spec.startDate) || now,
    now,
    now
  )

  const row = db.prepare('SELECT * FROM program_runs WHERE id = ?').get(id)
  return json({ item: serializeProgramRun(row, []) })
}
