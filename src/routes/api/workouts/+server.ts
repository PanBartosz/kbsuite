import { json } from '@sveltejs/kit'
import { ensureSessionUser, getDb } from '$lib/server/db'
import crypto from 'node:crypto'
import YAML from 'yaml'

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

const parsePlanJson = (yamlSource?: string | null) => {
  if (!yamlSource) return null
  try {
    const parsed = YAML.parse(yamlSource)
    return parsed ?? null
  } catch {
    return null
  }
}

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
  const { id, name, description, yaml_source } = body ?? {}
  const workoutName = typeof name === 'string' ? name.trim() : ''
  const yamlSource = typeof yaml_source === 'string' ? yaml_source : ''
  if (!workoutName || !yamlSource) {
    return json({ error: 'name and yaml_source required' }, { status: 400 })
  }
  const db = getDb()
  const requestedId = typeof id === 'string' && id.trim().length ? id.trim() : null
  const workoutId = requestedId ?? crypto.randomUUID()
  const now = Date.now()
  const planJson = parsePlanJson(yamlSource)

  const existing = db
    .prepare('SELECT owner_id, is_template FROM workouts WHERE id = ?')
    .get(workoutId) as { owner_id: string | null; is_template: number } | undefined
  if (existing) {
    if (existing.is_template) {
      return json({ error: 'Template workouts cannot be modified' }, { status: 403 })
    }
    if (existing.owner_id !== session.userId) {
      return json({ error: 'Not found' }, { status: 404 })
    }
    db.prepare(
      `UPDATE workouts
       SET name = ?,
           description = ?,
           yaml_source = ?,
           plan_json = ?,
           updated_at = ?,
           is_template = 0
       WHERE id = ? AND owner_id = ?`
    ).run(
      workoutName,
      description ?? '',
      yamlSource,
      planJson ? JSON.stringify(planJson) : null,
      now,
      workoutId,
      session.userId
    )
  } else {
    db.prepare(
      `INSERT INTO workouts
        (id, owner_id, name, description, yaml_source, plan_json, updated_at, is_template)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      workoutId,
      session.userId,
      workoutName,
      description ?? '',
      yamlSource,
      planJson ? JSON.stringify(planJson) : null,
      now
    )
  }

  const saved = db
    .prepare('SELECT * FROM workouts WHERE id = ? AND owner_id = ?')
    .get(workoutId, session.userId)
  return json({ workout: saved ? serializeWorkout(saved) : null })
}
