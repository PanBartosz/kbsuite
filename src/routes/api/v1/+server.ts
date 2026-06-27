import { json } from '@sveltejs/kit'

export const GET = async () =>
  json({
    name: 'KB Suite External API',
    version: 'v1',
    description:
      'Use this API with a per-user bearer token generated in KB Suite Account -> API tokens.',
    authentication: {
      type: 'http-bearer',
      header: 'Authorization: Bearer <token>',
      token_ui: '/auth',
      note: 'Discovery endpoints are public. Data endpoints require a bearer token.'
    },
    discovery: {
      openapi_json: '/api/v1/openapi.json',
      openapi_alias: '/api/v1/openapi'
    },
    endpoints: {
      me: '/api/v1/me',
      settings: '/api/v1/settings',
      workouts: '/api/v1/workouts',
      planned_workouts: '/api/v1/planned-workouts',
      completed_workouts: '/api/v1/completed-workouts',
      program_runs: '/api/v1/program-runs'
    },
    example: {
      curl: 'curl -H "Authorization: Bearer kb_your_token" https://kb.bartoszmackiewicz.pl/api/v1/me'
    }
  })
