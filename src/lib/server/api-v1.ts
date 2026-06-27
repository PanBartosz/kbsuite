import { json } from '@sveltejs/kit'
import crypto from 'node:crypto'
import YAML from 'yaml'
import { getDb, getUserForApiToken } from './db'

export type ApiUser = {
  userId: string
  username: string | null
  isAnonymous: boolean
}

export type ApiAuthResult = { user: ApiUser } | { response: Response }

export const hasOwn = (value: unknown, key: string) =>
  !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)

export const isSafeClientId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)

export const clientIdFromBody = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return null
  const id = value.trim()
  return isSafeClientId(id) ? id : null
}

export const apiError = (message: string, status = 400) => json({ error: message }, { status })

const bearerToken = (request: Request) => {
  const auth = request.headers.get('authorization') ?? ''
  const match = auth.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? ''
}

const tokenEquals = (received: string, expected: string) => {
  const receivedBuffer = Buffer.from(received)
  const expectedBuffer = Buffer.from(expected)
  if (receivedBuffer.length !== expectedBuffer.length) return false
  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
}

export const authorizeApiRequest = (request: Request): ApiAuthResult => {
  const receivedToken = bearerToken(request)
  if (!receivedToken) {
    return { response: apiError('Invalid API token', 401) }
  }

  const tokenUser = getUserForApiToken(receivedToken)
  if (tokenUser) {
    return { user: tokenUser }
  }

  const expectedToken = process.env.KB_SUITE_API_TOKEN?.trim()
  if (!expectedToken || !tokenEquals(receivedToken, expectedToken)) {
    return { response: apiError('Invalid API token', 401) }
  }

  const username = process.env.KB_SUITE_API_USERNAME?.trim()
  const configuredUserId = process.env.KB_SUITE_API_USER_ID?.trim()
  const db = getDb()
  const row = username
    ? (db
        .prepare('SELECT id, username, is_anonymous FROM users WHERE username = ?')
        .get(username) as any)
    : configuredUserId
      ? (db
          .prepare('SELECT id, username, is_anonymous FROM users WHERE id = ?')
          .get(configuredUserId) as any)
      : null

  if (!row) {
    return {
      response: apiError('API user is not configured or cannot be resolved', 503)
    }
  }

  return {
    user: {
      userId: row.id,
      username: row.username ?? null,
      isAnonymous: row.is_anonymous === 1
    }
  }
}

export const readJsonBody = async (request: Request) => request.json().catch(() => ({}))

export const safeParseJson = <T = any>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value !== 'string') return value as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export const parseTags = (value: unknown): string[] => {
  if (!value) return []
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(String(value))
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
      .filter(Boolean)
      .slice(0, 8)
  } catch {
    return typeof value === 'string' && value.trim() ? [value.trim()].slice(0, 8) : []
  }
}

export const parsePlanJson = (yamlSource?: string | null) => {
  if (!yamlSource) return null
  try {
    return YAML.parse(yamlSource) ?? null
  } catch {
    return null
  }
}

export const resolveTitle = (providedTitle: unknown, planJson: any, fallback = '') => {
  const fromBody = typeof providedTitle === 'string' ? providedTitle.trim() : ''
  const fromPlan = typeof planJson?.title === 'string' ? planJson.title.trim() : ''
  return fromBody || fromPlan || fallback
}

export const toFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

export const toInteger = (value: unknown): number | null => {
  const numberValue = toFiniteNumber(value)
  return numberValue === null ? null : Math.trunc(numberValue)
}

export const limitParam = (value: string | null, fallback: number, max: number) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.trunc(parsed), max)
}

export const offsetParam = (value: string | null) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.trunc(parsed)
}

export const serializeWorkout = (row: any) => ({
  id: row.id,
  name: row.name ?? '',
  description: row.description ?? '',
  yaml_source: row.yaml_source ?? '',
  plan_json: safeParseJson(row.plan_json, null),
  updated_at: row.updated_at ?? null,
  owner_id: row.owner_id ?? null,
  is_template: row.is_template === 1 || row.is_template === true
})

export const serializePlannedWorkout = (row: any) => ({
  id: row.id,
  planned_for: row.planned_for ?? null,
  title: row.title ?? '',
  yaml_source: row.yaml_source ?? '',
  plan_json: safeParseJson(row.plan_json, null),
  notes: row.notes ?? '',
  tags: parseTags(row.tags),
  created_at: row.created_at ?? null,
  updated_at: row.updated_at ?? null
})

export const serializeCompletedWorkout = (row: any, sets: any[] = []) => ({
  id: row.id,
  workout_id: row.workout_id ?? null,
  planned_workout_id: row.planned_workout_id ?? null,
  title: row.title ?? '',
  started_at: row.started_at ?? null,
  finished_at: row.finished_at ?? null,
  duration_s: row.duration_s ?? null,
  rpe: row.rpe ?? null,
  notes: row.notes ?? '',
  tags: parseTags(row.tags),
  created_at: row.created_at ?? null,
  sets: sets.map((set) => ({
    id: set.id,
    phase_index: set.phase_index ?? null,
    position: set.position ?? null,
    round_label: set.round_label ?? '',
    set_label: set.set_label ?? '',
    reps: set.reps ?? null,
    weight: set.weight ?? null,
    duration_s: set.duration_s ?? null,
    type: set.type ?? 'work',
    rpe: set.rpe ?? null,
    auto_filled: set.auto_filled === 1 || set.auto_filled === true
  }))
})

export const normalizeCompletedEntry = (entry: any, position: number) => {
  const repsValue =
    entry?.reps !== null && entry?.reps !== undefined
      ? Number(entry.reps)
      : entry?.loggedReps !== null && entry?.loggedReps !== undefined
        ? Number(entry.loggedReps)
        : null
  const weightValue =
    entry?.weight !== null && entry?.weight !== undefined ? Number(entry.weight) : null
  const durationValue = entry?.durationSeconds ?? entry?.duration_s
  return {
    id: crypto.randomUUID(),
    phase_index: Number.isInteger(entry?.phase_index)
      ? entry.phase_index
      : Number.isInteger(entry?.phaseIndex)
        ? entry.phaseIndex
        : null,
    position,
    round_label: entry?.round_label ?? entry?.roundLabel ?? '',
    set_label: entry?.set_label ?? entry?.setLabel ?? '',
    reps: Number.isFinite(repsValue) ? repsValue : null,
    weight: Number.isFinite(weightValue) ? weightValue : null,
    duration_s: toFiniteNumber(durationValue),
    type: entry?.type ?? 'work',
    rpe: toFiniteNumber(entry?.rpe),
    auto_filled: entry?.auto_filled || entry?.autoFilled ? 1 : 0
  }
}

export const insertCompletedSetRows = (
  db: ReturnType<typeof getDb>,
  completedWorkoutId: string,
  entries: any[]
) => {
  const insertSet = db.prepare(
    `INSERT INTO completed_sets
      (id, completed_workout_id, phase_index, position, round_label, set_label, reps, weight, duration_s, type, rpe, auto_filled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  entries.forEach((entry, index) => {
    const set = normalizeCompletedEntry(entry, index)
    insertSet.run(
      set.id,
      completedWorkoutId,
      set.phase_index,
      set.position,
      set.round_label,
      set.set_label,
      set.reps,
      set.weight,
      set.duration_s,
      set.type,
      set.rpe,
      set.auto_filled
    )
  })
}

export const completedSetsForWorkout = (completedWorkoutId: string) => {
  return getDb()
    .prepare('SELECT * FROM completed_sets WHERE completed_workout_id = ? ORDER BY position ASC')
    .all(completedWorkoutId) as any[]
}

export const requireOwnedWorkout = (id: string, userId: string) => {
  return getDb()
    .prepare('SELECT * FROM workouts WHERE id = ? AND (owner_id = ? OR is_template = 1)')
    .get(id, userId) as any
}

export const assertOwnedCompletedWorkout = (id: string, userId: string) => {
  const row = getDb()
    .prepare('SELECT id FROM completed_workouts WHERE id = ? AND user_id = ?')
    .get(id, userId)
  return !!row
}
