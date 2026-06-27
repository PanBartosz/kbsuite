import { json } from '@sveltejs/kit'
import {
  apiError,
  assertOwnedCompletedWorkout,
  authorizeApiRequest,
  isSafeClientId
} from '$lib/server/api-v1'
import { deleteHrAttachment, readHrAttachment, saveHrAttachment } from '$lib/server/hr'
import { getDb } from '$lib/server/db'

const assertVisibleCompletedId = (id: string | undefined, userId: string) => {
  if (!id) return apiError('Missing id', 400)
  if (!isSafeClientId(id)) return apiError('Invalid id', 400)
  if (!assertOwnedCompletedWorkout(id, userId)) return apiError('Not found', 404)
  return null
}

export const GET = async ({ params, request, url }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const error = assertVisibleCompletedId(params.id, auth.user.userId)
  if (error) return error

  const details = url.searchParams.get('details') === '1'
  const full = url.searchParams.get('full') === '1'
  return json(await readHrAttachment(params.id, { details, full }))
}

export const POST = async ({ params, request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const error = assertVisibleCompletedId(params.id, auth.user.userId)
  if (error) return error

  const form = await request.formData()
  const file = form.get('file') as File | null
  if (!file) return apiError('No file provided', 400)

  try {
    const saved = await saveHrAttachment(params.id, file)
    if (saved.summary?.startTime && saved.summary?.durationSeconds) {
      getDb()
        .prepare(
          `UPDATE completed_workouts
           SET started_at = ?, finished_at = ?, duration_s = ?
           WHERE id = ? AND user_id = ?`
        )
        .run(
          saved.summary.startTime,
          saved.summary.startTime + saved.summary.durationSeconds * 1000,
          saved.summary.durationSeconds,
          params.id,
          auth.user.userId
        )
    }
    return json({ ok: true, filename: saved.filename, summary: saved.summary })
  } catch (error) {
    return apiError((error as any)?.message ?? 'Failed to save HR file', 400)
  }
}

export const DELETE = async ({ params, request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const error = assertVisibleCompletedId(params.id, auth.user.userId)
  if (error) return error

  await deleteHrAttachment(params.id)
  return json({ ok: true })
}
