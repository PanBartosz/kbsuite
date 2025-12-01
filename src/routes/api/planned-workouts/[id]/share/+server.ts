import { json } from '@sveltejs/kit'
import {
  ensureSessionUser,
  findUserByUsername,
  getDb,
  serializeInvite
} from '$lib/server/db'
import crypto from 'node:crypto'
import YAML from 'yaml'

const COOKIE_NAME = 'kb_session'

const parsePlanJson = (yamlSource?: string | null, fallback?: any) => {
  if (fallback) return fallback
  if (!yamlSource) return null
  try {
    const parsed = YAML.parse(yamlSource)
    return parsed ?? null
  } catch {
    return null
  }
}

export const POST = async ({ params, request, cookies }) => {
  const session = ensureSessionUser(cookies.get(COOKIE_NAME))
  cookies.set(COOKIE_NAME, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365
  })

  if (session.isAnonymous) {
    return json({ error: 'Login required to share workouts' }, { status: 401 })
  }

  const { id } = params
  if (!id) return json({ error: 'Missing id' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const recipientUsername = typeof body?.recipientUsername === 'string' ? body.recipientUsername.trim() : ''
  const plannedForOverride = Number(body?.plannedFor) || null
  const message =
    typeof body?.message === 'string' ? body.message.trim().slice(0, 240) : ''

  if (!recipientUsername) {
    return json({ error: 'recipientUsername required' }, { status: 400 })
  }

  const db = getDb()
  const planned = db
    .prepare('SELECT * FROM planned_workouts WHERE id = ? AND user_id = ?')
    .get(id, session.userId) as
    | {
        id: string
        title?: string
        yaml_source?: string
        plan_json?: string | null
        planned_for?: number | null
        notes?: string
        tags?: string | null
      }
    | undefined
  if (!planned) return json({ error: 'Planned workout not found' }, { status: 404 })

  const recipient = findUserByUsername(recipientUsername)
  if (!recipient) return json({ error: 'Recipient not found' }, { status: 404 })
  if (recipient.id === session.userId) {
    return json({ error: 'Cannot share with yourself' }, { status: 400 })
  }

  let parsedJson: any = null
  try {
    if (planned.plan_json) {
      parsedJson =
        typeof planned.plan_json === 'string'
          ? JSON.parse(planned.plan_json)
          : planned.plan_json
    }
  } catch {
    parsedJson = null
  }
  parsedJson = parsePlanJson(planned.yaml_source, parsedJson)

  const now = Date.now()
  const inviteId = crypto.randomUUID()

  db.prepare(
    `INSERT INTO shared_workout_invites
      (id, sender_id, recipient_id, source_planned_id, title, yaml_source, plan_json, planned_for, notes, tags, message, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(
    inviteId,
    session.userId,
    recipient.id,
    planned.id,
    planned.title ?? '',
    planned.yaml_source ?? '',
    parsedJson ? JSON.stringify(parsedJson) : null,
    plannedForOverride || planned.planned_for || null,
    planned.notes ?? '',
    typeof planned.tags === 'string' ? planned.tags : JSON.stringify(planned.tags ?? []),
    message,
    now
  )

  const row = db
    .prepare(
      `SELECT i.*, su.username as sender_username, ru.username as recipient_username
       FROM shared_workout_invites i
       LEFT JOIN users su ON su.id = i.sender_id
       LEFT JOIN users ru ON ru.id = i.recipient_id
       WHERE i.id = ?`
    )
    .get(inviteId)
  const pendingCount = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM shared_workout_invites WHERE recipient_id = ? AND status = 'pending'`
    )
    .get(recipient.id) as { cnt: number }

  return json({
    invite: row ? serializeInvite(row) : null,
    pendingCount: pendingCount?.cnt ?? 0
  })
}
