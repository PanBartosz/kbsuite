import type { Pose } from '@tensorflow-models/pose-detection'
import PoseWorker from './pose.worker?worker'
import type { FrameIdentity, IncomingMessage, OutgoingMessage } from './protocol'

type Callbacks = {
  onReady?: (backend: string) => void
  onPoses?: (poses: Pose[], capturedAt: number) => void
  onError?: (message: string) => void
  onMetrics?: (metrics: { inferenceMs: number; resultAgeMs: number; skipped: number }) => void
}

/** Owns the single slot from bitmap creation until the worker acknowledges it. */
export class PoseClient {
  private worker: Worker
  private initialized = false
  private ready = false
  private destroyed = false
  private generation = 0
  private sequence = 0
  private pending: FrameIdentity | null = null
  private timeout: ReturnType<typeof setTimeout> | undefined
  private skipped = 0

  constructor(private callbacks: Callbacks = {}, createWorker = () => new PoseWorker()) {
    this.worker = createWorker()
    this.worker.onmessage = (event: MessageEvent<OutgoingMessage>) => {
      if (this.destroyed) return
      const msg = event.data
      if (msg.type === 'ready') {
        this.clearTimeout()
        this.ready = true
        this.callbacks.onReady?.(msg.backend)
      } else if (msg.type === 'error') {
        this.fail(msg.message)
      } else if (msg.type === 'poses' && msg.id === this.pending?.id) {
        this.clearTimeout()
        this.pending = null
        if (msg.generation !== this.generation) return
        const resultAgeMs = Date.now() - msg.capturedAt
        this.callbacks.onMetrics?.({ inferenceMs: msg.inferenceMs, resultAgeMs, skipped: this.skipped })
        if (resultAgeMs <= 1000) this.callbacks.onPoses?.(msg.poses, msg.capturedAt)
      }
    }
    this.worker.onerror = (event) => this.fail(event.message || 'Pose worker stopped unexpectedly')
    this.worker.onmessageerror = () => this.fail('Unable to read pose results')
  }

  get busy() { return this.pending !== null }

  init() {
    if (this.initialized || this.destroyed) return
    this.initialized = true
    this.armTimeout(60000, 'Counter preparation timed out. Check your connection and retry.')
    this.worker.postMessage({ type: 'init' } satisfies IncomingMessage)
  }

  invalidate() {
    this.generation += 1
    // Keep the slot occupied until the old capture/inference actually finishes.
  }

  async capture(createImage: () => Promise<ImageBitmap>, capturedAt = Date.now()) {
    if (this.destroyed || !this.ready || this.pending) {
      this.skipped += 1
      return false
    }
    const frame = { id: ++this.sequence, generation: this.generation, capturedAt }
    this.pending = frame
    this.armTimeout(5000, 'Counter stopped responding. Retry the camera.')
    let image: ImageBitmap | undefined
    try {
      image = await createImage()
      if (this.destroyed || frame.generation !== this.generation) {
        image.close()
        this.pending = null
        this.clearTimeout()
        return false
      }
      this.worker.postMessage({ type: 'frame', image, ...frame } satisfies IncomingMessage, [image])
      return true
    } catch (error) {
      image?.close()
      this.fail(error instanceof Error ? error.message : 'Unable to capture camera frame')
      return false
    }
  }

  private armTimeout(ms: number, message: string) {
    this.clearTimeout()
    this.timeout = setTimeout(() => this.fail(message), ms)
  }
  private clearTimeout() {
    clearTimeout(this.timeout)
    this.timeout = undefined
  }
  private fail(message: string) {
    if (this.destroyed) return
    this.destroy()
    this.callbacks.onError?.(message)
  }
  destroy() {
    this.destroyed = true
    this.ready = false
    this.invalidate()
    this.clearTimeout()
    this.worker.terminate()
  }
}
