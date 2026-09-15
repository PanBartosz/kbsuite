import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PoseClient } from '../src/lib/counter/pose/poseClient'
import { frameSize } from '../src/lib/counter/pose/protocol'
import { SwingRepCounter, SnatchRepCounter } from '../src/lib/counter/pose/repCounter'
import { extractFrameSignals } from '../src/lib/counter/pose/signals'
import { voiceWindow, loadVoicePack, preloadVoiceNumbers, playNumberFromPack, releaseVoicePack } from '../src/lib/counter/audio/voicePack'

class FakeWorker {
  onmessage: any
  onerror: any
  onmessageerror: any
  sent: any[] = []
  terminated = false
  postMessage(message: any) { this.sent.push(message) }
  terminate() { this.terminated = true }
  emit(data: any) { this.onmessage({ data }) }
  complete(frame = this.sent.at(-1)) { this.emit({ ...frame, type: 'poses', poses: [], inferenceMs: 80 }) }
}
const setup = () => {
  const worker = new FakeWorker()
  const received: any[] = [], errors: string[] = []
  const client = new PoseClient({ onPoses: (...args) => received.push(args), onError: (error) => errors.push(error) }, () => worker as any)
  client.init()
  worker.emit({ type: 'ready', backend: 'test' })
  const bitmap = { closed: 0, close() { this.closed++ } }
  return { worker, client, bitmap, received, errors }
}

test('one frame slot includes both capture and inference; overload drops work', async () => {
  const { worker, client, bitmap, received } = setup()
  let resolve!: (image: any) => void
  const capture = client.capture(() => new Promise((r) => resolve = r))
  assert.equal(await client.capture(async () => { throw new Error('must not capture') }), false)
  resolve(bitmap)
  assert.equal(await capture, true)
  assert.equal(await client.capture(async () => bitmap as any), false)
  assert.equal(worker.sent.filter((m) => m.type === 'frame').length, 1)
  worker.complete()
  assert.equal(client.busy, false)
  assert.equal(received.length, 1)
  client.destroy()
})

test('invalidate while capture is pending closes bitmap without sending it', async () => {
  const { worker, client, bitmap } = setup()
  let resolve!: (image: any) => void
  const capture = client.capture(() => new Promise((r) => resolve = r))
  client.invalidate()
  resolve(bitmap)
  assert.equal(await capture, false)
  assert.equal(bitmap.closed, 1)
  assert.equal(worker.sent.length, 1)
  client.destroy()
})

test('old phase response releases slot but never reaches counting', async () => {
  const { worker, client, bitmap, received } = setup()
  await client.capture(async () => bitmap as any)
  client.invalidate()
  assert.equal(client.busy, true)
  worker.complete()
  assert.equal(received.length, 0)
  await client.capture(async () => bitmap as any)
  worker.complete()
  assert.equal(received.length, 1)
  client.destroy()
})

test('old result and duplicate acknowledgements cannot count', async () => {
  const { worker, client, bitmap, received } = setup()
  await client.capture(async () => bitmap as any, Date.now() - 2000)
  worker.complete()
  worker.complete()
  assert.equal(received.length, 0)
  client.destroy()
})

test('stop during capture closes late bitmap; worker failure is surfaced once', async () => {
  const { client, bitmap, worker, errors } = setup()
  let resolve!: (image: any) => void
  const capture = client.capture(() => new Promise((r) => resolve = r))
  worker.onerror({ message: 'lost context' })
  worker.onerror({ message: 'duplicate' })
  resolve(bitmap)
  await capture
  assert.equal(bitmap.closed, 1)
  assert.equal(worker.terminated, true)
  assert.deepEqual(errors, ['lost context'])
})

test('camera frame size is bounded and preserves portrait/landscape proportions', () => {
  assert.deepEqual(frameSize(1920, 1080), { width: 640, height: 360 })
  assert.deepEqual(frameSize(1080, 1920), { width: 360, height: 640 })
  assert.deepEqual(frameSize(320, 240), { width: 320, height: 240 })
})

test('signal normalization preserves the small-torso safeguard after resizing', () => {
  const pose: any = { keypoints: ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip', 'left_wrist', 'right_wrist', 'left_elbow', 'right_elbow', 'left_knee', 'right_knee', 'nose'].map((name, i) => ({ name, x: i % 2 * 2, y: i + 1, score: 1 })) }
  const resized = { keypoints: pose.keypoints.map((point: any) => ({ ...point, x: point.x / 3, y: point.y / 3 })) }
  const full = extractFrameSignals(pose)
  const small = extractFrameSignals(resized, 1 / 3)
  assert.ok(Math.abs(full.hands[0].handAboveShoulder - small.hands[0].handAboveShoulder) < 1e-10)
})

const frame = (height: number, side: 'left' | 'right' = 'left'): any => ({ hipAngle: 180, confidence: 1, hands: [{ side, handHeightHip: height, handAboveShoulder: height, handAboveHead: height, elbowAngle: 180, confidence: 1 }] })
for (const side of ['left', 'right'] as const) {
  test(`lockout ${side}: observation gap preserves count and requires a fresh low position`, () => {
    const counter = new SnatchRepCounter()
    let now = Date.now() + 1000
    for (let i = 0; i < 8; i++) counter.update(frame(1, side), now += 50)
    assert.equal(counter.update(frame(1, side), now += 50)?.count, 1)
    counter.resetTracking()
    for (let i = 0; i < 30; i++) assert.equal(counter.update(frame(1, side), now += 50)?.count, 1)
    for (let i = 0; i < 8; i++) counter.update(frame(-1, side), now += 50)
    for (let i = 0; i < 8; i++) counter.update(frame(1, side), now += 50)
    assert.equal(counter.update(frame(1, side), now += 50)?.count, 2)
  })
}

test('swing rep sequences and pause preserve count without inventing a rep', () => {
  const counter = new SwingRepCounter({ apexHeight: 0.5, resetHeight: 0.1, hingeExit: 160, minRepMs: 300 })
  let now = Date.now() + 1000
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const height of [...Array(12).fill(-1), ...Array(12).fill(1)]) counter.update(frame(height), now += 50)
  }
  assert.equal(counter.update(frame(1), now += 50)?.count, 3)
  counter.resetTracking()
  for (let i = 0; i < 30; i++) assert.equal(counter.update(frame(1), now += 50)?.count, 3)
})

test('voice cache window is bounded, handles resets, and stops at pack end', () => {
  assert.equal(voiceWindow(0, 200).length, 20)
  assert.deepEqual(voiceWindow(100, 200), Array.from({ length: 26 }, (_, i) => String(i + 95)))
  assert.equal(voiceWindow(200, 200).length, 6)
})


test('worker timeout terminates inference instead of allowing a backlog', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { client, bitmap, worker, errors } = setup()
  void client.capture(async () => bitmap as any)
  t.mock.timers.tick(5001)
  assert.equal(worker.terminated, true)
  assert.equal(errors.length, 1)
  client.destroy()
})

test('voice decoding starts with 20 numbers and releases buffers on stop', async () => {
  const originalFetch = globalThis.fetch
  const originalAudio = (globalThis as any).AudioContext
  const requested: string[] = []
  let closed = 0
  ;(globalThis as any).AudioContext = class {
    state = 'running'
    destination = {}
    async decodeAudioData() { return {} }
    async close() { closed++ }
    createBufferSource() { return { buffer: null, connect() {}, disconnect() {}, start() {} } }
  }
  globalThis.fetch = (async (url: any) => {
    requested.push(String(url))
    return { ok: true, json: async () => ({ maxNumber: 200, phrases: ['reset', 'swing_mode', 'lockout_mode'] }), arrayBuffer: async () => new ArrayBuffer(1) }
  }) as any
  try {
    const pack = await loadVoicePack('alloy')
    assert.equal(pack.loaded, true)
    assert.equal(requested.filter((url) => url.endsWith('.mp3')).length, 23)
    assert.equal(requested.some((url) => url.endsWith('/021.mp3')), false)
    assert.equal(playNumberFromPack('alloy', 1), true)
    preloadVoiceNumbers('alloy', 100)
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(playNumberFromPack('alloy', 100), true)
    assert.equal(playNumberFromPack('alloy', 1), false)
    releaseVoicePack()
    assert.equal(playNumberFromPack('alloy', 100), false)
    assert.ok(closed > 0)
  } finally {
    releaseVoicePack()
    globalThis.fetch = originalFetch
    ;(globalThis as any).AudioContext = originalAudio
  }
})
