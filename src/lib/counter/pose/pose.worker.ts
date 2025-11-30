/// <reference lib="webworker" />
import * as poseDetection from '@tensorflow-models/pose-detection'
import * as tf from '@tensorflow/tfjs'
import '@tensorflow/tfjs-backend-wasm'
import '@tensorflow/tfjs-backend-webgl'
import '@tensorflow/tfjs-backend-webgpu'
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm'

declare const self: DedicatedWorkerGlobalScope

export type IncomingMessage =
  | { type: 'init' }
  | {
      type: 'frame'
      image: ImageBitmap
    }

export type OutgoingMessage =
  | { type: 'ready'; backend: string }
  | { type: 'poses'; poses: poseDetection.Pose[]; ts: number }
  | { type: 'error'; message: string }

let detector: poseDetection.PoseDetector | null = null
let backendUsed = ''

const chooseBackend = async () => {
  const backends: Array<'webgpu' | 'webgl' | 'wasm'> = ['webgpu', 'webgl', 'wasm']
  for (const backend of backends) {
    try {
      await tf.setBackend(backend)
      await tf.ready()
      backendUsed = tf.getBackend()
      return
    } catch (err) {
      // continue to next backend
      console.warn(`Backend ${backend} failed`, err)
    }
  }
  backendUsed = tf.getBackend()
}

const initDetector = async () => {
  try {
    setWasmPaths('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/')
    await chooseBackend()
    const model = poseDetection.SupportedModels.MoveNet
    const detectorConfig: poseDetection.MoveNetModelConfig = {
      modelType: 'SinglePose.Lightning',
      enableSmoothing: true
    }
    detector = await poseDetection.createDetector(model, detectorConfig)
    self.postMessage({ type: 'ready', backend: backendUsed } satisfies OutgoingMessage)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    self.postMessage({ type: 'error', message } satisfies OutgoingMessage)
  }
}

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data
  if (msg.type === 'init') {
    if (!detector) await initDetector()
    return
  }

  if (msg.type === 'frame') {
    if (!detector) return
    try {
      const poses = await detector.estimatePoses(msg.image, {
        maxPoses: 1,
        flipHorizontal: false
      })
      self.postMessage({ type: 'poses', poses, ts: Date.now() } satisfies OutgoingMessage)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      self.postMessage({ type: 'error', message } satisfies OutgoingMessage)
    } finally {
      msg.image.close()
    }
  }
}

export {}
