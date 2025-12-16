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

export const DELETE = async ({ params, cookies }) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  })
  const { id } = params
  if (!id) return json({ ok: false }, { status: 400 })
  const db = getDb()
  db.prepare('DELETE FROM completed_workouts WHERE id = ? AND user_id = ?').run(id, session.userId)
  return json({ ok: true })
}

export const PUT = async ({ params, request, cookies }) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  })
  const { id } = params
  if (!id) return json({ ok: false }, { status: 400 })

  const db = getDb()
  const owner = db
    .prepare('SELECT id FROM completed_workouts WHERE id = ? AND user_id = ?')
    .get(id, session.userId) as { id: string } | undefined
  if (!owner) return json({ error: 'Not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const { title, entries, startedAt, finishedAt, durationSeconds, notes, rpe, tags } = body ?? {}
  const entriesProvided =
    body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body as any, 'entries')

  if (entriesProvided && !Array.isArray(entries)) {
    return json({ error: 'entries must be an array' }, { status: 400 })
  }

  db.prepare(
    `UPDATE completed_workouts
      SET title = COALESCE(?, title),
          started_at = COALESCE(?, started_at),
          finished_at = COALESCE(?, finished_at),
          duration_s = COALESCE(?, duration_s),
          notes = COALESCE(?, notes),
          rpe = COALESCE(?, rpe),
          tags = COALESCE(?, tags)
      WHERE id = ?`
  ).run(
    typeof title === 'string' ? title : null,
    Number.isFinite(startedAt) ? startedAt : null,
    Number.isFinite(finishedAt) ? finishedAt : null,
    Number.isFinite(durationSeconds) ? durationSeconds : null,
    typeof notes === 'string' ? notes : null,
    Number.isFinite(rpe) ? rpe : null,
    tags ? JSON.stringify(safeParseTags(tags)) : null,
    id
  )

  if (entriesProvided) {
    db.prepare('DELETE FROM completed_sets WHERE completed_workout_id = ?').run(id)

    if (entries.length) {
      const insertSet = db.prepare(
        `INSERT INTO completed_sets
          (id, completed_workout_id, phase_index, position, round_label, set_label, reps, weight, duration_s, type, rpe, auto_filled)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      entries.forEach((entry: any, idx: number) => {
        const repsVal =
          entry?.reps !== null && entry?.reps !== undefined
            ? Number(entry.reps)
            : entry?.loggedReps !== undefined
              ? Number(entry.loggedReps)
              : null
        const reps = Number.isFinite(repsVal) ? repsVal : null
        const duration = entry?.duration_s ?? entry?.durationSeconds ?? null
        const type = entry?.type ?? 'work'
        const rpe = entry?.rpe ?? null
        insertSet.run(
          crypto.randomUUID(),
          id,
          Number.isInteger(entry?.phase_index)
            ? entry.phase_index
            : Number.isInteger(entry?.phaseIndex)
              ? entry.phaseIndex
              : null,
          idx,
          entry?.round_label ?? entry?.roundLabel ?? '',
          entry?.set_label ?? entry?.setLabel ?? '',
          reps,
          entry?.weight !== undefined && entry?.weight !== null ? Number(entry.weight) : null,
          duration,
          type,
          rpe,
          entry?.auto_filled ? 1 : 0
        )
      })
    }
  }

  const workout = db.prepare('SELECT * FROM completed_workouts WHERE id = ?').get(id) as any
  const sets = db
    .prepare('SELECT * FROM completed_sets WHERE completed_workout_id = ? ORDER BY position ASC')
    .all(id)
  return json({
    ok: true,
    item: workout ? { ...workout, tags: safeParseTags(workout.tags), sets } : null
  })
}
