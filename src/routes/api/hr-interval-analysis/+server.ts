import { json } from '@sveltejs/kit'
import { ensureSessionUser, getDb } from '$lib/server/db'

const COOKIE_NAME = 'kb_session'

const withSession = (cookies: any) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  })
  return session
}

const safeJsonParse = (raw: unknown) => {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const GET = async ({ cookies }) => {
  const session = withSession(cookies)
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT
        a.completed_workout_id as id,
        a.version as version,
        a.settings_json as settings_json,
        a.updated_at as analysis_updated_at,
        w.title as title,
        w.started_at as started_at,
        w.duration_s as duration_s,
        w.created_at as created_at
      FROM hr_interval_analysis a
      JOIN completed_workouts w ON w.id = a.completed_workout_id
      WHERE a.user_id = ?
      ORDER BY COALESCE(w.started_at, w.created_at) DESC`
    )
    .all(session.userId) as any[]

  const items = rows.map((r) => {
    const settings = safeJsonParse(r.settings_json) ?? {}
    const block = settings?.block ?? null
    const config = settings?.config ?? null
    return {
      id: r.id,
      title: r.title ?? '',
      started_at: r.started_at ?? null,
      duration_s: r.duration_s ?? null,
      created_at: r.created_at ?? null,
      version: r.version ?? 'v1',
      analysis_updated_at: r.analysis_updated_at ?? null,
      block,
      config
    }
  })

  return json({ items })
}

