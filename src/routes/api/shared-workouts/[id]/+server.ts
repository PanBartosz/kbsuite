import { json } from '@sveltejs/kit'
import { clonePlannedToUser, ensureSessionUser, getDb, serializeInvite } from '$lib/server/db'

const COOKIE_NAME = 'kb_session'

export const PATCH = async ({ params, request, cookies }) => {
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
  const action = body?.action
  const plannedFor = Number(body?.plannedFor) || null

  const db = getDb()
  const invite = db
    .prepare(
      `SELECT i.*, su.username AS sender_username, ru.username AS recipient_username
       FROM shared_workout_invites i
       LEFT JOIN users su ON su.id = i.sender_id
       LEFT JOIN users ru ON ru.id = i.recipient_id
       WHERE i.id = ?`
    )
    .get(id)

  if (!invite) return json({ error: 'Not found' }, { status: 404 })
  if (invite.recipient_id !== session.userId) {
    return json({ error: 'Not allowed' }, { status: 403 })
  }

  const now = Date.now()

  if (action === 'seen') {
    db.prepare('UPDATE shared_workout_invites SET seen_at = ? WHERE id = ?').run(now, id)
    const updated = db
      .prepare(
        `SELECT i.*, su.username AS sender_username, ru.username AS recipient_username
         FROM shared_workout_invites i
         LEFT JOIN users su ON su.id = i.sender_id
         LEFT JOIN users ru ON ru.id = i.recipient_id
         WHERE i.id = ?`
      )
      .get(id)
    return json({ invite: updated ? serializeInvite(updated) : null })
  }

  if (invite.status !== 'pending') {
    return json({ error: 'Invite already handled' }, { status: 409 })
  }

  if (action === 'reject') {
    db.prepare(
      `UPDATE shared_workout_invites SET status = 'rejected', responded_at = ? WHERE id = ?`
    ).run(now, id)
    const updated = db
      .prepare(
        `SELECT i.*, su.username AS sender_username, ru.username AS recipient_username
         FROM shared_workout_invites i
         LEFT JOIN users su ON su.id = i.sender_id
         LEFT JOIN users ru ON ru.id = i.recipient_id
         WHERE i.id = ?`
      )
      .get(id)
    return json({ invite: updated ? serializeInvite(updated) : null })
  }

  if (action === 'accept') {
    const planned = clonePlannedToUser(invite, session.userId, plannedFor)
    db.prepare(
      `UPDATE shared_workout_invites SET status = 'accepted', responded_at = ? WHERE id = ?`
    ).run(now, id)
    const updated = db
      .prepare(
        `SELECT i.*, su.username AS sender_username, ru.username AS recipient_username
         FROM shared_workout_invites i
         LEFT JOIN users su ON su.id = i.sender_id
         LEFT JOIN users ru ON ru.id = i.recipient_id
         WHERE i.id = ?`
      )
      .get(id)
    return json({ invite: updated ? serializeInvite(updated) : null, planned })
  }

  return json({ error: 'Invalid action' }, { status: 400 })
}
