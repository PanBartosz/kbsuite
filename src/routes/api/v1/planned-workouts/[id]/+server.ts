import { json } from '@sveltejs/kit'
import {
  apiError,
  authorizeApiRequest,
  hasOwn,
  parsePlanJson,
  parseTags,
  resolveTitle,
  serializePlannedWorkout,
  toInteger
} from '$lib/server/api-v1'
import { getDb } from '$lib/server/db'

export const GET = async ({ params, request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const id = params.id
  if (!id) return apiError('Missing id', 400)
  const row = getDb()
    .prepare('SELECT * FROM planned_workouts WHERE id = ? AND user_id = ?')
    .get(id, auth.user.userId)
  if (!row) return apiError('Not found', 404)
  return json({ item: serializePlannedWorkout(row) })
}

export const PUT = async ({ params, request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const id = params.id
  if (!id) return apiError('Missing id', 400)
  const db = getDb()
  const existing = db
    .prepare('SELECT * FROM planned_workouts WHERE id = ? AND user_id = ?')
    .get(id, auth.user.userId) as any
  if (!existing) return apiError('Not found', 404)

  const body = await request.json().catch(() => ({}))
  const plannedFor = hasOwn(body, 'plannedFor') || hasOwn(body, 'planned_for')
    ? toInteger(body.plannedFor ?? body.planned_for)
    : existing.planned_for
  if (!plannedFor) return apiError('plannedFor required', 400)

  const yamlSource = hasOwn(body, 'yaml_source')
    ? String(body.yaml_source ?? '')
    : (existing.yaml_source ?? '')
  const planJson = parsePlanJson(yamlSource)
  const title = hasOwn(body, 'title')
    ? resolveTitle(body.title, planJson)
    : hasOwn(body, 'yaml_source')
      ? resolveTitle(undefined, planJson, existing.title ?? '')
      : (existing.title ?? '')
  const notes = hasOwn(body, 'notes') ? String(body.notes ?? '') : (existing.notes ?? '')
  const tags = hasOwn(body, 'tags') ? parseTags(body.tags) : parseTags(existing.tags)
  const now = Date.now()

  db.prepare(
    `UPDATE planned_workouts
     SET planned_for = ?,
         title = ?,
         yaml_source = ?,
         plan_json = ?,
         notes = ?,
         tags = ?,
         updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    plannedFor,
    title,
    yamlSource,
    planJson ? JSON.stringify(planJson) : null,
    notes,
    JSON.stringify(tags),
    now,
    id,
    auth.user.userId
  )

  const row = db
    .prepare('SELECT * FROM planned_workouts WHERE id = ? AND user_id = ?')
    .get(id, auth.user.userId)
  return json({ item: row ? serializePlannedWorkout(row) : null })
}

export const DELETE = async ({ params, request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const id = params.id
  if (!id) return apiError('Missing id', 400)
  const db = getDb()
  const result = db
    .prepare('DELETE FROM planned_workouts WHERE id = ? AND user_id = ?')
    .run(id, auth.user.userId)
  if (result.changes === 0) return apiError('Not found', 404)
  return json({ ok: true })
}
