import { json } from '@sveltejs/kit'
import {
  apiError,
  authorizeApiRequest,
  readJsonBody
} from '$lib/server/api-v1'
import { getSettingsForUser, saveSettingsForUser } from '$lib/server/db'

export const GET = async ({ request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response
  return json({ settings: getSettingsForUser(auth.user.userId) })
}

export const PUT = async ({ request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const body = await readJsonBody(request)
  const settings = body && typeof body === 'object' && body.settings ? body.settings : body
  if (!settings || typeof settings !== 'object') {
    return apiError('settings object required', 400)
  }

  saveSettingsForUser(auth.user.userId, settings)
  return json({ ok: true, settings: getSettingsForUser(auth.user.userId) })
}
