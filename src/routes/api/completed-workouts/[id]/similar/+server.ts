import { json } from '@sveltejs/kit'
import { ensureSessionUser, getDb } from '$lib/server/db'
import { rankSimilarWorkouts, type CompletedWorkoutLike } from '$lib/stats/workoutSimilarity'

const COOKIE_NAME = 'kb_session'

const safeParseTags = (value: any): string[] => {
  if (!value) return []
  try {
    if (Array.isArray(value)) {
      return value
        .map((t) => (typeof t === 'string' ? t.trim() : ''))
        .filter(Boolean)
        .slice(0, 8)
    }
    const parsed = JSON.parse(String(value))
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((t) => (typeof t === 'string' ? t.trim() : ''))
      .filter(Boolean)
      .slice(0, 8)
  } catch {
    return []
  }
}

const serializeCompleted = (row: any, sets: any[]): CompletedWorkoutLike => ({
  id: row.id,
  workout_id: row.workout_id ?? null,
  title: row.title ?? '',
  started_at: row.started_at ?? null,
  finished_at: row.finished_at ?? null,
  duration_s: row.duration_s ?? null,
  rpe: row.rpe ?? null,
  notes: row.notes ?? '',
  tags: safeParseTags(row.tags),
  created_at: row.created_at,
  sets: sets.map((s) => ({
    phase_index: s.phase_index,
    position: s.position,
    round_label: s.round_label,
    set_label: s.set_label,
    reps: s.reps,
    weight: s.weight,
    duration_s: s.duration_s,
    type: s.type,
    rpe: s.rpe ?? null,
    auto_filled: !!s.auto_filled
  }))
})

export const GET = async ({ params, cookies, url }) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  })
  const id = params.id
  if (!id) return json({ error: 'Missing id' }, { status: 400 })

  const poolRaw = Number(url.searchParams.get('pool'))
  const poolLimit = Math.min(
    500,
    Math.max(50, Number.isFinite(poolRaw) && poolRaw > 0 ? poolRaw : 200)
  )
  const takeRaw = Number(url.searchParams.get('limit'))
  const takeLimit = Math.min(
    12,
    Math.max(3, Number.isFinite(takeRaw) && takeRaw > 0 ? takeRaw : 5)
  )

  const db = getDb()
  const targetRow = db
    .prepare('SELECT * FROM completed_workouts WHERE id = ? AND user_id = ?')
    .get(id, session.userId) as any
  if (!targetRow) return json({ error: 'Not found' }, { status: 404 })

  const setsStmt = db.prepare(
    'SELECT * FROM completed_sets WHERE completed_workout_id = ? ORDER BY position ASC'
  )
  const target = serializeCompleted(targetRow, setsStmt.all(id))

  const rows = db
    .prepare(
      'SELECT * FROM completed_workouts WHERE user_id = ? AND id != ? ORDER BY created_at DESC LIMIT ?'
    )
    .all(session.userId, id, poolLimit) as any[]

  const candidates: CompletedWorkoutLike[] = rows.map((row) =>
    serializeCompleted(row, setsStmt.all(row.id))
  )

  const ranked = rankSimilarWorkouts(target, candidates, { limit: takeLimit })

  return json({
    source: target,
    suggestions: ranked.map((r) => ({
      workout: r.workout,
      score: Number(r.score.toFixed(3)),
      reasons: r.reasons.slice(0, 4),
      totals: r.fingerprint.totals
    }))
  })
}
