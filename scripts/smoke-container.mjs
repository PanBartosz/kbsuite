// Run against a disposable container: this exercises real SQLite writes.
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

const base = new URL(process.argv[2] || 'http://127.0.0.1:4180')
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use a local, disposable container')
const cookies = new Map()
const request = async (path, options = {}) => {
  const response = await fetch(new URL(path, base), {
    ...options,
    signal: AbortSignal.timeout(10000),
    headers: {
      Origin: base.origin,
      Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      ...options.headers
    }
  })
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0]
    const separator = pair.indexOf('=')
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
  assert(response.ok, `${options.method || 'GET'} ${path}: HTTP ${response.status}`)
  return response
}

let ready = false
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    await request('/')
    ready = true
    break
  } catch {
    await delay(500)
  }
}
assert(ready, 'Container did not become ready')

for (const path of ['/timer', '/big-picture', '/programs', '/workouts', '/history', '/service-worker.js']) {
  await request(path)
}
const session = await (await request('/api/session')).json()
assert(session.userId, 'Session was not initialized')
const library = await (await request('/api/workouts')).json()
assert(library.workouts?.length > 0, 'Workout templates were not seeded')
const programs = await (await request('/api/program-runs')).json()
assert(Array.isArray(programs.items), 'Program storage is unavailable')

const created = await (await request('/api/completed-workouts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Container smoke test',
    durationSeconds: 30,
    entries: [{ id: 'smoke-set', phaseIndex: 0, roundLabel: 'Smoke', setLabel: 'Swings', type: 'work', durationSeconds: 30, loggedReps: 12, weight: 16 }]
  })
})).json()
assert(created.item?.id, 'Workout was not saved')
try {
  const history = await (await request('/api/completed-workouts')).json()
  const saved = history.items?.find(item => item.id === created.item.id)
  assert.equal(saved?.sets?.[0]?.reps, 12, 'Saved reps did not round-trip')
  assert.equal(saved?.sets?.[0]?.weight, 16, 'Saved weight did not round-trip')
} finally {
  await request(`/api/completed-workouts/${encodeURIComponent(created.item.id)}`, { method: 'DELETE' })
}
console.log('Container smoke test passed: routes, sessions, templates, programs, and workout storage')
