let ctx: AudioContext | null = null

const ensureContext = () => {
  if (ctx) return ctx
  ctx = new AudioContext()
  return ctx
}

export const initAudio = () => ensureContext()

export const playRepSound = () => {
  const audio = ensureContext()
  if (audio.state === 'suspended') {
    audio.resume()
  }
  const now = audio.currentTime
  const osc = audio.createOscillator()
  const gain = audio.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(880, now)
  gain.gain.setValueAtTime(0.001, now)
  gain.gain.exponentialRampToValueAtTime(0.15, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2)

  osc.connect(gain).connect(audio.destination)
  osc.start(now)
  osc.stop(now + 0.25)
}
