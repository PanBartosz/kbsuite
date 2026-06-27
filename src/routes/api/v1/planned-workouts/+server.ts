import { json } from '@sveltejs/kit'
import crypto from 'node:crypto'
import {
  apiError,
  authorizeApiRequest,
  clientIdFromBody,
  hasOwn,
  parsePlanJson,
  parseTags,
  readJsonBody,
  resolveTitle,
  serializePlannedWorkout,
  toInteger
} from '$lib/server/api-v1'
import { getDb } from '$lib/server/db'

export const GET = async ({ request, url }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const start = toInteger(url.searchParams.get('start'))
  const end = toInteger(url.searchParams.get('end'))
  const db = getDb()
  const rows =
    start && end
      ? (db
          .prepare(
            `SELECT * FROM planned_workouts
             WHERE user_id = ? AND planned_for BETWEEN ? AND ?
             ORDER BY planned_for ASC`
          )
          .all(auth.user.userId, start, end) as any[])
      : (db
          .prepare(
            `SELECT * FROM planned_workouts
             WHERE user_id = ?
             ORDER BY planned_for ASC
             LIMIT 500`
          )
          .all(auth.user.userId) as any[])

  return json({ items: rows.map(serializePlannedWorkout), total: rows.length })
}

export const POST = async ({ request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const body = await readJsonBody(request)
  const plannedFor = toInteger(body?.plannedFor ?? body?.planned_for)
  if (!plannedFor) return apiError('plannedFor required', 400)

  const yamlSource = typeof body?.yaml_source === 'string' ? body.yaml_source : ''
  const planJson = parsePlanJson(yamlSource)
  const title = resolveTitle(body?.title, planJson)
  const tags = parseTags(body?.tags)
  const db = getDb()
  const requestedId = clientIdFromBody(body?.id)
  if (hasOwn(body, 'id') && !requestedId) return apiError('Invalid id', 400)
  const id = requestedId ?? crypto.randomUUID()
  const existing = db.prepare('SELECT id FROM planned_workouts WHERE id = ?').get(id)
  if (existing) return apiError('Planned workout already exists', 409)

  const now = Date.now()
  db.prepare(
    `INSERT INTO planned_workouts
      (id, user_id, planned_for, title, yaml_source, plan_json, notes, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    auth.user.userId,
    plannedFor,
    title,
    yamlSource,
    planJson ? JSON.stringify(planJson) : null,
    typeof body?.notes === 'string' ? body.notes : '',
    JSON.stringify(tags),
    now,
    now
  )

  const row = db
    .prepare('SELECT * FROM planned_workouts WHERE id = ? AND user_id = ?')
    .get(id, auth.user.userId)
  return json({ item: row ? serializePlannedWorkout(row) : null }, { status: 201 })
}
