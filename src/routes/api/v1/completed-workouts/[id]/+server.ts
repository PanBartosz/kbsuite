import { json } from '@sveltejs/kit'
import {
  apiError,
  authorizeApiRequest,
  completedSetsForWorkout,
  hasOwn,
  insertCompletedSetRows,
  parseTags,
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

export const GET = async ({ params, request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const id = params.id
  if (!id) return apiError('Missing id', 400)
  const row = getDb()
    .prepare('SELECT * FROM completed_workouts WHERE id = ? AND user_id = ?')
    .get(id, auth.user.userId)
  if (!row) return apiError('Not found', 404)
  return json({ item: serializeCompletedWorkout(row, completedSetsForWorkout(id)) })
}

export const PUT = async ({ params, request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const id = params.id
  if (!id) return apiError('Missing id', 400)
  const db = getDb()
  const existing = db
    .prepare('SELECT * FROM completed_workouts WHERE id = ? AND user_id = ?')
    .get(id, auth.user.userId) as any
  if (!existing) return apiError('Not found', 404)

  const body = await request.json().catch(() => ({}))
  const entriesProvided = hasOwn(body, 'entries') || hasOwn(body, 'sets')
  const entries = hasOwn(body, 'entries') ? body.entries : hasOwn(body, 'sets') ? body.sets : []
  if (entriesProvided && !Array.isArray(entries)) {
    return apiError('entries must be an array', 400)
  }

  const workoutId =
    hasOwn(body, 'workoutId') || hasOwn(body, 'workout_id')
      ? normalizeOptionalId(body.workoutId ?? body.workout_id)
      : (existing.workout_id ?? null)
  const plannedWorkoutId =
    hasOwn(body, 'plannedWorkoutId') || hasOwn(body, 'planned_workout_id')
      ? normalizeOptionalId(body.plannedWorkoutId ?? body.planned_workout_id)
      : (existing.planned_workout_id ?? null)
  if (!assertWorkoutVisible(workoutId, auth.user.userId)) return apiError('Workout not found', 404)
  if (!assertPlannedVisible(plannedWorkoutId, auth.user.userId)) {
    return apiError('Planned workout not found', 404)
  }

  const title = hasOwn(body, 'title') ? String(body.title ?? '') : (existing.title ?? '')
  const startedAt =
    hasOwn(body, 'startedAt') || hasOwn(body, 'started_at')
      ? toFiniteNumber(body.startedAt ?? body.started_at)
      : (existing.started_at ?? null)
  const finishedAt =
    hasOwn(body, 'finishedAt') || hasOwn(body, 'finished_at')
      ? toFiniteNumber(body.finishedAt ?? body.finished_at)
      : (existing.finished_at ?? null)
  const durationSeconds =
    hasOwn(body, 'durationSeconds') || hasOwn(body, 'duration_s')
      ? toFiniteNumber(body.durationSeconds ?? body.duration_s)
      : (existing.duration_s ?? null)
  const notes = hasOwn(body, 'notes') ? String(body.notes ?? '') : (existing.notes ?? '')
  const rpe = hasOwn(body, 'rpe') ? toFiniteNumber(body.rpe) : (existing.rpe ?? null)
  const tags = hasOwn(body, 'tags') ? parseTags(body.tags) : parseTags(existing.tags)

  const transaction = db.transaction(() => {
    db.prepare(
      `UPDATE completed_workouts
       SET workout_id = ?,
           planned_workout_id = ?,
           title = ?,
           started_at = ?,
           finished_at = ?,
           duration_s = ?,
           notes = ?,
           rpe = ?,
           tags = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      workoutId,
      plannedWorkoutId,
      title,
      startedAt,
      finishedAt,
      durationSeconds,
      notes,
      rpe,
      JSON.stringify(tags),
      id,
      auth.user.userId
    )

    if (entriesProvided) {
      db.prepare('DELETE FROM completed_sets WHERE completed_workout_id = ?').run(id)
      insertCompletedSetRows(db, id, entries)
    }
  })
  transaction()

  if (entriesProvided || plannedWorkoutId !== existing.planned_workout_id) {
    const metricEntries = entriesProvided ? entries : completedSetsForWorkout(id)
    syncProgramWorkoutCompletion({
      plannedWorkoutId,
      completedWorkoutId: id,
      userId: auth.user.userId,
      actualMetrics: computeCompletedProgramMetrics(metricEntries)
    })
  }

  const row = db
    .prepare('SELECT * FROM completed_workouts WHERE id = ? AND user_id = ?')
    .get(id, auth.user.userId)
  return json({ item: row ? serializeCompletedWorkout(row, completedSetsForWorkout(id)) : null })
}

export const DELETE = async ({ params, request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const id = params.id
  if (!id) return apiError('Missing id', 400)
  const result = getDb()
    .prepare('DELETE FROM completed_workouts WHERE id = ? AND user_id = ?')
    .run(id, auth.user.userId)
  if (result.changes === 0) return apiError('Not found', 404)
  return json({ ok: true })
}
