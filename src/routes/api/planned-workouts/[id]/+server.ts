import { json } from '@sveltejs/kit'
import { ensureSessionUser, getDb, serializePlanned } from '$lib/server/db'
import YAML from 'yaml'

const COOKIE_NAME = 'kb_session'

const parseTags = (value: any): string[] => {
  if (!value) return []
  try {
    const arr = Array.isArray(value) ? value : JSON.parse(String(value))
    if (!Array.isArray(arr)) return []
    return arr
      .map((t) => (typeof t === 'string' ? t.trim() : ''))
      .filter(Boolean)
      .slice(0, 8)
  } catch {
    return []
  }
}

const parsePlanJson = (yamlSource?: string | null) => {
  if (!yamlSource) return null
  try {
    const parsed = YAML.parse(yamlSource)
    return parsed ?? null
  } catch {
    return null
  }
}

export const GET = async ({ params, cookies }) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  })
  const { id } = params
  if (!id) return json({ error: 'Missing id' }, { status: 400 })
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM planned_workouts WHERE id = ? AND user_id = ?')
    .get(id, session.userId)
  if (!row) return json({ error: 'Not found' }, { status: 404 })
  return json({ item: serializePlanned(row) })
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
  if (!id) return json({ error: 'Missing id' }, { status: 400 })
  const db = getDb()
  db.prepare('DELETE FROM planned_workouts WHERE id = ? AND user_id = ?').run(id, session.userId)
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
  if (!id) return json({ error: 'Missing id' }, { status: 400 })
  const body = await request.json().catch(() => ({}))
  const { title, plannedFor, yaml_source, notes, tags } = body ?? {}
  const planned_for = Number(plannedFor) || null
  if (!planned_for) return json({ error: 'plannedFor required' }, { status: 400 })
  const yamlSource = typeof yaml_source === 'string' ? yaml_source : ''
  const planJson = parsePlanJson(yamlSource)
  const tagList = parseTags(tags)
  const db = getDb()
  const now = Date.now()
  const owned = db
    .prepare('SELECT id FROM planned_workouts WHERE id = ? AND user_id = ?')
    .get(id, session.userId)
  if (!owned) return json({ error: 'Not found' }, { status: 404 })

  db.prepare(
    `UPDATE planned_workouts
     SET planned_for = ?,
         title = ?,
         yaml_source = ?,
         plan_json = ?,
         notes = ?,
         tags = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    planned_for,
    title ?? '',
    yamlSource,
    planJson ? JSON.stringify(planJson) : null,
    notes ?? '',
    JSON.stringify(tagList),
    now,
    id
  )
  const row = db.prepare('SELECT * FROM planned_workouts WHERE id = ?').get(id)
  return json({ item: row ? serializePlanned(row) : null })
}
