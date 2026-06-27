import { json } from '@sveltejs/kit'
import crypto from 'node:crypto'
import {
  apiError,
  authorizeApiRequest,
  clientIdFromBody,
  hasOwn,
  parsePlanJson,
  readJsonBody,
  serializeWorkout
} from '$lib/server/api-v1'
import { getDb } from '$lib/server/db'

export const GET = async ({ request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const db = getDb()
  const rows = db
    .prepare(
      `SELECT * FROM workouts
       WHERE owner_id = ? OR is_template = 1
       ORDER BY is_template DESC, updated_at DESC`
    )
    .all(auth.user.userId) as any[]

  return json({ items: rows.map(serializeWorkout), total: rows.length })
}

export const POST = async ({ request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const body = await readJsonBody(request)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const yamlSource = typeof body?.yaml_source === 'string' ? body.yaml_source : ''
  if (!name || !yamlSource) return apiError('name and yaml_source required', 400)

  const db = getDb()
  const requestedId = clientIdFromBody(body?.id)
  if (hasOwn(body, 'id') && !requestedId) return apiError('Invalid id', 400)
  const id = requestedId ?? crypto.randomUUID()
  const existing = db.prepare('SELECT id FROM workouts WHERE id = ?').get(id)
  if (existing) return apiError('Workout already exists', 409)

  const now = Date.now()
  const planJson = parsePlanJson(yamlSource)
  db.prepare(
    `INSERT INTO workouts
      (id, owner_id, name, description, yaml_source, plan_json, updated_at, is_template)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(
    id,
    auth.user.userId,
    name,
    typeof body?.description === 'string' ? body.description : '',
    yamlSource,
    planJson ? JSON.stringify(planJson) : null,
    now
  )

  const row = db
    .prepare('SELECT * FROM workouts WHERE id = ? AND owner_id = ?')
    .get(id, auth.user.userId)
  return json({ item: row ? serializeWorkout(row) : null }, { status: 201 })
}
