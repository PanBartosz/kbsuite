import { json } from '@sveltejs/kit'
import { apiError, authorizeApiRequest } from '$lib/server/api-v1'
import { getDb } from '$lib/server/db'
import { getProgramRunForUser } from '$lib/server/programming'

export const GET = async ({ params, request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const id = params.id
  if (!id) return apiError('Missing id', 400)
  const item = getProgramRunForUser(id, auth.user.userId)
  if (!item) return apiError('Not found', 404)
  return json({ item })
}

export const DELETE = async ({ params, request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const id = params.id
  if (!id) return apiError('Missing id', 400)
  const result = getDb()
    .prepare('DELETE FROM program_runs WHERE id = ? AND user_id = ?')
    .run(id, auth.user.userId)
  if (result.changes === 0) return apiError('Not found', 404)
  return json({ ok: true })
}
