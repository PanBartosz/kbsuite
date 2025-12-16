import { json } from '@sveltejs/kit'
import { ensureSessionUser, getDb, serializePlanned } from '$lib/server/db'
import crypto from 'node:crypto'
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

export const GET = async ({ cookies, url }) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  })
  const db = getDb()
  const start = Number(url.searchParams.get('start')) || 0
  const end = Number(url.searchParams.get('end')) || 0
  let rows: any[] = []
  if (start && end) {
    rows = db
      .prepare(
        'SELECT * FROM planned_workouts WHERE user_id = ? AND planned_for BETWEEN ? AND ? ORDER BY planned_for ASC'
      )
      .all(session.userId, start, end)
  } else {
    rows = db
      .prepare('SELECT * FROM planned_workouts WHERE user_id = ? ORDER BY planned_for ASC LIMIT 500')
      .all(session.userId)
  }
  return json({ items: rows.map(serializePlanned) })
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
  const { id, title, plannedFor, yaml_source, notes, tags } = body ?? {}
  const planned_for = Number(plannedFor) || null
  if (!planned_for) return json({ error: 'plannedFor required' }, { status: 400 })
  const yamlSource = typeof yaml_source === 'string' ? yaml_source : ''
  const planJson = parsePlanJson(yamlSource)
  const db = getDb()
  const now = Date.now()
  const tagList = parseTags(tags)
  const requestedId = typeof id === 'string' && id.trim().length ? id.trim() : null
  const planId = requestedId ?? crypto.randomUUID()

  const existing = db
    .prepare('SELECT user_id FROM planned_workouts WHERE id = ?')
    .get(planId) as { user_id: string } | undefined
  if (existing && existing.user_id !== session.userId) {
    return json({ error: 'Not found' }, { status: 404 })
  }

  if (existing) {
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
      planned_for,
      title ?? '',
      yamlSource,
      planJson ? JSON.stringify(planJson) : null,
      notes ?? '',
      JSON.stringify(tagList),
      now,
      planId,
      session.userId
    )
  } else {
    db.prepare(
      `INSERT INTO planned_workouts
        (id, user_id, planned_for, title, yaml_source, plan_json, notes, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      planId,
      session.userId,
      planned_for,
      title ?? '',
      yamlSource,
      planJson ? JSON.stringify(planJson) : null,
      notes ?? '',
      JSON.stringify(tagList),
      now,
      now
    )
  }

  const row = db
    .prepare('SELECT * FROM planned_workouts WHERE id = ? AND user_id = ?')
    .get(planId, session.userId)
  return json({ item: row ? serializePlanned(row) : null })
}
