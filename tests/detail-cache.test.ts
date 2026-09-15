import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDetailCache } from '../src/lib/hr/detailCache'

test('leaving the page settles queued requests even when a loader ignores abort', async () => {
  let finish!: (value: string) => void
  const received: string[] = []
  const cache = createDetailCache<string>(() => new Promise(resolve => { finish = resolve }), (_id, value) => received.push(value), 1)
  const active = cache.get('active')
  const queued = cache.get('queued')
  await Promise.resolve()
  cache.destroy()
  assert.deepEqual(await Promise.all([active, queued]), [undefined, undefined])
  finish('late')
  await Promise.resolve()
  assert.deepEqual(received, [])
})

test('failed details can be retried immediately and invalidation aborts the old request', async () => {
  let attempts = 0
  let signal: AbortSignal | undefined
  const cache = createDetailCache<string>(async (_id, currentSignal) => {
    signal = currentSignal
    if (++attempts === 1) throw new Error('Network unavailable')
    if (attempts === 2) return new Promise((_resolve, reject) => currentSignal.addEventListener('abort', () => reject(new Error('Aborted'))))
    return 'fresh'
  }, () => undefined)
  assert.equal(await cache.get('a'), undefined)
  const stale = cache.get('a')
  await Promise.resolve()
  cache.invalidate('a')
  assert.equal(signal?.aborted, true)
  assert.equal(await stale, undefined)
  assert.equal(await cache.get('a'), 'fresh')
  cache.destroy()
})

test('detail cache deduplicates requests and bounds concurrent loads', async () => {
  let active = 0
  let peak = 0
  const received: string[] = []
  const cache = createDetailCache<string>(async (id) => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 8))
    active -= 1
    return id.toUpperCase()
  }, (_id, value) => received.push(value), 2)

  const first = cache.get('a')
  const duplicate = cache.get('a')
  const other = cache.get('b')
  const third = cache.get('c')
  assert.equal(await first, 'A')
  assert.equal(await duplicate, 'A')
  assert.equal(await other, 'B')
  assert.equal(await third, 'C')
  assert.equal(peak, 2)
  assert.deepEqual(received.sort(), ['A', 'B', 'C'])
  assert.equal(await cache.get('a'), 'A')
  cache.destroy()
})

test('invalidating an in-flight detail ignores the stale result', async () => {
  let loads = 0
  let releaseOld!: (value: string) => void
  const cache = createDetailCache<string>(async (id) => {
    loads += 1
    if (loads === 1) return new Promise((resolve) => { releaseOld = resolve })
    return `${id}-fresh`
  }, () => undefined, 1)

  const stale = cache.get('session')
  await new Promise((resolve) => setTimeout(resolve, 0))
  cache.invalidate('session')
  const fresh = cache.get('session')
  releaseOld('session-stale')
  assert.equal(await stale, undefined)
  assert.equal(await fresh, 'session-fresh')
  assert.equal(await cache.get('session'), 'session-fresh')
  cache.destroy()
})
