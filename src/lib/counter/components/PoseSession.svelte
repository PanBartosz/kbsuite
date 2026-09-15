<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { Pose } from '@tensorflow-models/pose-detection'
  import {
    exercise,
    feedback,
    poseStats,
    repCount,
    rpm as rpmStore,
    runState,
    thresholds,
    countingEnabled as countingEnabledStore,
    gesturesEnabled as gesturesEnabledStore,
    type ExerciseId
  } from '../stores/session'
  import type { PoseClient } from '../pose/poseClient'
  import { frameSize } from '../pose/protocol'
  import { drawPose } from '../pose/drawing'
  import { createCounterForExercise, getExerciseOption } from '../exercises/config'
  import type { RepCounter } from '../pose/repCounter'
  import { extractFrameSignals, type FrameSignals } from '../pose/signals'
  import { initAudio, playRepSound, releaseAudio } from '../audio/counterSound'
  import {
    getVoiceOptions,
    loadVoicePack,
    preloadVoiceNumbers,
    releaseVoicePack,
    playNumberFromPack,
    playVoiceCue,
    type VoiceCueKey
  } from '../audio/voicePack'
  import { GestureEngine, type GestureEvent } from '../pose/gestures'
  import { settings, setCounterSettings } from '$lib/stores/settings'

  export let autoStart = false
  export let showControls: boolean | undefined = undefined
  export let showStats: boolean | undefined = undefined

  let videoEl: HTMLVideoElement
  let canvasEl: HTMLCanvasElement
  let ctx: CanvasRenderingContext2D | null = null
  let stream: MediaStream | null = null
  let client: PoseClient | null = null
  let detectorReady = false
  let mounted = false
  let visible = true
  let cameraPreparing = false
  let cameraAttempt = 0
  let preparingDetector = false
  let detectorError: string | null = null
  let tracking = false
  let lastStatsTs = 0
  let videoCallback: number | null = null
  let lastVideoTime = -1
  let staleTimer: ReturnType<typeof setTimeout> | undefined
  let lastSendTs = 0
  let cameraError: string | null = null
  let raf = 0
  let lastPoseTs = 0
  let lastSignals: FrameSignals | null = null
  let lastActiveHand: 'left' | 'right' | 'both' | null = null
  let countdownTimer: number | null = null
  let backend = ''
  let counter: RepCounter | null = null
  let lastExerciseId: ExerciseId | null = null
  const gestureEngine = new GestureEngine()
  let lastCount = 0
  let repTimestamps: number[] = []
  const RPM_WINDOW_REPS = 5
  const voiceOptions = getVoiceOptions()
  let voiceSelected = $settings.counter.voiceSelected ?? voiceOptions[0]?.id ?? 'alloy'
  let voiceEnabled = $settings.counter.voiceEnabled
  let voicePackLoaded = false
  let voicePackError: string | null = null
  let voiceMaxNumber = 0
  let lastPhase = ''
  let debugOverlay = $settings.counter.debugOverlay
  let videoAspect = 16 / 9
  let lowFpsMode = $settings.counter.lowFpsMode
  let gesturesEnabled = true
  let countingEnabled = true
  let overlayMode: ExerciseId | 'disabled' = 'swing'
  const LOCKOUT_HEAD_THRESH = 0.5
  const LOCKOUT_HOLD_MS = 75

  function clearRpm() {
    repTimestamps = []
    rpmStore.set(null)
  }

  function updateRpm(ts: number) {
    repTimestamps.push(ts)
    if (repTimestamps.length > RPM_WINDOW_REPS) {
      repTimestamps.splice(0, repTimestamps.length - RPM_WINDOW_REPS)
    }
    if (repTimestamps.length < 2) {
      rpmStore.set(null)
      return
    }
    const durationMs = repTimestamps[repTimestamps.length - 1] - repTimestamps[0]
    if (durationMs <= 0) {
      rpmStore.set(null)
      return
    }
    const intervals = repTimestamps.length - 1
    const estimate = Math.round((60000 * intervals) / durationMs)
    rpmStore.set(Number.isFinite(estimate) ? estimate : null)
  }

  $: currentThresholds = $thresholds
  $: currentExercise = getExerciseOption($exercise)
  $: counter = createCounterForExercise(currentExercise.id, currentThresholds)
  $: lockoutMinGap = currentThresholds.lockout.minRepMs
  $: currentLowBand = currentExercise.type === 'lockout' ? currentThresholds.lockout.lowBand : null
  $: if (currentExercise.id !== lastExerciseId && counter) {
    repCount.set(0)
    lastCount = 0
    clearRpm()
    counter.reset()
    lastExerciseId = currentExercise.id
    gestureEngine.reset()
  }

  const handleReady = (backendName: string) => {
    detectorReady = true
    backend = backendName
    poseStats.update((s) => ({ ...s, ready: true, backend: backendName }))
    syncLoop()
  }

  const handleError = (message: string) => {
    console.error(message)
    detectorError = message
    detectorReady = false
    preparingDetector = false
    client = null
    feedback.set(message)
    cancelLoop()
    clearOverlay()
    poseStats.update((s) => ({ ...s, ready: false, fps: 0 }))
  }

  const handleGestureEvents = (events: GestureEvent[]) => {
    if (!gesturesEnabled) return
    for (const evt of events) {
      if (evt.id === 'reset') {
        resetCount('Counter reset', true)
      } else if (evt.id === 'swing_mode' && $exercise !== 'swing') {
        setExerciseMode('swing')
      } else if (evt.id === 'lockout_mode' && $exercise !== 'lockout') {
        setExerciseMode('lockout')
      }
    }
  }

  const setExerciseMode = (id: ExerciseId, options: { silent?: boolean } = {}) => {
    const silent = options?.silent ?? false
    if (id === $exercise) {
      return
    }
    invalidateTracking()
    exercise.set(id)
    overlayMode = id
    const opt = getExerciseOption(id)
    if (!silent) {
      feedback.set(`Mode: ${opt.label}`)
      playModeCue(id)
    }
  }

  const handleVoiceChange = async (event: Event) => {
    const target = event.target as HTMLSelectElement
    voiceSelected = target.value
    setCounterSettings({ voiceSelected })
    await loadVoiceSelected()
  }

  const handleVoiceToggle = async (event: Event) => {
    const target = event.target as HTMLInputElement
    voiceEnabled = target.checked
    setCounterSettings({ voiceEnabled })
    if (voiceEnabled && !voicePackLoaded) {
      await loadVoiceSelected()
    }
  }

  const loadVoiceSelected = async () => {
    if (!voiceEnabled || !mounted || $runState === 'idle') return
    const selected = voiceSelected
    const attempt = cameraAttempt
    const pack = await loadVoicePack(selected)
    if (!mounted || attempt !== cameraAttempt || selected !== voiceSelected || !stream && !cameraPreparing) return
    voicePackLoaded = pack.loaded
    voicePackError = pack.error ?? null
    voiceMaxNumber = pack.maxNumber
  }

  const modeCueForId = (id: ExerciseId): VoiceCueKey => (id === 'swing' ? 'swing_mode' : 'lockout_mode')

  const playModeCue = (id: ExerciseId) => {
    if (!voiceEnabled) return false
    const cue = modeCueForId(id)
    const played = voicePackLoaded ? playVoiceCue(voiceSelected, cue) : false
    if (!played) {
      playRepSound()
    }
    return played
  }

  const playResetCue = () => {
    if (!voiceEnabled) return false
    const played = voicePackLoaded ? playVoiceCue(voiceSelected, 'reset') : false
    if (!played) {
      playRepSound()
    }
    return played
  }

  const drawDebugOverlay = (
    ctx: CanvasRenderingContext2D,
    signals: FrameSignals,
    activeHand: 'left' | 'right' | 'both' | null,
    phase: string,
    count: number
  ) => {
    const lines: string[] = []
    lines.push(`STATE: ${phase || 'n/a'} | REPS: ${count}`)
    lines.push(`HAND: ${activeHand ?? 'none'} | CONF ${signals.confidence.toFixed(2)} | HIP ${Number.isFinite(signals.hipAngle) ? signals.hipAngle.toFixed(0) + '°' : 'n/a'}`)
    for (const hand of signals.hands) {
      const mark = activeHand === hand.side ? '★' : ' '
      lines.push(
        `${mark} ${hand.side.toUpperCase()} SH ${hand.handAboveShoulder.toFixed(2)} HD ${hand.handAboveHead.toFixed(2)} EL ${hand.elbowAngle.toFixed(0)} CONF ${hand.confidence.toFixed(2)}`
      )
    }
    const pad = 14
    const lineHeight = 24
    const boxWidth = 520
    const boxHeight = pad * 2 + lines.length * lineHeight
    ctx.save()
    ctx.fillStyle = 'rgba(5, 9, 20, 0.85)'
    ctx.fillRect(16, 16, boxWidth, boxHeight)
    ctx.fillStyle = '#e5e7eb'
    ctx.font = '18px monospace'
    lines.forEach((line, idx) => ctx.fillText(line, 28, 16 + pad + idx * lineHeight))
    ctx.restore()
  }

  const handlePoses = (poses: Pose[], ts: number) => {
    if (!shouldInfer() || !ctx) return
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height)
    if (!poses.length) {
      clearOverlay()
      return
    }
    if (lastPoseTs && ts - lastPoseTs > 1000) invalidateTracking()
    const pose = poses[0]
    drawPose(ctx, pose)
    tracking = true
    clearTimeout(staleTimer)
    staleTimer = setTimeout(clearOverlay, 1000)

    const delta = lastPoseTs ? ts - lastPoseTs : 0
    const fps = delta ? Math.round(1000 / delta) : 0
    lastPoseTs = ts

    const frameSignals = extractFrameSignals(pose, canvasEl.width / 1920)
    lastSignals = frameSignals
    const gestureEvents = gesturesEnabled
      ? gestureEngine.update(frameSignals, currentThresholds.swing, ts)
      : []
    if (gestureEvents.length) {
      handleGestureEvents(gestureEvents)
    }
    const update = countingEnabled ? counter?.update(frameSignals, ts) : null
    lastActiveHand = typeof counter?.getActiveHand === 'function' ? counter.getActiveHand() : null
    if (update?.state) lastPhase = update.state
    if (update) {
      repCount.set(update.count)
      if (update.count > lastCount) {
        updateRpm(ts)
        let voiced = false
        if (voiceEnabled && voicePackLoaded && update.count <= voiceMaxNumber) {
          voiced = playNumberFromPack(voiceSelected, update.count)
        }
        if (!voiced) {
          playRepSound()
        }
      }
      lastCount = update.count
      // Suppress transient "rep counted" feedback to avoid layout shifts
      if (update.feedback && update.feedback.toLowerCase() !== 'rep counted') {
        feedback.set(update.feedback)
      }
    }

    if (ts - lastStatsTs >= 500) {
      lastStatsTs = ts
      poseStats.update((s) => ({ ...s, fps, confidence: frameSignals.confidence, backend }))
    }

    if (debugOverlay && lastSignals) {
      drawDebugOverlay(ctx, lastSignals, lastActiveHand, lastPhase, lastCount)
    }
  }

  const clearOverlay = () => {
    ctx?.clearRect(0, 0, canvasEl?.width ?? 0, canvasEl?.height ?? 0)
    tracking = false
    clearTimeout(staleTimer)
    if (Date.now() - lastStatsTs >= 500) {
      lastStatsTs = Date.now()
      poseStats.update((stats) => ({ ...stats, fps: 0, confidence: 0 }))
    }
  }

  const invalidateTracking = () => {
    client?.invalidate()
    counter?.resetTracking()
    gestureEngine.reset()
    lastPoseTs = 0
    lastVideoTime = -1
    lastSendTs = 0
    clearRpm()
    clearOverlay()
  }

  const shouldInfer = () => mounted && visible && $runState === 'running' &&
    (countingEnabled || gesturesEnabled) && !!stream && !cameraPreparing

  const cancelLoop = () => {
    if (videoCallback !== null) videoEl?.cancelVideoFrameCallback(videoCallback)
    videoCallback = null
    cancelAnimationFrame(raf)
    raf = 0
  }

  const scheduleFrame = () => {
    if (!shouldInfer() || !detectorReady || videoCallback !== null || raf) return
    if (typeof videoEl.requestVideoFrameCallback === 'function') {
      videoCallback = videoEl.requestVideoFrameCallback(() => {
        videoCallback = null
        sampleFrame()
      })
    } else {
      raf = requestAnimationFrame(() => { raf = 0; sampleFrame() })
    }
  }

  const sampleFrame = () => {
    if (!shouldInfer() || !detectorReady) return
    const now = performance.now()
    if (videoEl.readyState >= 2 && videoEl.videoWidth &&
      now - lastSendTs >= (lowFpsMode ? 100 : 50) && videoEl.currentTime !== lastVideoTime) {
      lastSendTs = now
      lastVideoTime = videoEl.currentTime
      const size = frameSize(videoEl.videoWidth, videoEl.videoHeight)
      if (canvasEl.width !== size.width || canvasEl.height !== size.height) {
        canvasEl.width = size.width
        canvasEl.height = size.height
      }
      videoAspect = videoEl.videoWidth / videoEl.videoHeight
      void client?.capture(() => createImageBitmap(videoEl, {
        resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'low'
      }))
    }
    scheduleFrame()
  }

  const canPrepareDetector = () => mounted && visible && $runState === 'running' && !!stream && !cameraPreparing

  const prepareDetector = async () => {
    if (client || preparingDetector || detectorError || !canPrepareDetector()) return
    preparingDetector = true
    const attempt = cameraAttempt
    try {
      const { PoseClient } = await import('../pose/poseClient')
      if (!mounted || attempt !== cameraAttempt || !canPrepareDetector()) return
      client = new PoseClient({
        onReady: handleReady,
        onPoses: handlePoses,
        onError: handleError,
        onMetrics: (import.meta.env.DEV || import.meta.env.VITE_COUNTER_DIAGNOSTICS === '1') ? (metrics) => {
          // Opt in from DevTools; retain only a bounded sample window.
          const diagnostics = (window as any).__kbPoseMetrics
          if (Array.isArray(diagnostics)) {
            diagnostics.push({ ...metrics, at: Date.now(), width: canvasEl.width, height: canvasEl.height, backend })
            if (diagnostics.length > 1200) diagnostics.shift()
          }
        } : undefined
      })
      client.init()
    } catch (error) {
      handleError(String(error))
    } finally {
      preparingDetector = false
    }
  }

  const syncLoop = () => {
    // Warm up during the workout's preparation phase, before the first reps.
    if (canPrepareDetector()) void prepareDetector()
    if (!shouldInfer()) { cancelLoop(); return }
    scheduleFrame()
  }

  const startCamera = async () => {
    const attempt = ++cameraAttempt
    cameraPreparing = true
    cameraError = null
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
        audio: false
      })
      if (!mounted || attempt !== cameraAttempt || $runState === 'idle') {
        acquired.getTracks().forEach((track) => track.stop())
        return
      }
      stream = acquired
      for (const track of acquired.getVideoTracks()) track.onended = () => {
        if (stream === acquired) {
          cameraError = 'Camera disconnected. Retry the camera.'
          invalidateTracking()
          stopCamera()
          syncLoop()
        }
      }
      videoEl.srcObject = acquired
      await videoEl.play()
      if (attempt !== cameraAttempt) return
      videoAspect = videoEl.videoWidth / videoEl.videoHeight || 4 / 3
      ctx = canvasEl.getContext('2d')
    } catch (error) {
      if (attempt !== cameraAttempt || !mounted) return
      cameraError = error instanceof Error ? error.message : 'Unable to access camera'
      stopCamera()
    } finally {
      if (attempt === cameraAttempt) {
        cameraPreparing = false
        syncLoop()
      }
    }
  }

  const stopCamera = () => {
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    if (videoEl) videoEl.srcObject = null
  }

  const retryCamera = async () => {
    invalidateTracking()
    client?.destroy()
    client = null
    detectorReady = false
    detectorError = null
    stopCamera()
    await startCamera()
  }

  export const startSession = async () => {
    if ($runState === 'running' || cameraPreparing) return
    invalidateTracking()
    resetCount()
    feedback.set(null)
    detectorError = null
    // The host owns phase directives; do not overwrite them after async startup.
    if (showControls !== false) {
      gesturesEnabled = true
      countingEnabled = true
      gesturesEnabledStore.set(true)
      countingEnabledStore.set(true)
      overlayMode = $exercise
    }
    initAudio()
    runState.set('running')
    const cameraStarted = startCamera()
    void loadVoiceSelected()
    await cameraStarted
  }

  export const pauseSession = () => {
    runState.set('paused')
    invalidateTracking()
    syncLoop()
  }

  export const resumeSession = () => {
    invalidateTracking()
    runState.set('running')
    syncLoop()
  }

  const resetCount = (message: string | null = null, announce = false) => {
    invalidateTracking()
    repCount.set(0)
    lastCount = 0
    clearRpm()
    counter?.reset()
    preloadVoiceNumbers(voiceSelected, 0)
    feedback.set(message)
    if (announce) {
      playResetCue()
    }
  }

  // External hook for embedding contexts (e.g., Big Picture) to zero the rep counter.
  export const resetReps = () => resetCount(null, false)

  export const stopSession = () => {
    cameraAttempt += 1
    cameraPreparing = false
    runState.set('idle')
    invalidateTracking()
    cancelLoop()
    client?.destroy()
    client = null
    detectorReady = false
    detectorError = null
    releaseVoicePack()
    releaseAudio()
    voicePackLoaded = false
    poseStats.set({ fps: 0, ready: false, backend: '', confidence: 0 })
    gesturesEnabled = true
    countingEnabled = true
    gesturesEnabledStore.set(true)
    countingEnabledStore.set(true)
    overlayMode = $exercise
    clearRpm()
    stopCamera()
  }

  export const setModeFromHost = (
    mode: ExerciseId | 'disabled',
    options: { silent?: boolean } = {}
  ) => {
    invalidateTracking()
    if (mode === 'disabled') {
      countingEnabled = false
      countingEnabledStore.set(false)
      overlayMode = 'disabled'
      clearRpm()
      return
    }
    overlayMode = mode
    const silent = options.silent ?? true
    setExerciseMode(mode, { silent })
  }

  export const setGesturesEnabled = (enabled: boolean) => {
    if (gesturesEnabled !== !!enabled) invalidateTracking()
    gesturesEnabled = !!enabled
    gesturesEnabledStore.set(gesturesEnabled)
  }

  export const setCountingEnabled = (enabled: boolean) => {
    if (countingEnabled !== !!enabled) invalidateTracking()
    countingEnabled = !!enabled
    countingEnabledStore.set(countingEnabled)
    clearRpm()
  }

  $: effectiveMode = countingEnabled ? overlayMode : 'disabled'
  $: modeBadgeLabel =
    effectiveMode === 'disabled'
      ? 'Disabled'
      : effectiveMode === 'lockout'
        ? 'Lockout mode'
        : 'Swing mode'

  const visibilityChanged = () => {
    visible = document.visibilityState === 'visible'
    invalidateTracking()
    syncLoop()
  }

  // Dependencies must be explicit for Svelte's legacy reactive statements.
  $: if (mounted) {
    visible; countingEnabled; gesturesEnabled; $runState; detectorReady; cameraPreparing
    syncLoop()
  }
  $: if (mounted && voiceEnabled && $runState !== 'idle') {
    voiceSelected
    void loadVoiceSelected()
  }
  $: if (mounted && !voiceEnabled) { releaseVoicePack(); voicePackLoaded = false }

  onMount(() => {
    mounted = true
    visible = document.visibilityState === 'visible'
    document.addEventListener('visibilitychange', visibilityChanged)
    if (autoStart) void startSession()
  })

  onDestroy(() => {
    mounted = false
    stopSession()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibilityChanged)
    if (countdownTimer) clearInterval(countdownTimer)
  })

  $: {
    let changed = false
    if ($settings.counter.lowFpsMode !== lowFpsMode) {
      lowFpsMode = $settings.counter.lowFpsMode
      changed = true
    }
    if ($settings.counter.voiceEnabled !== voiceEnabled) {
      voiceEnabled = $settings.counter.voiceEnabled
      changed = true
    }
    if ($settings.counter.debugOverlay !== debugOverlay) {
      debugOverlay = $settings.counter.debugOverlay
      changed = true
    }
    if ($settings.counter.voiceSelected && $settings.counter.voiceSelected !== voiceSelected) {
      voiceSelected = $settings.counter.voiceSelected
      changed = true
    }
    if (changed) {
      setCounterSettings({ lowFpsMode, debugOverlay, voiceEnabled, voiceSelected })
    }
  }
</script>

<div class="session" class:running={$runState === 'running'}>
  <div class="video-panel" style={`aspect-ratio: ${videoAspect}`}>
    <video bind:this={videoEl} muted playsinline></video>
    <canvas bind:this={canvasEl}></canvas>
    {#if cameraError || detectorError}
      <div class="camera-status" role="status">
        <span>{cameraError || detectorError}</span>
        {#if $runState !== 'idle'}<button type="button" on:click={retryCamera}>Retry camera</button>{/if}
      </div>
    {:else if $runState === 'idle' || cameraPreparing || !detectorReady || !tracking || $runState === 'paused'}
      <div class="camera-status" role="status">
        {$runState === 'idle' ? 'Camera starts with your workout' : cameraPreparing ? 'Opening camera…' :
          $runState === 'paused' ? 'Counter paused' : !countingEnabled && !gesturesEnabled ? 'Counter off for this phase' :
          !detectorReady ? 'Preparing counter…' : 'Position your full body in view'}
      </div>
    {/if}
    <div class="mode-badge" class:lockout={effectiveMode === 'lockout'} class:disabled={effectiveMode === 'disabled'}>
      <div class="mode-label">Mode</div>
      <div class="mode-value">{modeBadgeLabel}</div>
    </div>
    <div class="rep-badge">
      <div class="rep-label">Reps</div>
      <div class="rep-number">{$repCount}</div>
    </div>
    {#if debugOverlay}
      <div class="phase-badge">
        <div class="phase-label">State</div>
        <div class="phase-value">{lastPhase || 'n/a'}</div>
        <div class="phase-sub">Hand: {lastActiveHand ?? 'none'}</div>
      </div>
    {/if}
  </div>

  {#if showControls !== false}
    <div class="controls">
      <div class="row mode-row">
        <div class="mode-buttons">
          <button class="large mode-btn" class:active={$exercise === 'swing'} on:click={() => setExerciseMode('swing')}>
            Swing mode
          </button>
          <button class="large mode-btn" class:active={$exercise === 'lockout'} on:click={() => setExerciseMode('lockout')}>
            Lockout mode
          </button>
        </div>
      </div>

      <div class="row session-actions">
        <button class="primary large" on:click={$runState === 'paused' ? resumeSession : startSession} disabled={$runState === 'running'}>
          {$runState === 'running' ? 'Running' : $runState === 'paused' ? 'Resume' : 'Start'}
        </button>
        <button class="large" on:click={pauseSession} disabled={$runState !== 'running'}>Pause</button>
        <button class="large" on:click={stopSession}>Stop</button>
        <button class="ghost large" on:click={() => resetCount('Counter reset', true)}>Reset count</button>
      </div>
    </div>
  {/if}

  {#if showStats !== false}
    <details class="diagnostics">
      <summary>Diagnostics <span>FPS, backend, confidence, and calibration</span></summary>
      <div class="row stats">
      <div>
        <div class="label">Reps</div>
        <div class="value">{$repCount}</div>
      </div>
      <div>
        <div class="label">FPS</div>
        <div class="value">{$poseStats.fps || 0}</div>
      </div>
      <div>
        <div class="label">Backend</div>
        <div class="value">{backend || 'loading...'}</div>
      </div>
      <div>
        <div class="label">Confidence</div>
        <div class="value">{(lastSignals?.confidence ?? 0).toFixed(2)}</div>
      </div>
      {#if lastSignals}
        <div>
          <div class="label">Hand used</div>
          <div class="value">{lastActiveHand ?? 'auto'}</div>
        </div>
      {/if}
      </div>

      <div class="row stats calib">
      {#if currentExercise.type === 'swing'}
        <div>
          <div class="label">Apex height</div>
          <div class="value smallnum">{currentThresholds.swing.apexHeight.toFixed(2)}x torso</div>
        </div>
        <div>
          <div class="label">Stand angle</div>
          <div class="value smallnum">{currentThresholds.swing.hingeExit.toFixed(0)}°</div>
        </div>
        <div>
          <div class="label">Reset cues</div>
          <div class="value smallnum">
            Hand &lt; {currentThresholds.swing.resetHeight.toFixed(2)}x or hip &lt; {currentThresholds.swing.hingeExit.toFixed(0)}°
          </div>
        </div>
      {:else}
        <div>
          <div class="label">Lockout head</div>
          <div class="value smallnum">{LOCKOUT_HEAD_THRESH.toFixed(2)}x</div>
        </div>
        <div>
          <div class="label">Hold</div>
          <div class="value smallnum">{LOCKOUT_HOLD_MS} ms</div>
        </div>
        <div>
          <div class="label">Min rep gap</div>
          <div class="value smallnum">{lockoutMinGap} ms</div>
        </div>
        {#if currentLowBand !== null}
          <div>
            <div class="label">Reset band</div>
            <div class="value smallnum">&lt; {currentLowBand.toFixed(2)}x shoulder</div>
          </div>
        {/if}
      {/if}
      </div>
    </details>
  {/if}

    {#if cameraError}
      <div class="error">Camera error: {cameraError}</div>
    {/if}
    {#if $feedback}
      <div class="feedback">{$feedback}</div>
    {/if}
</div>

{#if showControls !== false}
  <div class="mobile-bar">
    <button class="primary" on:click={$runState === 'running' ? pauseSession : $runState === 'paused' ? resumeSession : startSession}>
      {$runState === 'running' ? 'Pause' : $runState === 'paused' ? 'Resume' : 'Start'}
    </button>
    <button disabled={$runState === 'idle'} on:click={stopSession}>Stop</button>
    <button class="ghost" on:click={() => resetCount('Counter reset', true)}>Reset</button>
  </div>
{/if}

<style>
  .camera-status {
    position: absolute;
    inset: auto 0.5rem 0.5rem;
    z-index: 2;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    border-radius: 8px;
    padding: 0.5rem;
    font-size: 0.85rem;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .camera-status button { min-height: 48px; display: block; margin: 0.25rem auto 0; }

  .session {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 1.25rem;
    align-items: flex-start;
  }
  .video-panel {
    position: relative;
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: 16px;
    overflow: hidden;
    background: var(--color-surface-1);
  }
  video,
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  canvas {
    pointer-events: none;
  }
  .controls {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .stats {
    justify-content: space-between;
  }
  .stats .value {
    font-size: 1.6rem;
    font-weight: 800;
  }
  .session.running .stats .value {
    font-size: 2.2rem;
  }
  .session.running .controls {
    gap: 1rem;
  }
  .session.running button {
    font-size: 1rem;
  }
  .rep-badge {
    position: absolute;
    top: 12px;
    left: 12px;
    background: color-mix(in srgb, var(--color-surface-2) 85%, transparent);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.6rem 1rem;
    color: var(--color-text-primary);
  }
  .rep-badge .rep-label {
    font-size: 0.9rem;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }
  .rep-badge .rep-number {
    font-size: 5rem;
    font-weight: 900;
    line-height: 1.05;
  }
  .phase-badge {
    position: absolute;
    top: 76px;
    right: 12px;
    background: color-mix(in srgb, var(--color-surface-2) 90%, transparent);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.55rem 0.85rem;
    color: var(--color-text-primary);
    min-width: 140px;
    text-align: right;
  }
  .phase-badge .phase-label {
    font-size: 0.85rem;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
  }
  .phase-badge .phase-value {
    font-size: 2.4rem;
    font-weight: 900;
    line-height: 1.05;
  }
  .phase-badge .phase-sub {
    font-size: 0.95rem;
    color: var(--color-text-muted);
  }
  .mode-badge {
    position: absolute;
    top: 12px;
    right: 12px;
    background: var(--color-accent);
    color: var(--color-on-accent);
    border-radius: 14px;
    padding: 0.5rem 1rem 0.7rem;
    max-width: 50%;
    text-align: center;
  }
  .mode-badge.lockout {
    background: linear-gradient(135deg, #f97316, #fb923c);
    color: #0a0a0a;
  }
  .mode-badge.disabled {
    background: linear-gradient(135deg, #1f2937, #111827);
    color: #e5e7eb;
    border: 1px solid #374151;
  }
  .mode-badge {
    box-shadow: none;
    border: none;
  }
  .mode-label {
    font-size: 0.85rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.8;
  }
  .mode-value {
    font-size: clamp(0.9rem, 2vw, 1.25rem);
    font-weight: 900;
    line-height: 1.05;
  }
  .stats.calib .value {
    font-size: 1rem;
    font-weight: 700;
  }
  .stats.calib {
    gap: 0.75rem;
  }
  button {
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 1rem 1.3rem;
    cursor: pointer;
    transition: transform 0.1s ease, border-color 0.1s ease;
    font-size: 1.25rem;
    min-height: 60px;
  }
  .large {
    font-size: 1.3rem;
    padding: 1.05rem 1.4rem;
    min-height: 64px;
  }
  button:hover:enabled {
    transform: translateY(-1px);
    border-color: var(--color-accent);
  }
  /* Controls moved to settings; keep base button sizing only */
  .mode-row {
    align-items: stretch;
  }
  .mode-buttons {
    display: flex;
    gap: 0.5rem;
    flex: 1;
    flex-wrap: wrap;
    width: 100%;
  }
  .mode-btn {
    flex: 1;
    font-weight: 800;
    text-transform: none;
    border: 2px solid var(--color-border);
  }
  .mode-btn.active {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
    background: var(--color-accent);
    color: var(--color-on-accent);
  }
  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .primary {
    background: var(--color-accent);
    color: var(--color-on-accent);
    border: none;
  }
  .ghost {
    background: transparent;
    border: 1px dashed var(--color-border);
  }
  .label {
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }
  .error {
    color: #f97316;
    font-weight: 600;
  }
  .feedback {
    color: var(--color-accent);
  }
  .mobile-bar {
    display: none;
  }
  .diagnostics {
    grid-column: 1 / -1;
    margin-top: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-surface-1) 55%, transparent);
  }
  .diagnostics summary {
    cursor: pointer;
    padding: 0.65rem 0.75rem;
    color: var(--color-text-primary);
    font-weight: 700;
  }
  .diagnostics summary span { color: var(--color-text-muted); font-size: 0.82rem; font-weight: 400; margin-left: 0.35rem; }
  .diagnostics .stats { padding: 0.5rem 0.85rem 0.85rem; }
  @media (max-width: 960px) {
    .session {
      grid-template-columns: 1fr;
    }
    .stats {
      gap: 1rem;
    }
  }
  @media (max-width: 640px) {
    .video-panel {
      min-height: 205px;
    }
    .rep-badge { top: 8px; left: 8px; padding: 0.45rem 0.65rem; }
    .rep-badge .rep-number { font-size: 3rem; }
    .mode-badge { top: 8px; right: 8px; padding: 0.45rem 0.6rem; }
    .mode-label { font-size: 0.7rem; }
    .mode-btn { font-size: 1rem; padding: 0.65rem 0.5rem; min-height: 48px; }
    .controls {
      padding: 0.85rem;
    }
    .session-actions { display: none; }
  button {
    min-height: 44px;
  }
    .mobile-bar {
      position: sticky;
      bottom: 0;
      inset-inline: 0;
      display: grid;
      grid-template-columns: 1.3fr 1fr 1fr;
      gap: 0.5rem;
      padding: 0.65rem 0 max(0.65rem, env(safe-area-inset-bottom));
      background: var(--color-surface-2);
      border-top: 1px solid var(--color-border);
      z-index: 10;
    }
    .ghost {
      border-style: solid;
    }
    .mobile-bar button { min-width: 0; padding: 0.65rem 0.35rem; font-size: 1rem; min-height: 48px; }
  }
</style>
