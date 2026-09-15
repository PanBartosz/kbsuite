export interface VoicePackMeta {
  voice: string
  model: string
  maxNumber: number
  format: string
  phrases?: string[]
}
export interface VoicePack {
  id: string
  label: string
  loaded: boolean
  maxNumber: number
  phrases?: string[]
  error?: string
}
export type VoiceCueKey = 'swing_mode' | 'lockout_mode' | 'reset'
const defaultVoices = [
  { id: 'alloy', label: 'Alloy (pre-generated pack)' },
  { id: 'ash', label: 'Ash (pre-generated pack)' }
]
const buffers = new Map<string, AudioBuffer>()
let ctx: AudioContext | null = null
let activeVoice = ''
let meta: VoicePackMeta | null = null
let desired = new Set<string>()
let controller = new AbortController()
let pendingLoad: Promise<VoicePack> | null = null
let loading = false
let generation = 0
const ensureCtx = () => ctx ??= new AudioContext()
export const getVoiceOptions = () => defaultVoices

export const voiceWindow = (number: number, maxNumber: number) =>
  Array.from({ length: Math.max(0, Math.min(maxNumber, number + 20) - Math.max(1, number - 5) + 1) },
    (_, i) => String(Math.max(1, number - 5) + i))

export const releaseVoicePack = () => {
  generation += 1
  controller.abort()
  controller = new AbortController()
  buffers.clear()
  desired.clear()
  activeVoice = ''
  meta = null
  pendingLoad = null
  loading = false
  void ctx?.close().catch(() => {})
  ctx = null
}

const fillWindow = async () => {
  if (loading || !meta) return
  loading = true
  const token = generation
  const voice = activeVoice
  const signal = controller.signal
  const attempted = new Set<string>()
  try {
    // Sequential decoding bounds transient memory as well as retained buffers.
    while (token === generation) {
      const key = [...desired].find((key) => !buffers.has(key) && !attempted.has(key))
      if (!key) break
      attempted.add(key)
      try {
        const filename = /^\d+$/.test(key) ? key.padStart(3, '0') : key
        const response = await fetch(`/voices/${voice}/${filename}.mp3`, { signal })
        if (!response.ok) continue
        const data = await response.arrayBuffer()
        if (token !== generation) return
        const buffer = await ensureCtx().decodeAudioData(data)
        if (token === generation && desired.has(key)) buffers.set(key, buffer)
      } catch {
        // A missing/offline number uses the existing rep sound fallback.
      }
    }
  } finally {
    if (token === generation) loading = false
  }
}

export const preloadVoiceNumbers = (voiceId: string, number: number) => {
  if (voiceId !== activeVoice || !meta) return
  desired = new Set([...(meta.phrases ?? []), ...voiceWindow(number, meta.maxNumber)])
  for (const key of buffers.keys()) if (!desired.has(key)) buffers.delete(key)
  void fillWindow()
}

export const loadVoicePack = (id: string): Promise<VoicePack> => {
  if (activeVoice === id && pendingLoad) return pendingLoad
  releaseVoicePack()
  activeVoice = id
  const token = generation
  const signal = controller.signal
  pendingLoad = (async () => {
    try {
      const response = await fetch(`/voices/${id}/metadata.json`, { signal })
      if (!response.ok) throw new Error(`Voice metadata unavailable (${response.status})`)
      const metadata: VoicePackMeta = await response.json()
      if (token !== generation) throw new Error('Voice changed')
      meta = metadata
      desired = new Set([...(meta.phrases ?? []), ...voiceWindow(0, meta.maxNumber)])
      await fillWindow()
      return { id, label: id, loaded: token === generation, maxNumber: metadata.maxNumber, phrases: metadata.phrases }
    } catch (error) {
      if (token === generation) pendingLoad = null
      return { id, label: id, loaded: false, maxNumber: 0, error: String(error) }
    }
  })()
  return pendingLoad
}

const play = (voiceId: string, key: string) => {
  const buffer = voiceId === activeVoice ? buffers.get(key) : null
  if (!buffer) return false
  try {
    const audioCtx = ensureCtx()
    if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => {})
    const source = audioCtx.createBufferSource()
    source.buffer = buffer
    source.connect(audioCtx.destination)
    source.onended = () => source.disconnect()
    source.start()
    return true
  } catch { return false }
}
export const playNumberFromPack = (voiceId: string, number: number) => {
  const played = play(voiceId, String(number))
  preloadVoiceNumbers(voiceId, number)
  return played
}
export const playVoiceCue = (voiceId: string, cue: VoiceCueKey) => play(voiceId, cue)
