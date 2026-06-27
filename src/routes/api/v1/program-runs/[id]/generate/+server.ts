import { json } from '@sveltejs/kit'
import crypto from 'node:crypto'
import {
  apiError,
  authorizeApiRequest,
  parsePlanJson,
  serializePlannedWorkout
} from '$lib/server/api-v1'
import { getDb } from '$lib/server/db'
import { getProgramAdapter } from '$lib/programming/registry'
import { getProgramRunForUser } from '$lib/server/programming'

export const POST = async ({ params, request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const id = params.id
  if (!id) return apiError('Missing id', 400)
  const db = getDb()
  const run = db
    .prepare('SELECT * FROM program_runs WHERE id = ? AND user_id = ?')
    .get(id, auth.user.userId) as any
  if (!run) return apiError('Not found', 404)

  const existing = db
    .prepare('SELECT COUNT(*) AS count FROM program_workouts WHERE program_run_id = ? AND user_id = ?')
    .get(id, auth.user.userId) as { count: number }
  if (existing.count > 0) {
    return json(
      {
        error: 'This program run already has generated planner entries.',
        item: getProgramRunForUser(id, auth.user.userId)
      },
      { status: 409 }
    )
  }

  const adapter = getProgramAdapter(run.kind)
  if (!adapter) return apiError('Unsupported program kind', 400)
  const spec = adapter.normalizeSpec(JSON.parse(run.spec_json))
  const drafts = adapter.generateWorkouts(spec, { runId: id })
  const now = Date.now()

  const insertPlanned = db.prepare(
    `INSERT INTO planned_workouts
      (id, user_id, planned_for, title, yaml_source, plan_json, notes, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertProgramWorkout = db.prepare(
    `INSERT INTO program_workouts
      (id, program_run_id, user_id, planned_workout_id, completed_workout_id, cycle_index, day_index,
       role, title, planned_for, planned_metrics_json, actual_metrics_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, 'planned', ?, ?)`
  )

  const plannedRows: any[] = []
  const transaction = db.transaction(() => {
    drafts.forEach((draft) => {
      const plannedId = crypto.randomUUID()
      const programWorkoutId = crypto.randomUUID()
      const planJson = parsePlanJson(draft.yamlSource)
      insertPlanned.run(
        plannedId,
        auth.user.userId,
        draft.plannedFor,
        draft.title,
        draft.yamlSource,
        planJson ? JSON.stringify(planJson) : null,
        draft.notes ?? '',
        JSON.stringify(draft.tags ?? []),
        now,
        now
      )
      insertProgramWorkout.run(
        programWorkoutId,
        id,
        auth.user.userId,
        plannedId,
        draft.cycleIndex,
        draft.dayIndex,
        draft.role,
        draft.title,
        draft.plannedFor,
        JSON.stringify(draft.plannedMetrics ?? {}),
        now,
        now
      )
      const row = db.prepare('SELECT * FROM planned_workouts WHERE id = ?').get(plannedId)
      if (row) plannedRows.push(serializePlannedWorkout(row))
    })

    db.prepare(
      `UPDATE program_runs
       SET status = 'planned',
           state_json = ?,
           updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      JSON.stringify({ generatedAt: now, generatedWorkoutCount: drafts.length }),
      now,
      id,
      auth.user.userId
    )
  })

  transaction()

  return json({ item: getProgramRunForUser(id, auth.user.userId), planned: plannedRows })
}
