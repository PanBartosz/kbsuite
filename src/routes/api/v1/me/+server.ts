import { json } from '@sveltejs/kit'
import { authorizeApiRequest } from '$lib/server/api-v1'

export const GET = async ({ request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response
  return json({
    userId: auth.user.userId,
    username: auth.user.username,
    isAnonymous: auth.user.isAnonymous
  })
}
