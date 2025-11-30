import { json } from '@sveltejs/kit'
import { ensureSessionUser, getDb } from '$lib/server/db'

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

export const GET = async ({ params, cookies }) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  })
  const { id } = params
  if (!id) return json({ error: 'missing id' }, { status: 400 })
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM workouts WHERE id = ? AND (owner_id = ? OR is_template = 1 OR owner_id IS NULL)')
    .get(id, session.userId)
  if (!row) return json({ error: 'not found' }, { status: 404 })
  return json({ workout: serializeWorkout(row) })
}

export const DELETE = async ({ params, cookies }) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  })
  const { id } = params
  if (!id) return json({ ok: false }, { status: 400 })
  const db = getDb()
  db.prepare('DELETE FROM workouts WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)').run(id, session.userId)
  return json({ ok: true })
}
