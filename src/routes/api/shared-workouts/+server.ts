import { json } from '@sveltejs/kit'
import { ensureSessionUser, getDb, serializeInvite } from '$lib/server/db'

const COOKIE_NAME = 'kb_session'

export const GET = async ({ url, cookies }) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  })

  const scopeParam = url.searchParams.get('scope') || 'incoming'
  const status = url.searchParams.get('status')
  const incoming = scopeParam !== 'sent'

  const db = getDb()
  const conditions = []
  const params: any[] = []

  if (incoming) {
    conditions.push('recipient_id = ?')
    params.push(session.userId)
  } else {
    conditions.push('sender_id = ?')
    params.push(session.userId)
  }

  if (status) {
    conditions.push('status = ?')
    params.push(status)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db
    .prepare(
      `SELECT i.*, su.username AS sender_username, ru.username AS recipient_username
       FROM shared_workout_invites i
       LEFT JOIN users su ON su.id = i.sender_id
       LEFT JOIN users ru ON ru.id = i.recipient_id
       ${where}
       ORDER BY created_at DESC
       LIMIT 200`
    )
    .all(...params)

  const items = rows.map((row: any) => serializeInvite(row))
  const pendingCountRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM shared_workout_invites WHERE recipient_id = ? AND status = 'pending'`
    )
    .get(session.userId) as { cnt: number }

  return json({ items, pendingCount: pendingCountRow?.cnt ?? 0 })
}
