import type { Pose } from '@tensorflow-models/pose-detection'

export interface FrameIdentity {
  id: number
  generation: number
  capturedAt: number
}
export type IncomingMessage =
  | { type: 'init' }
  | ({ type: 'frame'; image: ImageBitmap } & FrameIdentity)
export type OutgoingMessage =
  | { type: 'ready'; backend: string }
  | ({ type: 'poses'; poses: Pose[]; inferenceMs: number } & FrameIdentity)
  | { type: 'error'; message: string; id?: number; generation?: number }

export const frameSize = (width: number, height: number) => {
  const scale = Math.min(1, 640 / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
