import { json } from '@sveltejs/kit'
import { ensureSessionUser, getDb } from '$lib/server/db'
import crypto from 'node:crypto'

const COOKIE_NAME = 'kb_session'

const serializeWorkout = (row: any) => ({
  id: row.id,
  name: row.name,
  description: row.description ?? '',
  yaml_source: row.yaml_source ?? '',
  plan_json: row.plan_json ? JSON.parse(row.plan_json) : null,
  updated_at: row.updated_at,
  owner_id: row.owner_id ?? null,
  is_template: !!row.is_template
})

export const GET = async ({ cookies }) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  })
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT * FROM workouts WHERE owner_id = ? OR is_template = 1 ORDER BY is_template DESC, updated_at DESC`
    )
    .all(session.userId)
  return json({ workouts: rows.map(serializeWorkout) })
}

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
  const { id, name, description, yaml_source, plan_json } = body ?? {}
  if (!name || !yaml_source) {
    return json({ error: 'name and yaml_source required' }, { status: 400 })
  }
  const db = getDb()
  const workoutId = id || crypto.randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO workouts (id, owner_id, name, description, yaml_source, plan_json, updated_at, is_template)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       owner_id = excluded.owner_id,
       name = excluded.name,
       description = excluded.description,
       yaml_source = excluded.yaml_source,
       plan_json = excluded.plan_json,
       updated_at = excluded.updated_at,
       is_template = 0`
  ).run(workoutId, session.userId, name, description ?? '', yaml_source, plan_json ? JSON.stringify(plan_json) : null, now)
  const saved = db.prepare('SELECT * FROM workouts WHERE id = ?').get(workoutId)
  return json({ workout: serializeWorkout(saved) })
}
