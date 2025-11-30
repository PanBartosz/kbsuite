import type { Pose } from '@tensorflow-models/pose-detection'
import PoseWorker from './pose.worker?worker'
import type { IncomingMessage, OutgoingMessage } from './pose.worker'

type Callbacks = {
  onReady?: (backend: string) => void
  onPoses?: (poses: Pose[], ts: number) => void
  onError?: (message: string) => void
}

export class PoseClient {
  private worker: Worker
  private callbacks: Callbacks
  private initialized = false

  constructor(callbacks: Callbacks = {}) {
    this.worker = new PoseWorker()
    this.callbacks = callbacks
    this.worker.onmessage = (event: MessageEvent<OutgoingMessage>) => {
      const msg = event.data
      if (msg.type === 'ready') {
        this.callbacks.onReady?.(msg.backend)
      } else if (msg.type === 'poses') {
        this.callbacks.onPoses?.(msg.poses, msg.ts)
      } else if (msg.type === 'error') {
        this.callbacks.onError?.(msg.message)
      }
    }
  }

  init() {
    if (this.initialized) return
    this.worker.postMessage({ type: 'init' } satisfies IncomingMessage)
    this.initialized = true
  }

  sendFrame(image: ImageBitmap) {
    this.worker.postMessage({ type: 'frame', image } satisfies IncomingMessage, [image])
  }

  destroy() {
    this.worker.terminate()
  }
}
