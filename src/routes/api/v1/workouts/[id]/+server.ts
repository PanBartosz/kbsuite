import { json } from '@sveltejs/kit'
import {
  apiError,
  authorizeApiRequest,
  hasOwn,
  parsePlanJson,
  serializeWorkout
} from '$lib/server/api-v1'
import { getDb } from '$lib/server/db'

const editableWorkoutForUser = (id: string, userId: string) => {
  const row = getDb().prepare('SELECT * FROM workouts WHERE id = ?').get(id) as any
  if (!row) return apiError('Not found', 404)
  if (row.is_template) return apiError('Template workouts cannot be modified', 403)
  if (row.owner_id !== userId) return apiError('Not found', 404)
  return row
}

export const GET = async ({ params, request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const id = params.id
  if (!id) return apiError('Missing id', 400)
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM workouts WHERE id = ? AND (owner_id = ? OR is_template = 1)')
    .get(id, auth.user.userId)
  if (!row) return apiError('Not found', 404)
  return json({ item: serializeWorkout(row) })
}

export const PUT = async ({ params, request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const id = params.id
  if (!id) return apiError('Missing id', 400)
  const owned = editableWorkoutForUser(id, auth.user.userId)
  if (owned instanceof Response) return owned

  const body = await request.json().catch(() => ({}))
  const name = hasOwn(body, 'name') ? String(body.name ?? '').trim() : owned.name
  const yamlSource = hasOwn(body, 'yaml_source')
    ? String(body.yaml_source ?? '')
    : owned.yaml_source
  if (!name || !yamlSource) return apiError('name and yaml_source required', 400)

  const description = hasOwn(body, 'description')
    ? String(body.description ?? '')
    : (owned.description ?? '')
  const planJson = parsePlanJson(yamlSource)
  const now = Date.now()
  const db = getDb()
  db.prepare(
    `UPDATE workouts
     SET name = ?,
         description = ?,
         yaml_source = ?,
         plan_json = ?,
         updated_at = ?
     WHERE id = ? AND owner_id = ? AND is_template = 0`
  ).run(
    name,
    description,
    yamlSource,
    planJson ? JSON.stringify(planJson) : null,
    now,
    id,
    auth.user.userId
  )

  const row = db
    .prepare('SELECT * FROM workouts WHERE id = ? AND owner_id = ?')
    .get(id, auth.user.userId)
  return json({ item: row ? serializeWorkout(row) : null })
}

export const DELETE = async ({ params, request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const id = params.id
  if (!id) return apiError('Missing id', 400)
  const owned = editableWorkoutForUser(id, auth.user.userId)
  if (owned instanceof Response) return owned

  getDb()
    .prepare('DELETE FROM workouts WHERE id = ? AND owner_id = ? AND is_template = 0')
    .run(id, auth.user.userId)
  return json({ ok: true })
}
