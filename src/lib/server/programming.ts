import { getDb } from './db'
import { summarizeProgramWorkouts } from '$lib/programming/metrics'

const parseJson = (value: unknown, fallback: any = null) => {
  if (!value) return fallback
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export const serializeProgramWorkout = (row: any) => ({
  id: row.id,
  program_run_id: row.program_run_id,
  planned_workout_id: row.planned_workout_id ?? null,
  completed_workout_id: row.completed_workout_id ?? null,
  cycle_index: row.cycle_index,
  day_index: row.day_index,
  role: row.role ?? '',
  title: row.title ?? '',
  planned_for: row.planned_for ?? null,
  status: row.status ?? 'generated',
  planned_metrics: parseJson(row.planned_metrics_json, {}),
  actual_metrics: parseJson(row.actual_metrics_json, null),
  created_at: row.created_at,
  updated_at: row.updated_at
})

export const serializeProgramRun = (row: any, workoutRows: any[] = []) => {
  const workouts = workoutRows.map(serializeProgramWorkout)
  return {
    id: row.id,
    kind: row.kind,
    title: row.title ?? '',
    spec: parseJson(row.spec_json, {}),
    state: parseJson(row.state_json, {}),
    status: row.status ?? 'draft',
    started_at: row.started_at ?? null,
    ended_at: row.ended_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    workouts,
    summary: summarizeProgramWorkouts(workouts)
  }
}

export const getProgramRunForUser = (id: string, userId: string) => {
  const db = getDb()
  const run = db
    .prepare('SELECT * FROM program_runs WHERE id = ? AND user_id = ?')
    .get(id, userId) as any
  if (!run) return null
  const workouts = db
    .prepare(
      `SELECT * FROM program_workouts
       WHERE program_run_id = ? AND user_id = ?
       ORDER BY cycle_index ASC, day_index ASC, planned_for ASC`
    )
    .all(id, userId) as any[]
  return serializeProgramRun(run, workouts)
}

export const syncProgramWorkoutCompletion = ({
  plannedWorkoutId,
  completedWorkoutId,
  userId,
  actualMetrics
}: {
  plannedWorkoutId?: string | null
  completedWorkoutId: string
  userId: string
  actualMetrics: any
}) => {
  if (!plannedWorkoutId) return
  const db = getDb()
  const now = Date.now()
  const result = db
    .prepare(
      `UPDATE program_workouts
       SET completed_workout_id = ?,
           actual_metrics_json = ?,
           status = 'completed',
           updated_at = ?
       WHERE planned_workout_id = ? AND user_id = ?`
    )
    .run(completedWorkoutId, JSON.stringify(actualMetrics ?? {}), now, plannedWorkoutId, userId)
  if (result.changes > 0) {
    db.prepare(
      `UPDATE program_runs
       SET status = CASE WHEN status IN ('draft', 'planned') THEN 'active' ELSE status END,
           updated_at = ?
       WHERE id IN (
         SELECT program_run_id FROM program_workouts WHERE planned_workout_id = ? AND user_id = ?
       )`
    ).run(now, plannedWorkoutId, userId)
  }
}
