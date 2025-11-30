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
  {
    id: 'alloy',
    label: 'Alloy (pre-generated pack)'
  },
  {
    id: 'ash',
    label: 'Ash (pre-generated pack)'
  }
]

const bufferCache: Record<string, AudioBuffer> = {}
let ctx: AudioContext | null = null

const pad = (n: number) => n.toString().padStart(3, '0')

const ensureCtx = () => {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

export const getVoiceOptions = () => defaultVoices

export const loadVoicePack = async (id: string): Promise<VoicePack> => {
  try {
    const res = await fetch(`/voices/${id}/metadata.json`)
    if (!res.ok) throw new Error(`metadata not found (${res.status})`)
    const meta = (await res.json()) as VoicePackMeta
    await preloadBuffers(id, meta)
    return {
      id,
      label: defaultVoices.find((v) => v.id === id)?.label ?? id,
      loaded: true,
      maxNumber: meta.maxNumber,
      phrases: meta.phrases ?? []
    }
  } catch (err) {
    return {
      id,
      label: defaultVoices.find((v) => v.id === id)?.label ?? id,
      loaded: false,
      maxNumber: 0,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export const playNumberFromPack = (voiceId: string, n: number): boolean => {
  const key = `${voiceId}-${n}`
  const buffer = bufferCache[key]
  if (!buffer) return false
  try {
    const audioCtx = ensureCtx()
    if (audioCtx.state === 'suspended') {
      audioCtx.resume()
    }
    const src = audioCtx.createBufferSource()
    src.buffer = buffer
    src.connect(audioCtx.destination)
    src.start()
    return true
  } catch (err) {
    console.warn('voice play failed', err)
    return false
  }
}

export const playVoiceCue = (voiceId: string, cue: VoiceCueKey): boolean => {
  const key = `${voiceId}-${cue}`
  const buffer = bufferCache[key]
  if (!buffer) return false
  try {
    const audioCtx = ensureCtx()
    if (audioCtx.state === 'suspended') {
      audioCtx.resume()
    }
    const src = audioCtx.createBufferSource()
    src.buffer = buffer
    src.connect(audioCtx.destination)
    src.start()
    return true
  } catch (err) {
    console.warn('voice cue play failed', err)
    return false
  }
}

const preloadBuffers = async (voiceId: string, meta: VoicePackMeta) => {
  const audioCtx = ensureCtx()
  for (let i = 1; i <= meta.maxNumber; i++) {
    const key = `${voiceId}-${i}`
    if (bufferCache[key]) continue
    const src = `/voices/${voiceId}/${pad(i)}.mp3`
    const resp = await fetch(src)
    if (!resp.ok) continue
    const arr = await resp.arrayBuffer()
    const buf = await audioCtx.decodeAudioData(arr)
    bufferCache[key] = buf
  }

  const phrases = meta.phrases ?? []
  for (const phrase of phrases) {
    const key = `${voiceId}-${phrase}`
    if (bufferCache[key]) continue
    const src = `/voices/${voiceId}/${phrase}.mp3`
    const resp = await fetch(src)
    if (!resp.ok) continue
    const arr = await resp.arrayBuffer()
    const buf = await audioCtx.decodeAudioData(arr)
    bufferCache[key] = buf
  }
}
