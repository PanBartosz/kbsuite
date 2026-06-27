import { json } from '@sveltejs/kit'
import { authorizeApiRequest } from '$lib/server/api-v1'

const resourceList = (name: string, tag: string, schema: string) => ({
  get: {
    tags: [tag],
    summary: `List ${name}`,
    security: [{ bearerAuth: [] }],
    responses: {
      '200': {
        description: 'Collection response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                items: { type: 'array', items: { $ref: `#/components/schemas/${schema}` } },
                total: { type: 'integer' }
              }
            }
          }
        }
      }
    }
  },
  post: {
    tags: [tag],
    summary: `Create ${name}`,
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}Input` } } }
    },
    responses: {
      '201': { $ref: `#/components/responses/${schema}Item` },
      '400': { $ref: '#/components/responses/Error' },
      '401': { $ref: '#/components/responses/Error' }
    }
  }
})

const idParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' }
}

const resourceItem = (name: string, tag: string, schema: string) => ({
  get: {
    tags: [tag],
    summary: `Get ${name}`,
    security: [{ bearerAuth: [] }],
    parameters: [idParameter],
    responses: {
      '200': { $ref: `#/components/responses/${schema}Item` },
      '404': { $ref: '#/components/responses/Error' }
    }
  },
  put: {
    tags: [tag],
    summary: `Update ${name}`,
    security: [{ bearerAuth: [] }],
    parameters: [idParameter],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}Input` } } }
    },
    responses: {
      '200': { $ref: `#/components/responses/${schema}Item` },
      '400': { $ref: '#/components/responses/Error' },
      '404': { $ref: '#/components/responses/Error' }
    }
  },
  delete: {
    tags: [tag],
    summary: `Delete ${name}`,
    security: [{ bearerAuth: [] }],
    parameters: [idParameter],
    responses: {
      '200': { $ref: '#/components/responses/Ok' },
      '404': { $ref: '#/components/responses/Error' }
    }
  }
})

const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'KB Suite External API',
    version: '1.0.0',
    description: 'Bearer-token API for trusted agents, scripts, and local integrations. Generate per-user tokens from the Account page.'
  },
  paths: {
    '/api/v1/openapi.json': {
      get: {
        tags: ['Discovery'],
        summary: 'Get this OpenAPI document',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'OpenAPI document' } }
      }
    },
    '/api/v1/me': {
      get: {
        tags: ['Session'],
        summary: 'Get configured API user',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'API user',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Me' } }
            }
          }
        }
      }
    },
    '/api/v1/settings': {
      get: {
        tags: ['Settings'],
        summary: 'Get settings',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Settings response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { settings: { type: 'object', additionalProperties: true } }
                }
              }
            }
          }
        }
      },
      put: {
        tags: ['Settings'],
        summary: 'Replace settings',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } }
        },
        responses: { '200': { $ref: '#/components/responses/Ok' } }
      }
    },
    '/api/v1/workouts': resourceList('workouts', 'Workouts', 'Workout'),
    '/api/v1/workouts/{id}': resourceItem('workout', 'Workouts', 'Workout'),
    '/api/v1/planned-workouts': resourceList(
      'planned workouts',
      'Planned Workouts',
      'PlannedWorkout'
    ),
    '/api/v1/planned-workouts/{id}': resourceItem(
      'planned workout',
      'Planned Workouts',
      'PlannedWorkout'
    ),
    '/api/v1/completed-workouts': resourceList(
      'completed workouts',
      'Completed Workouts',
      'CompletedWorkout'
    ),
    '/api/v1/completed-workouts/{id}': resourceItem(
      'completed workout',
      'Completed Workouts',
      'CompletedWorkout'
    ),
    '/api/v1/completed-workouts/{id}/hr': {
      get: {
        tags: ['Completed Workouts'],
        summary: 'Get HR attachment summary',
        security: [{ bearerAuth: [] }],
        parameters: [
          idParameter,
          { name: 'details', in: 'query', schema: { type: 'string', enum: ['1'] } },
          { name: 'full', in: 'query', schema: { type: 'string', enum: ['1'] } }
        ],
        responses: { '200': { description: 'HR attachment state' } }
      },
      post: {
        tags: ['Completed Workouts'],
        summary: 'Upload FIT, TCX, or ZIP HR attachment',
        security: [{ bearerAuth: [] }],
        parameters: [idParameter],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary' } }
              }
            }
          }
        },
        responses: { '200': { $ref: '#/components/responses/Ok' } }
      },
      delete: {
        tags: ['Completed Workouts'],
        summary: 'Delete HR attachment',
        security: [{ bearerAuth: [] }],
        parameters: [idParameter],
        responses: { '200': { $ref: '#/components/responses/Ok' } }
      }
    },
    '/api/v1/program-runs': resourceList('program runs', 'Program Runs', 'ProgramRun'),
    '/api/v1/program-runs/{id}': {
      get: resourceItem('program run', 'Program Runs', 'ProgramRun').get,
      delete: resourceItem('program run', 'Program Runs', 'ProgramRun').delete
    },
    '/api/v1/program-runs/{id}/generate': {
      post: {
        tags: ['Program Runs'],
        summary: 'Generate planned workouts for a program run',
        security: [{ bearerAuth: [] }],
        parameters: [idParameter],
        responses: {
          '200': { $ref: '#/components/responses/ProgramRunItem' },
          '409': { $ref: '#/components/responses/Error' }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' }
    },
    responses: {
      Ok: {
        description: 'Success',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { ok: { type: 'boolean' } },
              required: ['ok']
            }
          }
        }
      },
      Error: {
        description: 'Error',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/Error' } }
        }
      },
      WorkoutItem: {
        description: 'Workout response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { item: { $ref: '#/components/schemas/Workout' } }
            }
          }
        }
      },
      PlannedWorkoutItem: {
        description: 'Planned workout response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { item: { $ref: '#/components/schemas/PlannedWorkout' } }
            }
          }
        }
      },
      CompletedWorkoutItem: {
        description: 'Completed workout response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { item: { $ref: '#/components/schemas/CompletedWorkout' } }
            }
          }
        }
      },
      ProgramRunItem: {
        description: 'Program run response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { item: { $ref: '#/components/schemas/ProgramRun' } }
            }
          }
        }
      }
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
        required: ['error']
      },
      Me: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          username: { type: ['string', 'null'] },
          isAnonymous: { type: 'boolean' }
        },
        required: ['userId', 'username', 'isAnonymous']
      },
      Workout: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          yaml_source: { type: 'string' },
          plan_json: { type: ['object', 'array', 'null'], additionalProperties: true },
          updated_at: { type: ['integer', 'null'] },
          owner_id: { type: ['string', 'null'] },
          is_template: { type: 'boolean' }
        }
      },
      WorkoutInput: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          yaml_source: { type: 'string' }
        },
        required: ['name', 'yaml_source']
      },
      PlannedWorkout: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          planned_for: { type: ['integer', 'null'] },
          title: { type: 'string' },
          yaml_source: { type: 'string' },
          plan_json: { type: ['object', 'array', 'null'], additionalProperties: true },
          notes: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          created_at: { type: ['integer', 'null'] },
          updated_at: { type: ['integer', 'null'] }
        }
      },
      PlannedWorkoutInput: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          plannedFor: { type: 'integer' },
          title: { type: 'string' },
          yaml_source: { type: 'string' },
          notes: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } }
        },
        required: ['plannedFor']
      },
      CompletedSet: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          phase_index: { type: ['integer', 'null'] },
          position: { type: ['integer', 'null'] },
          round_label: { type: 'string' },
          set_label: { type: 'string' },
          reps: { type: ['number', 'null'] },
          weight: { type: ['number', 'null'] },
          duration_s: { type: ['number', 'null'] },
          type: { type: 'string' },
          rpe: { type: ['number', 'null'] },
          auto_filled: { type: 'boolean' }
        }
      },
      CompletedWorkout: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          workout_id: { type: ['string', 'null'] },
          planned_workout_id: { type: ['string', 'null'] },
          title: { type: 'string' },
          started_at: { type: ['integer', 'null'] },
          finished_at: { type: ['integer', 'null'] },
          duration_s: { type: ['number', 'null'] },
          rpe: { type: ['number', 'null'] },
          notes: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          created_at: { type: ['integer', 'null'] },
          sets: { type: 'array', items: { $ref: '#/components/schemas/CompletedSet' } }
        }
      },
      CompletedWorkoutInput: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          workoutId: { type: ['string', 'null'] },
          plannedWorkoutId: { type: ['string', 'null'] },
          title: { type: 'string' },
          startedAt: { type: ['integer', 'null'] },
          finishedAt: { type: ['integer', 'null'] },
          durationSeconds: { type: ['number', 'null'] },
          rpe: { type: ['number', 'null'] },
          notes: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          entries: { type: 'array', items: { $ref: '#/components/schemas/CompletedSet' } }
        }
      },
      ProgramRun: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          kind: { type: 'string' },
          title: { type: 'string' },
          spec: { type: 'object', additionalProperties: true },
          status: { type: 'string' },
          workouts: { type: 'array', items: { type: 'object', additionalProperties: true } }
        }
      },
      ProgramRunInput: {
        type: 'object',
        additionalProperties: true,
        properties: {
          spec: { type: 'object', additionalProperties: true },
          kind: { type: 'string' }
        }
      }
    }
  }
}

export const GET = async ({ request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response
  return json(openapi)
}
