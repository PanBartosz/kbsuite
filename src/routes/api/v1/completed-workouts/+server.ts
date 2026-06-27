import { json } from '@sveltejs/kit'
import crypto from 'node:crypto'
import {
  apiError,
  authorizeApiRequest,
  clientIdFromBody,
  completedSetsForWorkout,
  hasOwn,
  insertCompletedSetRows,
  limitParam,
  offsetParam,
  parseTags,
  readJsonBody,
  serializeCompletedWorkout,
  toFiniteNumber
} from '$lib/server/api-v1'
import { getDb } from '$lib/server/db'
import { computeCompletedProgramMetrics } from '$lib/programming/metrics'
import { syncProgramWorkoutCompletion } from '$lib/server/programming'

const normalizeOptionalId = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const assertWorkoutVisible = (workoutId: string | null, userId: string) => {
  if (!workoutId) return true
  const row = getDb()
    .prepare('SELECT id FROM workouts WHERE id = ? AND (owner_id = ? OR is_template = 1)')
    .get(workoutId, userId)
  return !!row
}

const assertPlannedVisible = (plannedWorkoutId: string | null, userId: string) => {
  if (!plannedWorkoutId) return true
  const row = getDb()
    .prepare('SELECT id FROM planned_workouts WHERE id = ? AND user_id = ?')
    .get(plannedWorkoutId, userId)
  return !!row
}

export const GET = async ({ request, url }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const limit = limitParam(url.searchParams.get('limit'), 200, 500)
  const offset = offsetParam(url.searchParams.get('offset'))
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT * FROM completed_workouts
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(auth.user.userId, limit, offset) as any[]
  const total = db
    .prepare('SELECT COUNT(*) AS total FROM completed_workouts WHERE user_id = ?')
    .get(auth.user.userId) as { total: number }

  return json({
    items: rows.map((row) => serializeCompletedWorkout(row, completedSetsForWorkout(row.id))),
    total: total?.total ?? rows.length
  })
}

export const POST = async ({ request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const body = await readJsonBody(request)
  const entries = Array.isArray(body?.entries) ? body.entries : Array.isArray(body?.sets) ? body.sets : []
  if (body?.entries !== undefined && !Array.isArray(body.entries)) {
    return apiError('entries must be an array', 400)
  }
  if (body?.sets !== undefined && !Array.isArray(body.sets)) {
    return apiError('sets must be an array', 400)
  }

  const workoutId = normalizeOptionalId(body?.workoutId ?? body?.workout_id)
  const plannedWorkoutId = normalizeOptionalId(body?.plannedWorkoutId ?? body?.planned_workout_id)
  if (!assertWorkoutVisible(workoutId, auth.user.userId)) return apiError('Workout not found', 404)
  if (!assertPlannedVisible(plannedWorkoutId, auth.user.userId)) {
    return apiError('Planned workout not found', 404)
  }

  const requestedId = clientIdFromBody(body?.id)
  if (hasOwn(body, 'id') && !requestedId) return apiError('Invalid id', 400)
  const id = requestedId ?? crypto.randomUUID()
  const db = getDb()
  const existing = db.prepare('SELECT id FROM completed_workouts WHERE id = ?').get(id)
  if (existing) return apiError('Completed workout already exists', 409)

  const now = Date.now()
  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO completed_workouts
        (id, user_id, workout_id, planned_workout_id, title, started_at, finished_at, duration_s, notes, rpe, tags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      auth.user.userId,
      workoutId,
      plannedWorkoutId,
      typeof body?.title === 'string' ? body.title : '',
      toFiniteNumber(body?.startedAt ?? body?.started_at),
      toFiniteNumber(body?.finishedAt ?? body?.finished_at),
      toFiniteNumber(body?.durationSeconds ?? body?.duration_s),
      typeof body?.notes === 'string' ? body.notes : '',
      toFiniteNumber(body?.rpe),
      JSON.stringify(parseTags(body?.tags)),
      now
    )
    insertCompletedSetRows(db, id, entries)
  })
  transaction()

  syncProgramWorkoutCompletion({
    plannedWorkoutId,
    completedWorkoutId: id,
    userId: auth.user.userId,
    actualMetrics: computeCompletedProgramMetrics(entries)
  })

  const row = db
    .prepare('SELECT * FROM completed_workouts WHERE id = ? AND user_id = ?')
    .get(id, auth.user.userId)
  return json(
    { item: row ? serializeCompletedWorkout(row, completedSetsForWorkout(id)) : null },
    { status: 201 }
  )
}
