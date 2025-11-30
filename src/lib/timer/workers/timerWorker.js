// High-precision timer worker that iterates through a flattened workout timeline
// and emits phase updates + tick events back to the main thread.

let isRunning = false
let isPaused = false
let currentTickId = 0
let nextWake = null
const driftToleranceMs = 50
let timerHandle = null

const state = {
  tickLengthMs: 1000,
  timeline: [],
  totalDurationMs: 0,
  phaseIndex: -1,
  phaseRemainingMs: 0,
  elapsedMs: 0,
  startedAt: null
}

const send = (type, detail = {}) => {
  postMessage({ type, ...detail })
}

const sanitizeTimeline = (rawTimeline) => {
  if (!Array.isArray(rawTimeline)) return []
  return rawTimeline
    .map((phase, index) => {
      if (!phase || typeof phase !== 'object') return null
      const durationSeconds = Number(phase.duration)
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
      const durationMs = Math.round(durationSeconds * 1000)
      return {
        ...phase,
        index,
        durationSeconds,
        durationMs
      }
    })
    .filter(Boolean)
}

const resetState = () => {
  if (timerHandle !== null) {
    clearTimeout(timerHandle)
    timerHandle = null
  }
  state.timeline = []
  state.totalDurationMs = 0
  state.phaseIndex = -1
  state.phaseRemainingMs = 0
  state.elapsedMs = 0
  state.startedAt = null
  isPaused = false
}

const stopRunning = ({ reason = 'stopped', completed = false } = {}) => {
  isRunning = false
  isPaused = false
  nextWake = null
  if (timerHandle !== null) {
    clearTimeout(timerHandle)
    timerHandle = null
  }
  currentTickId += 1
  if (completed) {
    send('completed', { tickId: currentTickId - 1 })
  } else {
    send('stopped', { tickId: currentTickId - 1, reason })
  }
}

const emitPhaseStart = () => {
  const phase = state.timeline[state.phaseIndex]
  if (!phase) return
  send('phaseStarted', {
    tickId: currentTickId,
    phaseIndex: state.phaseIndex,
    phaseCount: state.timeline.length,
    phase: {
      id: phase.id,
      type: phase.type,
      label: phase.label,
      durationSeconds: phase.durationSeconds,
      roundIndex: phase.roundIndex,
      setIndex: phase.setIndex,
      roundId: phase.roundId,
      setId: phase.setId,
      repetitionIndex: phase.repetitionIndex,
      repetitionCount: phase.repetitionCount,
      metadata: phase.metadata ?? {}
    }
  })
}

const advancePhase = () => {
  state.phaseIndex += 1
  while (
    state.phaseIndex < state.timeline.length &&
    state.timeline[state.phaseIndex].durationMs <= 0
  ) {
    state.phaseIndex += 1
  }

  if (state.phaseIndex >= state.timeline.length) {
    stopRunning({ reason: 'completed', completed: true })
    return false
  }

  const phase = state.timeline[state.phaseIndex]
  state.phaseRemainingMs = phase.durationMs
  emitPhaseStart()
  return true
}

const scheduleNext = () => {
  const tickLengthMs = state.tickLengthMs
  const baseline = nextWake ?? performance.now()
  nextWake = baseline + tickLengthMs

  const delay = Math.max(nextWake - performance.now(), 0)

  if (timerHandle !== null) {
    clearTimeout(timerHandle)
  }

  timerHandle = setTimeout(() => {
    timerHandle = null
    if (!isRunning || currentTickId <= 0) return
    state.elapsedMs += tickLengthMs
    state.phaseRemainingMs = Math.max(state.phaseRemainingMs - tickLengthMs, 0)

    send('tick', {
      tickId: currentTickId,
      timestamp: Date.now(),
      elapsedMs: state.elapsedMs,
      phaseIndex: state.phaseIndex,
      phaseRemainingMs: state.phaseRemainingMs,
      totalDurationMs: state.totalDurationMs
    })

    if (state.phaseRemainingMs <= 0) {
      const stillRunning = advancePhase()
      if (!stillRunning) {
        resetState()
        return
      }
    }

    const drift = performance.now() - nextWake
    if (drift > driftToleranceMs) {
      nextWake = performance.now()
    }

    scheduleNext()
  }, delay)
}

onmessage = (event) => {
  const { type, payload } = event.data ?? {}

  if (type === 'start') {
    const sanitizedTimeline = sanitizeTimeline(payload?.timeline)
    if (!sanitizedTimeline.length) {
      send('error', { message: 'Timeline is empty. Cannot start timer.' })
      return
    }

    if (isRunning) {
      stopRunning({ reason: 'restarted' })
      resetState()
    }

    isRunning = true
    isPaused = false
    currentTickId += 1
    state.timeline = sanitizedTimeline
    state.totalDurationMs = sanitizedTimeline.reduce(
      (total, phase) => total + phase.durationMs,
      0
    )
    state.tickLengthMs =
      Number.isFinite(Number(payload?.tickLengthMs)) && Number(payload?.tickLengthMs) > 0
        ? Math.round(Number(payload.tickLengthMs))
        : 1000
    state.elapsedMs = 0
    state.startedAt = Date.now()
    nextWake = null

    send('started', {
      tickId: currentTickId,
      totalDurationMs: state.totalDurationMs,
      phaseCount: state.timeline.length
    })

    if (!advancePhase()) {
      resetState()
      return
    }

    scheduleNext()
    return
  }

  if (type === 'stop') {
    if (!isRunning && !isPaused) return
    stopRunning({ reason: payload?.reason ?? 'manual-stop' })
    resetState()
    return
  }

  if (type === 'pause') {
    if (!isRunning || isPaused) return
    isPaused = true
    isRunning = false
    nextWake = null
    if (timerHandle !== null) {
      clearTimeout(timerHandle)
      timerHandle = null
    }
    send('paused', {
      tickId: currentTickId,
      elapsedMs: state.elapsedMs,
      phaseIndex: state.phaseIndex,
      phaseRemainingMs: state.phaseRemainingMs
    })
    return
  }

  if (type === 'resume') {
    if (!isPaused || currentTickId <= 0) return
    isPaused = false
    isRunning = true
    nextWake = null
    send('resumed', { tickId: currentTickId })
    scheduleNext()
    return
  }

  if (type === 'skip') {
    if (state.timeline.length === 0 || currentTickId <= 0) return

    const wasRunning = isRunning
    const wasPaused = isPaused
    const remainingMs = state.phaseRemainingMs

    if (wasRunning) {
      if (timerHandle !== null) {
        clearTimeout(timerHandle)
        timerHandle = null
      }
      state.elapsedMs = Math.min(state.elapsedMs + remainingMs, state.totalDurationMs)
      state.phaseRemainingMs = 0
      const stillRunning = advancePhase()
      if (!stillRunning) {
        resetState()
        return
      }
      // Refresh scheduling cadence
      nextWake = null
      scheduleNext()
    } else if (wasPaused) {
      state.elapsedMs = Math.min(state.elapsedMs + remainingMs, state.totalDurationMs)
      const previousRunningState = isRunning
      isRunning = true
      const stillRunning = advancePhase()
      isRunning = previousRunningState
      if (!stillRunning) {
        resetState()
        return
      }
      send('tick', {
        tickId: currentTickId,
        timestamp: Date.now(),
        elapsedMs: state.elapsedMs,
        phaseIndex: state.phaseIndex,
        phaseRemainingMs: state.phaseRemainingMs,
        totalDurationMs: state.totalDurationMs
      })
    }
    return
  }

  if (type === 'ping') {
    send('pong')
  }
}
