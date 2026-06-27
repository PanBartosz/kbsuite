import { json } from '@sveltejs/kit'
import crypto from 'node:crypto'
import { apiError, authorizeApiRequest, readJsonBody } from '$lib/server/api-v1'
import { getDb } from '$lib/server/db'
import { getProgramAdapter, listProgramAdapters } from '$lib/programming/registry'
import { serializeProgramRun } from '$lib/server/programming'

export const GET = async ({ request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM program_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(auth.user.userId) as any[]
  const workoutsStmt = db.prepare(
    `SELECT * FROM program_workouts
     WHERE program_run_id = ? AND user_id = ?
     ORDER BY cycle_index ASC, day_index ASC, planned_for ASC`
  )

  return json({
    adapters: listProgramAdapters(),
    items: rows.map((row) => serializeProgramRun(row, workoutsStmt.all(row.id, auth.user.userId))),
    total: rows.length
  })
}

export const POST = async ({ request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const body = await readJsonBody(request)
  const specInput = body?.spec ?? body
  const adapter = getProgramAdapter(specInput?.kind)
  if (!adapter) return apiError('Unsupported program kind', 400)

  let spec: any
  try {
    spec = adapter.normalizeSpec(specInput)
  } catch (error) {
    return apiError((error as any)?.message ?? 'Invalid program spec', 400)
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
    auth.user.userId,
    adapter.id,
    spec.title,
    JSON.stringify(spec),
    JSON.stringify({ generatedAt: null }),
    Date.parse(spec.startDate) || now,
    now,
    now
  )

  const row = db.prepare('SELECT * FROM program_runs WHERE id = ?').get(id)
  return json({ item: serializeProgramRun(row, []) }, { status: 201 })
}
