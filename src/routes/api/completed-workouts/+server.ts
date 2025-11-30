import { json } from '@sveltejs/kit'
import { ensureSessionUser, getDb } from '$lib/server/db'
import crypto from 'node:crypto'

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

const serializeCompleted = (row: any, sets: any[]) => ({
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
    .prepare('SELECT * FROM completed_workouts WHERE user_id = ? ORDER BY created_at DESC LIMIT 200')
    .all(session.userId) as any[]

  const setsStmt = db.prepare(
    'SELECT * FROM completed_sets WHERE completed_workout_id = ? ORDER BY position ASC'
  )
  const items = rows.map((row) => serializeCompleted(row, setsStmt.all(row.id)))
  return json({ items })
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
  const {
    workoutId,
    title,
    startedAt,
    finishedAt,
    durationSeconds,
    notes,
    rpe,
    tags,
    entries
  } = body ?? {}

  const id = crypto.randomUUID()
  const db = getDb()
  const now = Date.now()
  const tagList = safeParseTags(tags)

  db.prepare(
    `INSERT INTO completed_workouts
      (id, user_id, workout_id, title, started_at, finished_at, duration_s, notes, rpe, tags, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    session.userId,
    workoutId ?? null,
    title ?? '',
    startedAt ?? null,
    finishedAt ?? null,
    durationSeconds ?? null,
    notes ?? '',
    rpe ?? null,
    JSON.stringify(tagList),
    now
  )

  const insertSet = db.prepare(
    `INSERT INTO completed_sets
      (id, completed_workout_id, phase_index, position, round_label, set_label, reps, weight, duration_s, type, rpe, auto_filled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  if (Array.isArray(entries)) {
    entries.forEach((entry, idx) => {
      const type = entry?.type ?? 'work'
      const repsVal =
        entry?.reps !== null && entry?.reps !== undefined
          ? Number(entry.reps)
          : entry?.loggedReps !== null && entry?.loggedReps !== undefined
            ? Number(entry.loggedReps)
            : null
      const reps = Number.isFinite(repsVal) ? repsVal : null
      const weight =
        entry?.weight !== undefined && entry?.weight !== null ? Number(entry.weight) : null
      const duration = entry?.durationSeconds ?? entry?.duration_s ?? null
      const rpe = entry?.rpe ?? null

      insertSet.run(
        crypto.randomUUID(),
        id,
        Number.isInteger(entry?.phaseIndex)
          ? entry.phaseIndex
          : Number.isInteger(entry?.phase_index)
            ? entry.phase_index
            : null,
        idx,
        entry?.roundLabel ?? entry?.round_label ?? '',
        entry?.setLabel ?? entry?.set_label ?? '',
        reps,
        weight,
        duration,
        type,
        rpe,
        entry?.autoFilled ? 1 : 0
      )
    })
  }

  const workout = db.prepare('SELECT * FROM completed_workouts WHERE id = ?').get(id)
  const sets = db
    .prepare('SELECT * FROM completed_sets WHERE completed_workout_id = ? ORDER BY position ASC')
    .all(id)
  return json({ item: serializeCompleted(workout, sets) })
}
