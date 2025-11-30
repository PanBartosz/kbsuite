let audioContext = null
let masterGain = null
let isReady = false
let metronomeGain = null
let metronomeScheduler = null

const frequencies = {
  prep: 360,
  countdown: 520,
  work: 880,
  rest: 440,
  transition: 660,
  roundRest: 520,
  roundTransition: 600,
  default: 520
}

const durations = {
  prep: 0.32,
  countdown: 0.38,
  work: 0.2,
  rest: 0.24,
  transition: 0.24,
  roundRest: 0.24,
  roundTransition: 0.26,
  default: 0.2
}

export const initAudio = () => {
  if (typeof window === 'undefined') return false
  if (isReady && audioContext) return true

  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) return false

  audioContext = new AudioCtx()
  masterGain = audioContext.createGain()
  masterGain.gain.value = 1.00
  masterGain.connect(audioContext.destination)
  metronomeGain = audioContext.createGain()
  metronomeGain.gain.value = 0.35
  metronomeGain.connect(masterGain)
  isReady = true
  return true
}

const ensureContext = () => {
  if (!audioContext) return false
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {})
  }
  return true
}

export const playCue = (type) => {
  if (!isReady || !audioContext || !masterGain) return
  if (!ensureContext()) return

  const now = audioContext.currentTime
  const oscillator = audioContext.createOscillator()
  oscillator.type = 'sine'
  oscillator.frequency.value = frequencies[type] ?? frequencies.default

  const duration = durations[type] ?? durations.default
  const envelope = audioContext.createGain()
  envelope.gain.setValueAtTime(0, now)
  envelope.gain.linearRampToValueAtTime(1, now + 0.01)
  envelope.gain.linearRampToValueAtTime(0, now + duration)

  oscillator.connect(envelope)
  envelope.connect(masterGain)

  oscillator.start(now)
  oscillator.stop(now + duration + 0.05)

  // For transitions, add a quick second blip
  if (type === 'transition' || type === 'roundTransition') {
    const osc2 = audioContext.createOscillator()
    osc2.type = 'sine'
    osc2.frequency.value = frequencies[type] * 1.2
    const env2 = audioContext.createGain()
    env2.gain.setValueAtTime(0, now + 0.12)
    env2.gain.linearRampToValueAtTime(1, now + 0.15)
    env2.gain.linearRampToValueAtTime(0, now + 0.3)
    osc2.connect(env2)
    env2.connect(masterGain)
    osc2.start(now + 0.12)
    osc2.stop(now + 0.35)
  }
}

export const playSequence = (type, count = 3, gapMs = 160) => {
  if (!isReady || !audioContext || !masterGain) return
  if (!ensureContext()) return
  const interval = Math.max(gapMs, 60)
  for (let i = 0; i < count; i += 1) {
    setTimeout(() => {
      playCue(type)
    }, i * interval)
  }
}

export const playCountdown = (count = 3, intervalMs = 1000) => {
  playSequence('countdown', count, Math.max(intervalMs, 200))
}

export const shutdownAudio = () => {
  if (!audioContext) return
  audioContext.close().catch(() => {})
  audioContext = null
  masterGain = null
  metronomeGain = null
  if (metronomeScheduler) {
    metronomeScheduler.cancel()
    metronomeScheduler = null
  }
  isReady = false
}

const createScheduler = () => {
  const events = []
  return {
    schedule(callback, delayMs) {
      const id = setTimeout(callback, delayMs)
      events.push(id)
      return id
    },
    cancel() {
      events.forEach((id) => clearTimeout(id))
      events.length = 0
    }
  }
}

export const startMetronome = ({ rpm, totalDurationSeconds }) => {
  if (!isReady || !audioContext || !metronomeGain) return
  if (!rpm || rpm <= 0) return
  if (!ensureContext()) return

  stopMetronome()

  metronomeScheduler = createScheduler()
  const targetInterval = 60 / rpm
  const totalBeats = Math.max(Math.ceil(totalDurationSeconds), 1)
  let accumulator = 0

  for (let beatIndex = 0; beatIndex < totalBeats; beatIndex += 1) {
    const isLastBeat = beatIndex === totalBeats - 1
    metronomeScheduler.schedule(() => {
      const now = audioContext.currentTime
      accumulator += 1
      let isAccent = false
      if (accumulator >= targetInterval || isLastBeat) {
        isAccent = true
        accumulator -= targetInterval
        if (accumulator < 0) accumulator = 0
      }

      const osc = audioContext.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = isAccent ? 1050 : 720

      const env = audioContext.createGain()
      const start = now
      const peak = now + 0.018
      const end = now + 0.16
      env.gain.setValueAtTime(0, start)
      env.gain.linearRampToValueAtTime(isAccent ? 0.8 : 0.45, peak)
      env.gain.exponentialRampToValueAtTime(0.001, end)

      osc.connect(env)
      env.connect(metronomeGain)
      osc.start(start)
      osc.stop(end)
    }, beatIndex * 1000)
  }

  metronomeScheduler.schedule(() => {
    stopMetronome()
  }, totalBeats * 1000 + 200)
}

export const stopMetronome = () => {
  if (metronomeScheduler) {
    metronomeScheduler.cancel()
    metronomeScheduler = null
  }
}
