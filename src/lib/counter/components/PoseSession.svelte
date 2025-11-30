<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { Pose } from '@tensorflow-models/pose-detection'
  import {
    calibration,
    exercise,
    feedback,
    poseStats,
    repCount,
    runState,
    thresholds,
    setCalibration,
    type ExerciseId
  } from '../stores/session'
  import { PoseClient } from '../pose/poseClient'
  import { drawPose } from '../pose/drawing'
  import { calibrationFromSamples } from '../pose/calibration'
  import { createCounterForExercise, getExerciseOption } from '../exercises/config'
  import type { RepCounter } from '../pose/repCounter'
  import { extractFrameSignals, type FrameSignals, type MotionSignals } from '../pose/signals'
  import { initAudio, playRepSound } from '../audio/counterSound'
  import {
    getVoiceOptions,
    loadVoicePack,
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
  let processingFrame = false
  let lastSendTs = 0
  let cameraError: string | null = null
  let raf = 0
  let lastPoseTs = 0
  let lastSignals: FrameSignals | null = null
  let lastActiveHand: 'left' | 'right' | 'both' | null = null
  let captureActive = false
  let captureCountdown = 0
  let captureDeadline = 0
  let captureSamples: MotionSignals[] = []
  let countdownTimer: number | null = null
  let backend = ''
  let counter: RepCounter | null = null
  let lastExerciseId: ExerciseId | null = null
  const gestureEngine = new GestureEngine()
  let lastCount = 0
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
  const LOCKOUT_HEAD_THRESH = 0.5
  const LOCKOUT_HOLD_MS = 100

  $: currentThresholds = $thresholds
  $: currentCalibration = $calibration
  $: currentExercise = getExerciseOption($exercise)
  $: counter = createCounterForExercise(currentExercise.id, currentThresholds)
  $: lockoutMinGap = 400
  $: currentLowBand = currentExercise.type === 'lockout' ? 0.28 : null
  $: if (currentExercise.id !== lastExerciseId && counter) {
    repCount.set(0)
    lastCount = 0
    counter.reset()
    lastExerciseId = currentExercise.id
    gestureEngine.reset()
  }

  const handleReady = (backendName: string) => {
    detectorReady = true
    backend = backendName
    poseStats.update((s) => ({ ...s, ready: true, backend: backendName }))
  }

  const handleError = (message: string) => {
    console.error(message)
    feedback.set(message)
  }

  const handleGestureEvents = (events: GestureEvent[]) => {
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

  const setExerciseMode = (id: ExerciseId) => {
    if (id === $exercise) return
    exercise.set(id)
    const opt = getExerciseOption(id)
    feedback.set(`Mode: ${opt.label}`)
    playModeCue(id)
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
    const pack = await loadVoicePack(voiceSelected)
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
    if (!poses.length || !ctx) return
    const pose = poses[0]
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height)
    drawPose(ctx, pose)

    const delta = lastPoseTs ? ts - lastPoseTs : 0
    const fps = delta ? Math.round(1000 / delta) : 0
    lastPoseTs = ts

    const frameSignals = extractFrameSignals(pose)
    lastSignals = frameSignals
    const gestureEvents = gestureEngine.update(frameSignals, currentThresholds, ts)
    if (gestureEvents.length) {
      handleGestureEvents(gestureEvents)
    }
    const update = counter?.update(frameSignals, ts)
    lastActiveHand = typeof counter?.getActiveHand === 'function' ? counter.getActiveHand() : null
    if (update?.state) lastPhase = update.state
    if (update) {
      repCount.set(update.count)
      if (update.count > lastCount) {
        let voiced = false
        if (voiceEnabled && voicePackLoaded && update.count <= voiceMaxNumber) {
          voiced = playNumberFromPack(voiceSelected, update.count)
        }
        if (!voiced) {
          playRepSound()
        }
      }
      lastCount = update.count
      if (update.feedback) feedback.set(update.feedback)
      poseStats.update((s) => ({
        ...s,
        fps,
        confidence: frameSignals.confidence,
        backend
      }))
      if (captureActive && frameSignals.confidence > 0.35) {
        // keep backward-compatible calibration samples using the best hand
        const bestHand = frameSignals.hands.reduce((b, h) => (h.confidence > b.confidence ? h : b), frameSignals.hands[0])
        captureSamples.push({
          hipAngle: frameSignals.hipAngle,
          handHeightHip: bestHand.handHeightHip,
          handAboveShoulder: bestHand.handAboveShoulder,
          handAboveHead: bestHand.handAboveHead,
          elbowAngle: bestHand.elbowAngle,
          confidence: bestHand.confidence,
          handUsed: bestHand.side
        })
      }
    }

    if (debugOverlay && lastSignals) {
      drawDebugOverlay(ctx, lastSignals, lastActiveHand, lastPhase, lastCount)
    }

    if (captureActive && Date.now() > captureDeadline) {
      const nextCalibration = calibrationFromSamples(captureSamples, currentCalibration)
      setCalibration(nextCalibration)
      captureActive = false
      captureSamples = []
      feedback.set('Calibration updated')
    }
  }

  const startCamera = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640, max: 640 },
          height: { ideal: 480, max: 480 }
        },
        audio: false
      })
      videoEl.srcObject = stream
      await videoEl.play()
      videoAspect = videoEl.videoWidth && videoEl.videoHeight ? videoEl.videoWidth / videoEl.videoHeight : 16 / 9
      canvasEl.width = videoEl.videoWidth
      canvasEl.height = videoEl.videoHeight
      ctx = canvasEl.getContext('2d')
      cameraError = null
    } catch (err) {
      cameraError = err instanceof Error ? err.message : 'Unable to access camera'
    }
  }

  const stopCamera = () => {
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
  }

  const startLoop = () => {
    const loop = async () => {
      if ($runState !== 'running' || !detectorReady || !videoEl?.videoWidth) {
        raf = requestAnimationFrame(loop)
        return
      }

      const now = performance.now()
      const minGapMs = lowFpsMode ? 100 : 50 // ~10 FPS in low mode, ~20 FPS default
      if (now - lastSendTs < minGapMs) {
        raf = requestAnimationFrame(loop)
        return
      }

      if (!processingFrame) {
        processingFrame = true
        try {
          const bitmap = await createImageBitmap(videoEl, 0, 0, videoEl.videoWidth, videoEl.videoHeight)
          client?.sendFrame(bitmap)
          lastSendTs = now
        } catch (err) {
          console.error(err)
        } finally {
          processingFrame = false
        }
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
  }

  export const startSession = async () => {
    repCount.set(0)
    lastCount = 0
    counter?.reset()
    feedback.set(null)
    gestureEngine.reset()
    lastSendTs = 0
    initAudio()
    await startCamera()
    $runState !== 'running' && runState.set('running')
  }

  export const pauseSession = () => {
    runState.set('paused')
  }

  const resetCount = (message: string | null = null, announce = false) => {
    repCount.set(0)
    lastCount = 0
    counter?.reset()
    feedback.set(message)
    if (announce) {
      playResetCue()
    }
  }

  // External hook for embedding contexts (e.g., Big Picture) to zero the rep counter.
  export const resetReps = () => resetCount(null, false)

  export const stopSession = () => {
    runState.set('idle')
    stopCamera()
  }

  const startCalibrationCapture = async () => {
    if ($runState !== 'running') {
      await startSession()
    }
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
    captureSamples = []
    captureActive = false
    captureCountdown = 5
    feedback.set('Calibration starts in 5...')
    countdownTimer = window.setInterval(() => {
      captureCountdown -= 1
      if (captureCountdown <= 0) {
        if (countdownTimer) {
          clearInterval(countdownTimer)
          countdownTimer = null
        }
        captureActive = true
        captureDeadline = Date.now() + 10000
        feedback.set('Capturing 2–3 slow reps for calibration (10s window)...')
      } else {
        feedback.set(`Calibration starts in ${captureCountdown}...`)
      }
    }, 1000)
  }

  onMount(() => {
    client = new PoseClient({
      onReady: handleReady,
      onPoses: handlePoses,
      onError: handleError
    })
    client.init()
    loadVoiceSelected()
    startLoop()
    if (autoStart) startSession()
  })

  onDestroy(() => {
    stopSession()
    cancelAnimationFrame(raf)
    client?.destroy()
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
    <div class="mode-badge" class:lockout={$exercise === 'lockout'}>
      <div class="mode-label">Mode</div>
      <div class="mode-value">{currentExercise.label}</div>
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

      <div class="row">
        <button class="primary large" on:click={startSession} disabled={$runState === 'running'}>
          {$runState === 'running' ? 'Running' : 'Start'}
        </button>
        <button class="large" on:click={pauseSession} disabled={$runState !== 'running'}>Pause</button>
        <button class="large" on:click={stopSession}>Stop</button>
        <button class="ghost large" on:click={() => resetCount('Counter reset', true)}>Reset count</button>
      </div>
    </div>
  {/if}

  {#if showStats !== false}
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
          <div class="value smallnum">{currentThresholds.apexHeight.toFixed(2)}x torso</div>
        </div>
        <div>
          <div class="label">Stand angle</div>
          <div class="value smallnum">{currentThresholds.hingeExit.toFixed(0)}°</div>
        </div>
        <div>
          <div class="label">Reset cues</div>
          <div class="value smallnum">Hand &lt; hip or hip &lt; 150°</div>
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
    <button class="primary" on:click={$runState === 'running' ? pauseSession : startSession}>
      {$runState === 'running' ? 'Pause' : 'Start'}
    </button>
    <button on:click={stopSession}>Stop</button>
    <button class="ghost" on:click={startCalibrationCapture} disabled={captureActive}>
      Calibrate
    </button>
  </div>
{/if}

<style>
  .session {
    display: grid;
    grid-template-columns: 1fr 1fr;
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
    backdrop-filter: blur(4px);
  }
  .rep-badge .rep-label {
    font-size: 0.9rem;
    letter-spacing: 0.04em;
    color: #93c5fd;
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
    color: #93c5fd;
  }
  .phase-badge .phase-value {
    font-size: 2.4rem;
    font-weight: 900;
    line-height: 1.05;
  }
  .phase-badge .phase-sub {
    font-size: 0.95rem;
    color: #cbd5e1;
  }
  .mode-badge {
    position: absolute;
    top: 12px;
    right: 12px;
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
    color: var(--color-text-inverse);
    border-radius: 14px;
    padding: 0.5rem 1rem 0.7rem;
    box-shadow: 0 10px 30px color-mix(in srgb, var(--color-accent) 35%, transparent);
    min-width: 180px;
    text-align: center;
  }
  .mode-badge.lockout {
    background: linear-gradient(135deg, #f97316, #fb923c);
    color: #0a0a0a;
    box-shadow: 0 10px 30px rgba(249, 115, 22, 0.35);
  }
  .mode-label {
    font-size: 0.85rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.8;
  }
  .mode-value {
    font-size: 1.9rem;
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
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
    color: var(--color-text-inverse);
  }
  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .primary {
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
    color: var(--color-text-inverse);
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
    color: #22d3ee;
  }
  .mobile-bar {
    display: none;
  }
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
      aspect-ratio: auto;
    }
    .controls {
      padding: 0.85rem;
    }
  button {
    min-height: 44px;
  }
    .mobile-bar {
      position: sticky;
      bottom: 0;
      inset-inline: 0;
      display: flex;
      gap: 0.5rem;
      padding: 0.65rem 0.4rem 0.75rem;
      background: linear-gradient(180deg, rgba(5, 9, 20, 0.2), #050914);
      backdrop-filter: blur(6px);
      border-top: 1px solid #1f2937;
      z-index: 10;
    }
    .ghost {
      border-style: solid;
    }
  }
</style>
