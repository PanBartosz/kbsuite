/// <reference lib="webworker" />
import * as poseDetection from '@tensorflow-models/pose-detection'
import * as tf from '@tensorflow/tfjs'
import '@tensorflow/tfjs-backend-wasm'
import '@tensorflow/tfjs-backend-webgl'
import '@tensorflow/tfjs-backend-webgpu'
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm'
import type { IncomingMessage, OutgoingMessage } from './protocol'

declare const self: DedicatedWorkerGlobalScope
let detector: poseDetection.PoseDetector | null = null
let initializing: Promise<void> | null = null
let busy = false
let generation = -1

const initDetector = async () => {
  setWasmPaths('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/')
  let lastError: unknown
  for (const backend of ['webgpu', 'webgl', 'wasm']) {
    try {
      if (!await tf.setBackend(backend)) continue
      await tf.ready()
      detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
        enableSmoothing: true
      })
      const warmup = tf.zeros([192, 192, 3]) as tf.Tensor3D
      try {
        await detector.estimatePoses(warmup)
      } finally {
        warmup.dispose()
      }
      detector.reset()
      self.postMessage({ type: 'ready', backend: tf.getBackend() } satisfies OutgoingMessage)
      return
    } catch (error) {
      lastError = error
      detector?.dispose()
      detector = null
      tf.removeBackend(backend)
    }
  }
  throw lastError ?? new Error('No supported pose backend is available')
}

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data
  if (msg.type === 'init') {
    if (!initializing) {
      initializing = initDetector().catch((error) => {
        self.postMessage({ type: 'error', message: String(error) } satisfies OutgoingMessage)
      })
    }
    return
  }
  if (!detector || busy) {
    msg.image.close()
    self.postMessage({ type: 'error', id: msg.id, generation: msg.generation, message: 'Counter is not ready for a frame' } satisfies OutgoingMessage)
    return
  }
  busy = true
  const started = performance.now()
  try {
    if (generation !== msg.generation) {
      detector.reset()
      generation = msg.generation
    }
    // TFJS accepts ImageBitmap at runtime, but its detector input type omits it.
    const poses = await detector.estimatePoses(msg.image as unknown as HTMLCanvasElement, {
      maxPoses: 1, flipHorizontal: false
    }, msg.capturedAt)
    self.postMessage({ type: 'poses', poses, id: msg.id, generation: msg.generation,
      capturedAt: msg.capturedAt, inferenceMs: performance.now() - started } satisfies OutgoingMessage)
  } catch (error) {
    self.postMessage({ type: 'error', id: msg.id, generation: msg.generation, message: String(error) } satisfies OutgoingMessage)
  } finally {
    msg.image.close()
    busy = false
  }
}
