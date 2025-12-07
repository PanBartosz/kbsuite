<script>
import { onMount, onDestroy, createEventDispatcher } from 'svelte'
import YAML from 'yaml'
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import { initAudio, playCue, playCountdown, startMetronome, stopMetronome } from '$lib/timer/lib/audio.js'
import { speakWithOpenAI, cancelOpenAiSpeech } from '$lib/timer/lib/openaiTts.js'
import { buildAnnouncementSchedule, selectDueAnnouncements } from '$lib/timer/lib/ttsScheduler.js'
import { buildTimeline, computeTimelineDuration, cleanAnnouncements } from '$lib/timer/lib/timeline.js'
import defaultPlanSource from '$lib/timer/config/default-plan.yaml?raw'
import { libraryTemplates } from '$lib/timer/library/index.js'
import TimerDisplay from '$lib/timer/components/TimerDisplay.svelte'
import PhaseQueue from '$lib/timer/components/PhaseQueue.svelte'
import ControlBar from '$lib/timer/components/ControlBar.svelte'
import YamlHelpModal from '$lib/timer/components/YamlHelpModal.svelte'
  import LibraryModal from '$lib/timer/components/LibraryModal.svelte'
  import PlanEditorModal from '$lib/timer/components/PlanEditorModal.svelte'
  import RoundEditorModal from '$lib/timer/components/RoundEditorModal.svelte'
  import SetEditorModal from '$lib/timer/components/SetEditorModal.svelte'
  import TimerWorker from '$lib/timer/workers/timerWorker.js?worker'
  import { settings, openSettingsModal, setTimerSettings } from '$lib/stores/settings'
import {
  applyRepCountToPhase,
  openSummaryModal,
  seedSummaryEntries,
  setSummaryEntries,
  setSummaryMetadata,
  summaryEntries,
  summaryLatestRepCount
} from '$lib/stats/summaryStore'
import { get } from 'svelte/store'
import '$lib/timer/app.css'

  const dispatch = createEventDispatcher()

  export let compact = false
  export let hideHeader = false
  export let hideControlBar = false
  export let showInlineSlot = false
  export let initialWorkoutId = ''
  export let initialPlannedId = ''

  const coerceSeconds = (value) => {
    const numeric = Number(value)
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0
  }

  const coerceRepetitions = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return 1
    return Math.max(1, Math.round(numeric))
  }

  const normalizeRepCounterMode = (value) => {
    if (typeof value !== 'string') return 'disabled'
    const normalized = value.trim().toLowerCase()
    if (normalized === 'swing' || normalized === 'lockout') return normalized
    if (normalized === 'disabled') return 'disabled'
    return 'disabled'
  }

  const normalizeRepCounterScope = (value) => (value === 'all' ? 'all' : 'work')

  const normalizeBoolean = (value, defaultValue) =>
    value === true ? true : value === false ? false : defaultValue

  const normalizePlan = (candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('Plan must be a YAML mapping/object')
    }
    if (!Array.isArray(candidate.rounds) || candidate.rounds.length === 0) {
      throw new Error('Plan must include at least one round')
    }
    const preStartSeconds = coerceSeconds(candidate.preStartSeconds)
    const preStartLabel =
      typeof candidate.preStartLabel === 'string' && candidate.preStartLabel.trim().length > 0
        ? candidate.preStartLabel.trim()
        : 'Prepare'
    const description =
      typeof candidate.description === 'string' ? candidate.description.trim() : ''
    const defaultRepCounterMode = normalizeRepCounterMode(candidate.defaultRepCounterMode)
    const enableRepCounter = normalizeRepCounterScope(candidate.enableRepCounter)
    const enableModeChanging = normalizeBoolean(candidate.enableModeChanging, true)

    const rounds = candidate.rounds.map((round, roundIndex) => {
      if (!round || typeof round !== 'object') {
        throw new Error(`Round ${roundIndex + 1} must be an object`)
      }
      if (!Array.isArray(round.sets) || round.sets.length === 0) {
        throw new Error(
          `Round "${round.label ?? `#${roundIndex + 1}`}" requires a sets array`
        )
      }

      const roundId = round.id ?? `round-${roundIndex + 1}`

      return {
        id: roundId,
        label: round.label ?? `Round ${roundIndex + 1}`,
        repetitions: coerceRepetitions(round.repetitions),
        restAfterSeconds: coerceSeconds(round.restAfterSeconds),
        sets: round.sets.map((set, setIndex) => {
          if (!set || typeof set !== 'object') {
            throw new Error(
              `Set ${setIndex + 1} in round "${round.label ?? roundId}" must be an object`
            )
          }
          return {
            id: set.id ?? `${roundId}-set-${setIndex + 1}`,
            label: set.label ?? `Set ${setIndex + 1}`,
            workSeconds: coerceSeconds(set.workSeconds),
            restSeconds: coerceSeconds(set.restSeconds),
            repetitions: coerceRepetitions(set.repetitions),
            transitionSeconds: coerceSeconds(set.transitionSeconds),
            targetRpm:
              set.targetRpm !== undefined && set.targetRpm !== null
                ? Math.max(Number(set.targetRpm) || 0, 0)
                : null,
            announcements: cleanAnnouncements(set.announcements),
            restAnnouncements: cleanAnnouncements(set.restAnnouncements),
            repCounterMode: normalizeRepCounterMode(set.repCounterMode ?? defaultRepCounterMode),
            enableModeChanging: normalizeBoolean(
              set.enableModeChanging,
              enableModeChanging
            )
          }
        })
      }
    })

    return {
      title: candidate.title ?? 'Untitled session',
      description,
      preStartSeconds,
      preStartLabel,
      rounds,
      defaultRepCounterMode,
      enableRepCounter,
      enableModeChanging
    }
  }

  const tryParsePlan = (source) => {
    try {
      const parsed = YAML.parse(source)
      const plan = normalizePlan(parsed)
      return { plan, error: null }
    } catch (error) {
      return { plan: null, error }
    }
  }

  const STORAGE_KEY = 'gs-ai-timer.workouts'
  const isBrowser = typeof window !== 'undefined'
  const audioSupported =
    isBrowser && typeof window.AudioContext !== 'undefined'
      ? true
      : isBrowser && typeof window.webkitAudioContext !== 'undefined'
  const canUseNotifications = isBrowser && typeof window.Notification !== 'undefined'

  const createId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    return `workout-${Date.now().toString(36)}`
  }

  const loadSavedWorkoutsFromStorage = () => {
    if (!isBrowser) return []
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter(
          (item) =>
            item &&
            typeof item === 'object' &&
            typeof item.id === 'string' &&
            typeof item.name === 'string' &&
            typeof item.source === 'string'
        )
        .map((item) => ({
          id: item.id,
          name: item.name,
          source: item.source,
          updatedAt: item.updatedAt ?? Date.now()
        }))
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    } catch (error) {
      console.warn('Failed to load saved workouts', error)
      return []
    }
  }

  const persistSavedWorkouts = (workouts) => {
    if (!isBrowser) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workouts))
    } catch (error) {
      console.warn('Failed to persist workouts', error)
    }
  }

  const workoutFromApi = (item) => ({
    id: item.id,
    name: item.name,
    source: item.yaml_source,
    updatedAt: item.updated_at ?? Date.now()
  })

  const loadSavedWorkoutsFromApi = async () => {
    try {
      const res = await fetch('/api/workouts')
      if (!res.ok) throw new Error('Failed to load workouts')
      const data = await res.json()
      if (!Array.isArray(data?.workouts)) throw new Error('Invalid workout data')
      return data.workouts.map(workoutFromApi)
    } catch (error) {
      console.warn('Failed to load workouts from API', error)
      pushToast((error && error.message) || 'Failed to load workouts', 'error')
      return null
    }
  }

  const findWorkoutById = (id) => savedWorkouts.find((w) => w.id === id)

  const mergeWorkouts = (localList = [], remoteList = []) => {
    const map = new Map()
    const add = (workout) => {
      if (!workout?.id) return
      const existing = map.get(workout.id)
      if (!existing || (workout.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
        map.set(workout.id, workout)
      }
    }
    localList.forEach(add)
    remoteList.forEach(add)
    return Array.from(map.values()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }

  const saveWorkoutToApi = async (entry, planObject) => {
    try {
      await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: entry.id,
          name: entry.name,
          description: planObject?.description ?? '',
          yaml_source: entry.source,
          plan_json: planObject ?? null
        })
      })
    } catch (error) {
      console.warn('Failed to persist workout to API', error)
    }
  }

  const buildLibraryWorkouts = () =>
    libraryTemplates
      .map((template) => {
        try {
          const source = (template?.source ?? '').trim()
          if (!source) return null
          const parsed = YAML.parse(source)
          const plan = normalizePlan(parsed)
          const totals = computePlanTotals(plan)
          return {
            id: template?.id ?? plan.title ?? createId(),
            name: plan.title ?? 'Untitled session',
            description: plan.description ?? '',
            roundCount: plan.rounds.length,
            totals,
            source
          }
        } catch (error) {
          console.warn('Failed to load library workout', template?.id ?? '<unknown>', error)
          return null
        }
      })
      .filter(Boolean)

  const libraryWorkouts = buildLibraryWorkouts()

  const buildSummaryEntries = () => {
    if (!timeline.length) return []
    return timeline.map((phase, idx) => {
      if (phase.type === 'prep') return null
      const roundLabel =
        phase.metadata?.roundLabel ??
        phase.roundId ??
        (Number.isInteger(phase.roundIndex) ? `Round ${phase.roundIndex + 1}` : 'Round')
      let setLabel =
        phase.metadata?.setLabel ??
        phase.setId ??
        phase.label ??
        (phase.type === 'work' ? `Set ${Number(phase.setIndex) + 1 || ''}`.trim() : phase.type)

      if (phase.type === 'roundRest') {
        setLabel = 'Rest between rounds'
      } else if (phase.type === 'roundTransition') {
        setLabel = 'Next round prep'
      } else if (phase.type === 'transition') {
        setLabel = phase.label ?? 'Transition'
      } else if (phase.type === 'rest' && !phase.label) {
        setLabel = 'Rest between sets'
      }

      return {
        id: phase.id ?? `phase-${idx}`,
        roundLabel,
        setLabel,
        phaseIndex: idx,
        type: phase.type,
        durationSeconds: phase.durationSeconds ?? phase.duration ?? 0,
        plannedReps: phase.type === 'work' ? null : null,
        loggedReps: null,
        autoFilled: false,
        weight: null
      }
    }).filter(Boolean)
  }

  const buildSummaryKey = () => {
    if (!timeline.length) return ''
    return timeline
      .filter((phase) => phase.type === 'work')
      .map(
        (phase, idx) =>
          `${phase.roundId ?? phase.roundIndex ?? 'r'}-${phase.setId ?? phase.setIndex ?? 's'}-${phase.id ?? phase.label ?? idx}-${phase.durationSeconds ?? 0}`
      )
      .join('|')
  }

  const requestNotificationPermission = async () => {
    if (!canUseNotifications) {
      notificationPermission = 'denied'
      notificationsEnabled = false
      return 'denied'
    }

    try {
      const permission =
        typeof window.Notification.requestPermission === 'function'
          ? await window.Notification.requestPermission()
          : window.Notification.permission
      notificationPermission = permission ?? 'default'
      if (permission !== 'granted') {
        notificationsEnabled = false
      }
      return notificationPermission
    } catch (error) {
      console.warn('Notification permission request failed', error)
      notificationPermission = 'denied'
      notificationsEnabled = false
      return 'denied'
    }
  }

  const EMPTY_TOTALS = Object.freeze({ work: 0, rest: 0, total: 0 })

  function durationOf(phase) {
    const raw = phase?.durationSeconds ?? phase?.duration ?? 0
    const seconds = Number(raw)
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  }

  function computePlanTotals(planToMeasure) {
    if (!planToMeasure || !Array.isArray(planToMeasure.rounds)) {
      return { ...EMPTY_TOTALS }
    }

    const derivedTimeline = buildTimeline(planToMeasure)
    return derivedTimeline.reduce(
      (totals, phase) => {
        const duration = durationOf(phase)
        totals.total += duration
        if (phase.type === 'work') {
          totals.work += duration
        } else {
          totals.rest += duration
        }
        return totals
      },
      { work: 0, rest: 0, total: 0 }
    )
  }

  function roundKeyFor(round, index) {
    return round?.id ?? `round-${index + 1}`
  }

  function buildRoundTotalsMap(phases) {
    const map = new Map()
    if (!Array.isArray(phases)) return map

    phases.forEach((phase) => {
      const roundIndex = Number(phase?.roundIndex)
      if (!Number.isInteger(roundIndex) || roundIndex < 0) {
        return
      }
      const key = phase.roundId ?? `round-${roundIndex + 1}`
      const duration = durationOf(phase)
      if (duration <= 0) {
        return
      }
      const bucket = map.get(key) ?? { work: 0, rest: 0, total: 0 }
      bucket.total += duration
      if (phase.type === 'work') {
        bucket.work += duration
      } else {
        bucket.rest += duration
      }
      map.set(key, bucket)
    })

    return map
  }

  function getRoundTotals(round, index, totalsMap) {
    return totalsMap.get(roundKeyFor(round, index)) ?? EMPTY_TOTALS
  }

  const initialSource = defaultPlanSource.trim()
  let editorSource = initialSource
  let lastAppliedSource = initialSource
let previewResult = tryParsePlan(editorSource)
let plan =
  previewResult.plan ??
    {
      title: 'Untitled session',
      description: '',
      preStartSeconds: 0,
      preStartLabel: 'Prepare',
      rounds: []
    }
  let timeline = buildTimeline(plan)
  let timelineDuration = computeTimelineDuration(timeline)
  let roundTotalsMap = buildRoundTotalsMap(timeline)
  let parseError = previewResult.error ?? null
  let hasPendingChanges = false
  let isUsingDefaultSource = true
  let savedWorkouts = []
  let confirmSavedDeleteId = null
  let savedDeleteError = ''
  let savedDeleteStatus = ''
  let toasts = []
  let saveName = ''
  let selectedWorkoutId = null
  let fileInputEl
  let audioEnabled = audioSupported && $settings.timer.audioEnabled
  let audioAvailable = false
  let notificationsEnabled = $settings.timer.notificationsEnabled
  let notificationPermission = canUseNotifications ? window.Notification.permission : 'denied'
  let ttsEnabled = $settings.timer.ttsEnabled
  let announcementSchedule = []
  let announcementState = {
    phaseIndex: -1,
    spokenIds: new Set()
  }
  let ttsStatusMessage = ''
  let openAiKey = ''
  let openAiVoice = $settings.timer.openAiVoice ?? 'alloy'
  let isTtsTestRunning = false
  let ttsTestStatus = ''
  const openAiVoiceOptions = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'coral', 'verse', 'ballad', 'ash', 'sage', 'marin', 'cedar', 'cello', 'harp', 'melody', 'piano']
  let storageReady = false
  let aiPrompt = ''
  let aiStatus = ''
  let aiError = ''
  let isGenerating = false
  let aiEditInstructions = ''
  let aiEditStatus = ''
  let aiEditError = ''
  let isAiEditing = false
  let shareCopyStatus = ''
  let shareImportValue = ''
  let shareImportStatus = ''
  let shareMagicString = ''
  let ttsPrefetchAllDone = false
  let enableMetronome = $settings.timer.enableMetronome
  let timerPanelEl
  let isFullscreenSupported = false
  let isFullscreen = false
  let roundEditorOpen = false
  let roundEditorIndex = null
  let roundEditorData = null
  let lastPhase = null
  let setEditorOpen = false
  let setEditorRoundIndex = null
  let setEditorSetIndex = null
  let setEditorData = null
  let planEditorOpen = false
  let summaryPlanKeyValue = ''
  let summaryNeedsFullRebuild = false
  let latestRepCountValue = null
  let unsubscribeLatestRep = null
  let pendingSkipReset = false
  let lastFinalizedPhaseIndex = -1
  let sessionStartMs = null
  let pendingInitialWorkoutId = ''
  let pendingInitialPlannedId = ''
  $: openAiKey = $settings.openAiKey ?? ''
  $: if ($settings.timer.audioEnabled !== audioEnabled) audioEnabled = audioSupported && $settings.timer.audioEnabled
  $: if ($settings.timer.notificationsEnabled !== notificationsEnabled) notificationsEnabled = $settings.timer.notificationsEnabled
  $: if ($settings.timer.ttsEnabled !== ttsEnabled) ttsEnabled = $settings.timer.ttsEnabled
  $: if ($settings.timer.enableMetronome !== enableMetronome) enableMetronome = $settings.timer.enableMetronome
  $: if ($settings.timer.openAiVoice && $settings.timer.openAiVoice !== openAiVoice) openAiVoice = $settings.timer.openAiVoice
  $: emitState()

  export function start() {
    startTimer()
  }

  export function pause() {
    pauseTimer()
  }

  export function resume() {
    resumeTimer()
  }

  export function stop() {
    stopTimer()
  }

  export function getState() {
    return {
      status: timerStatusMessage,
      isRunning: isTimerRunning,
      isPaused: isTimerPaused,
      activePhase,
      activePhaseIndex,
      nextPhase,
      phaseRemainingSeconds,
      phaseProgressPercent,
      overallProgressPercent,
      totalRemainingSeconds
    }
  }
  const openSettings = () => openSettingsModal()

  const emitState = () => {
    dispatch('state', {
      status: timerStatusMessage,
      isRunning: isTimerRunning,
      isPaused: isTimerPaused,
      activePhase,
      activePhaseIndex,
      nextPhase,
      phaseRemainingSeconds,
      phaseProgressPercent,
      overallProgressPercent,
      totalRemainingSeconds,
      planTitle: plan.title,
      planDescription: plan.description,
      planRounds: plan.rounds?.length ?? 0
    })
  }
  const applyPlanUpdate = (mutator) => {
    let rawPlan = null
    let parsedFromEditor = false
    try {
      rawPlan = YAML.parse(editorSource)
      parsedFromEditor = true
    } catch (error) {
      console.warn('Failed to parse current YAML, using last applied source', error)
      try {
        rawPlan = YAML.parse(lastAppliedSource)
      } catch (fallbackError) {
        console.warn('Failed to parse last applied YAML', fallbackError)
        return false
      }
    }

    if (!rawPlan || typeof rawPlan !== 'object') {
      console.warn('No valid plan object to update')
      return false
    }

    mutator(rawPlan)

    try {
      const normalized = normalizePlan(rawPlan)
      const nextSource = YAML.stringify(rawPlan, { indent: 2, lineWidth: 0 })
      plan = normalized
      editorSource = nextSource
      lastAppliedSource = nextSource
      ttsPrefetchAllDone = false
      if (!isTimerRunning) {
        timerStatusMessage = 'Timer idle'
        timerError = null
        elapsedMs = 0
        phaseRemainingMs = 0
        activePhase = null
        activePhaseIndex = -1
      }
      return true
    } catch (error) {
      console.warn('Failed to apply plan edits', error)
      return parsedFromEditor
    }
  }

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }


  const fullscreenChangeEvents = [
    'fullscreenchange',
    'webkitfullscreenchange',
    'mozfullscreenchange',
    'MSFullscreenChange'
  ]

  const getFullscreenElement = () => {
    if (typeof document === 'undefined') return null
    return (
      document.fullscreenElement ??
      document.webkitFullscreenElement ??
      document.mozFullScreenElement ??
      document.msFullscreenElement ??
      null
    )
  }

  const handleFullscreenChange = () => {
    const activeElement = getFullscreenElement()
    isFullscreen = activeElement === timerPanelEl
  }

  const requestFullscreenFor = async (element) => {
    if (!element) return
    const request =
      element.requestFullscreen ??
      element.webkitRequestFullscreen ??
      element.mozRequestFullScreen ??
      element.msRequestFullscreen
    if (typeof request === 'function') {
      await request.call(element)
    } else {
      throw new Error('Fullscreen request is not supported.')
    }
  }

  const exitFullscreen = async () => {
    if (typeof document === 'undefined') return
    const exit =
      document.exitFullscreen ??
      document.webkitExitFullscreen ??
      document.mozCancelFullScreen ??
      document.msExitFullscreen
    if (typeof exit === 'function') {
      await exit.call(document)
    }
  }

  const toggleFullscreen = async () => {
    if (!isFullscreenSupported || typeof document === 'undefined') return
    try {
      if (isFullscreen) {
        await exitFullscreen()
      } else {
        await requestFullscreenFor(timerPanelEl)
      }
    } catch (error) {
      console.warn('Fullscreen toggle failed', error)
    }
  }

  const buildSetSegments = (
    set,
    nextSetLabel,
    roundRepetitions = 1,
    roundRestAfterSeconds = 0,
    hasSubsequentRound = false
  ) => {
    const repetitions = Math.max(Number(set?.repetitions) || 1, 1)
    const workSeconds = Math.max(Number(set?.workSeconds) || 0, 0)
    const restSeconds = Math.max(Number(set?.restSeconds) || 0, 0)
    const transitionSeconds = Math.max(Number(set?.transitionSeconds) || 0, 0)
    const roundRestAfter = Math.max(Number(roundRestAfterSeconds) || 0, 0)
    const hasNextRound = Boolean(hasSubsequentRound)

    const sequence = []
    let totalWork = 0
    let totalRest = 0
    for (let rep = 0; rep < repetitions; rep += 1) {
      if (workSeconds > 0) {
        sequence.push({
          type: 'work',
          duration: workSeconds,
          label: repetitions > 1 ? `Work ${rep + 1}/${repetitions}` : 'Work'
        })
        totalWork += workSeconds
      }

      const isLastRep = rep === repetitions - 1
      const hasNextSet = Boolean(nextSetLabel)
      const hasAnotherRound = roundRepetitions > 1
      const hasNextRoundTransition = hasNextRound || roundRestAfter > 0
      const shouldAddRest =
        restSeconds > 0 &&
        (!isLastRep ||
          (isLastRep &&
            (hasNextSet || (hasAnotherRound && roundRestAfter <= 0) || hasNextRoundTransition)))
      if (shouldAddRest) {
        sequence.push({
          type: 'rest',
          duration: restSeconds,
          label: repetitions > 1 ? `Rest ${rep + 1}` : 'Rest'
        })
        totalRest += restSeconds
      }
    }

    const transitionSegment =
      transitionSeconds > 0 && nextSetLabel
        ? {
            type: 'transition',
            duration: transitionSeconds,
            label: `Transition → ${nextSetLabel}`
          }
        : null

    return {
      setRepetitions: repetitions,
      roundRepetitions: Math.max(Number(roundRepetitions) || 1, 1),
      work: workSeconds,
      rest: restSeconds,
      workTotal: totalWork,
      restTotal: totalRest,
      total: totalWork + totalRest + (transitionSegment ? transitionSeconds : 0),
      sequence,
      transitionSegment
    }
  }

  const labelForPhaseType = (type) => {
    switch (type) {
      case 'work':
        return 'Work interval'
      case 'rest':
        return 'Rest'
      case 'transition':
        return 'Transition'
      case 'roundRest':
        return 'Round rest'
      case 'roundTransition':
        return 'Next round prep'
      default:
        return 'Phase'
    }
  }

  const formatUpdatedAt = (timestamp) => {
    if (!timestamp) return 'Unknown time'
    try {
      return new Date(timestamp).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return 'Unknown time'
    }
  }

  const ensureAudioReady = () => {
    if (!audioEnabled || !audioSupported) {
      audioAvailable = false
      return false
    }

    const ready = initAudio()
    audioAvailable = !!ready
    return audioAvailable
  }

  const maybeNotifyPhase = (phase) => {
    if (
      !notificationsEnabled ||
      notificationPermission !== 'granted' ||
      !canUseNotifications ||
      !phase
    ) {
      return
    }
    if (typeof document !== 'undefined' && !document.hidden) {
      return
    }
    try {
      const title = `${labelForPhaseType(phase.type)}`
      const body = phase.label ?? 'Workout update'
      const options = {
        body,
        tag: 'gs-ai-timer-phase',
        renotify: true
      }
      new window.Notification(title, options)
    } catch (error) {
      console.warn('Failed to send notification', error)
    }
  }

  const handleAudioToggle = () => {
    if (audioEnabled) {
      ensureAudioReady()
    } else {
      audioAvailable = false
    }
    setTimerSettings({ audioEnabled })
    emitState()
  }

  let activeMetronomePhaseId = null

  const stopMetronomePlayback = () => {
    stopMetronome()
    activeMetronomePhaseId = null
  }

  const stopAllSpeech = () => {
    cancelOpenAiSpeech()
    stopMetronomePlayback()
  }

  let wakeLockSentinel = null
  let wakeLockActive = false
  let wakeLockListenerAttached = false

  const canRequestWakeLock =
    typeof navigator !== 'undefined' && navigator?.wakeLock && typeof navigator.wakeLock.request === 'function'

  const acquireWakeLock = async () => {
    if (!canRequestWakeLock) return false
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen')
      wakeLockActive = true
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockActive = false
        console.debug('[wake-lock] released')
      })
      console.debug('[wake-lock] acquired')
      return true
    } catch (error) {
      wakeLockActive = false
      console.warn('[wake-lock] request failed', error)
      return false
    }
  }

  const releaseWakeLock = async () => {
    if (!wakeLockSentinel) return
    try {
      await wakeLockSentinel.release()
      console.debug('[wake-lock] released manually')
    } catch (error) {
      console.warn('[wake-lock] release failed', error)
    } finally {
      wakeLockSentinel = null
      wakeLockActive = false
    }
  }

  const handleVisibilityChange = async () => {
    if (typeof document === 'undefined') return
    if (document.visibilityState === 'visible' && !wakeLockActive) {
      await acquireWakeLock()
    }
  }

  const updateTtsStatus = (override) => {
    if (typeof override === 'string') {
      if (ttsStatusMessage !== override) {
        ttsStatusMessage = override
      }
      return
    }
    let nextStatus = ''
    if (ttsEnabled && !openAiKey.trim()) {
      nextStatus = 'missing OpenAI key'
    }
    if (ttsStatusMessage !== nextStatus) {
      ttsStatusMessage = nextStatus
    }
  }

  const handleTtsToggle = () => {
    console.debug('[tts] toggle changed', { enabled: ttsEnabled })
    if (!ttsEnabled) {
      stopAllSpeech()
    }
    setTimerSettings({ ttsEnabled })
    updateTtsStatus()
  }

  const handleOpenAiVoiceChange = (event) => {
    openAiVoice = event.target.value
    setTimerSettings({ openAiVoice })
  }

  const speakAnnouncement = (text, voice) => {
    console.debug('[tts] speakAnnouncement', {
      phaseIndex: activePhaseIndex,
      text,
      voice: voice ?? openAiVoice,
      ttsEnabled
    })
    if (!ttsEnabled) {
      console.debug('[tts] skipping speech because TTS disabled')
      return Promise.resolve(false)
    }
    const trimmedKey = openAiKey.trim()
    if (!trimmedKey) {
      updateTtsStatus('missing OpenAI key')
      console.warn('[tts] skipping speech because API key missing')
      return Promise.resolve(false)
    }
    return speakWithOpenAI({ text, voice: voice ?? openAiVoice, apiKey: trimmedKey })
      .then(() => {
        updateTtsStatus()
        console.debug('[tts] speakAnnouncement success')
        return true
      })
      .catch((error) => {
        console.warn('[tts] speakAnnouncement error', error)
        updateTtsStatus('OpenAI TTS error')
        return false
      })
  }

  const testTtsPlayback = async () => {
    const trimmedKey = openAiKey.trim()
    if (!trimmedKey) {
      ttsTestStatus = 'Add your OpenAI API key first.'
      updateTtsStatus('missing OpenAI key')
      console.warn('[tts] test skipped, API key missing')
      return
    }
    if (isTtsTestRunning) {
      console.debug('[tts] test already running, skipping new request')
      return
    }
    const sampleText = 'Voice prompt test. You should hear this message.'
    const voice = openAiVoice
    console.debug('[tts] starting test playback', { voice })
    stopAllSpeech()
    isTtsTestRunning = true
    ttsTestStatus = 'Testing…'
    try {
      await speakWithOpenAI({ text: sampleText, voice, apiKey: trimmedKey })
      ttsTestStatus = 'Playback succeeded.'
      updateTtsStatus()
      console.debug('[tts] test playback succeeded', { voice })
    } catch (error) {
      ttsTestStatus = error?.message ?? 'Voice test failed.'
      updateTtsStatus('OpenAI TTS error')
      console.warn('[tts] test playback failed', error)
    } finally {
      isTtsTestRunning = false
    }
  }

  const handleNotificationsToggle = async () => {
    if (!notificationsEnabled) {
      setTimerSettings({ notificationsEnabled })
      emitState()
      return
    }
    const permission = await requestNotificationPermission()
    if (permission !== 'granted') {
      notificationsEnabled = false
      setTimerSettings({ notificationsEnabled })
    } else {
      setTimerSettings({ notificationsEnabled })
      emitState()
    }
  }

  const deriveNameFromFile = (filename) => {
    if (!filename) return ''
    const base = filename.replace(/\.[^.]+$/, '')
    return base.replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim()
  }

  const triggerImport = () => {
    if (fileInputEl) {
      fileInputEl.click()
    }
  }

  $: if (typeof document !== 'undefined') {
    document.body.classList.toggle('modal-open', !!confirmSavedDeleteId)
  }

  onDestroy(() => {
    stopAllSpeech()
    ttsStatusMessage = ''
    if (unsubscribeLatestRep) {
      unsubscribeLatestRep()
      unsubscribeLatestRep = null
    }
    if (wakeLockListenerAttached && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      wakeLockListenerAttached = false
    }
    releaseWakeLock()
    const doc = typeof document !== 'undefined' ? document : null
    if (doc) {
      fullscreenChangeEvents.forEach((eventName) =>
        doc.removeEventListener(eventName, handleFullscreenChange)
      )
      if (getFullscreenElement() === timerPanelEl) {
        exitFullscreen().catch(() => {})
      }
      doc.body.classList.remove('modal-open')
    }
  })

  const handleImportChange = async (event) => {
    const file = event?.target?.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      editorSource = text
      const derived = deriveNameFromFile(file.name)
      if (derived) {
        saveName = derived
      }
      selectedWorkoutId = null
    } catch (error) {
      console.warn('Failed to read YAML file', error)
    } finally {
      event.target.value = ''
    }
  }

  const exportWorkout = () => {
    if (!isBrowser) return
    try {
      const filename =
        (saveName?.trim() || plan.title?.trim() || 'workout').replace(/\s+/g, '-')
      const blob = new Blob([editorSource], { type: 'text/yaml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${filename}.yaml`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      console.warn('Failed to export workout YAML', error)
    }
  }

  const openLibraryModal = () => {
    libraryModalOpen = true
  }

  const handleLibraryTemplateSelect = (event) => {
    const workout = event?.detail?.workout
    if (!workout) return
    const result = tryParsePlan(workout.source)
    if (result.error || !result.plan) {
      aiStatus = ''
      aiError = 'Failed to load template. Please check the YAML.'
      return
    }
    editorSource = workout.source
    lastAppliedSource = workout.source
    plan = result.plan
    ttsPrefetchAllDone = false
    if (!isTimerRunning) {
      timerStatusMessage = 'Timer idle'
      timerError = null
      elapsedMs = 0
      phaseRemainingMs = 0
      activePhase = null
      activePhaseIndex = -1
    }
    selectedWorkoutId = null
    saveName = workout.name ?? ''
    libraryModalOpen = false
    aiError = ''
    aiStatus = `Loaded "${workout.name}" from library.`
  }

  $: previewResult = tryParsePlan(editorSource)
  $: hasPendingChanges = editorSource !== lastAppliedSource
  $: isUsingDefaultSource = editorSource === initialSource
  $: previewTotals = previewResult.plan ? computePlanTotals(previewResult.plan) : null
  $: parseError = previewResult.error ?? null
  $: timeline = buildTimeline(plan)
  $: planTotals = computePlanTotals(plan)
  $: timelineDuration = computeTimelineDuration(timeline)
  $: roundTotalsMap = buildRoundTotalsMap(timeline)
  $: if (pendingInitialWorkoutId && savedWorkouts.length) {
    const match = findWorkoutById(pendingInitialWorkoutId)
    if (match) {
      loadWorkout(match)
      pendingInitialWorkoutId = ''
    }
  }
  $: if (pendingInitialPlannedId) {
    loadPlannedWorkout(pendingInitialPlannedId)
    pendingInitialPlannedId = ''
  }
  $: {
    const nextEntries = buildSummaryEntries()
    const nextKey = buildSummaryKey()
    summaryPlanKeyValue = nextKey
    if (summaryNeedsFullRebuild) {
      setSummaryEntries(nextEntries, nextKey)
      summaryNeedsFullRebuild = false
    } else {
      seedSummaryEntries(nextEntries, nextKey)
    }
  }
  $: {
    announcementSchedule = buildAnnouncementSchedule(timeline)
    console.debug('[tts] announcement schedule rebuilt', {
      phases: timeline.length,
      entries: announcementSchedule.length
    })
  }
  $: if (!enableMetronome) {
    stopMetronomePlayback()
  } else if (enableMetronome && isTimerRunning && activePhase?.type === 'work') {
    startMetronomeForPhase(activePhase, phaseRemainingMs / 1000)
  }
  $: if (!isTimerRunning && !isTimerPaused) {
    announcementState = {
      phaseIndex: -1,
      lastTriggerMs: -1,
      spokenIds: new Set()
    }
    ttsPrefetchAllDone = false
  }
  $: if (!isTimerRunning && !isTimerPaused) {
    totalDurationMs = timelineDuration * 1000
    if (timerStatusMessage !== 'Workout complete') {
      elapsedMs = 0
      phaseRemainingMs = 0
      activePhaseIndex = -1
      activePhase = null
    }
  }
  $: phaseRemainingSeconds = Math.max(Math.ceil(phaseRemainingMs / 1000), 0)
  $: totalRemainingMs = Math.max(totalDurationMs - elapsedMs, 0)
  $: totalRemainingSeconds = Math.max(Math.ceil(totalRemainingMs / 1000), 0)
  $: phaseProgress =
    activePhase && activePhase.durationSeconds
      ? Math.min(
          (activePhase.durationSeconds * 1000 - phaseRemainingMs) /
            (activePhase.durationSeconds * 1000),
          1
        )
      : 0
  $: overallProgress =
    totalDurationMs > 0 ? Math.min(elapsedMs / totalDurationMs, 1) : 0
  $: phaseProgressPercent = Math.round(phaseProgress * 100)
  $: overallProgressPercent = Math.round(overallProgress * 100)
  $: phasePositionLabel =
    activePhaseIndex >= 0 ? `Phase ${activePhaseIndex + 1} / ${timeline.length}` : 'No phase active'
  $: nextPhase =
    activePhaseIndex >= 0 && activePhaseIndex + 1 < timeline.length
      ? timeline[activePhaseIndex + 1]
      : null
  $: canStartTimer = !parseError && timeline.length > 0 && !isTimerRunning && !isTimerPaused
  $: canSkipPhase =
    (isTimerRunning || isTimerPaused) && activePhaseIndex >= 0 && activePhaseIndex < timeline.length - 1

  let timerWorker
  let isTimerRunning = false
  let isTimerPaused = false
  let lastTickId = null
  let lastTickTimestamp = null
  let activePhaseIndex = -1
  let activePhase = null
  let phaseRemainingMs = 0
  let elapsedMs = 0
  let totalDurationMs = timelineDuration * 1000
  let timerStatusMessage = 'Timer idle'
  let timerError = null
  let showYamlHelp = false
  let libraryModalOpen = false
  let nextWorkCountdownIndex = null
  let workFinishCountdownIndex = null

  const initWorker = () => {
    if (timerWorker) return
    timerWorker = new TimerWorker()

    timerWorker.addEventListener('message', (event) => {
      const message = event.data ?? {}
      const { type, tickId } = message

      if (type === 'started') {
        isTimerRunning = true
        isTimerPaused = false
        timerError = null
        timerStatusMessage = 'Timer running'
        lastTickId = tickId
        lastTickTimestamp = message.timestamp ?? Date.now()
        activePhaseIndex = -1
        activePhase = null
        lastPhase = null
        phaseRemainingMs = 0
        elapsedMs = 0
        totalDurationMs = message.totalDurationMs ?? timelineDuration * 1000
        return
      }

      if (type === 'phaseStarted') {
        const previousPhaseIndex = activePhaseIndex
        const previousPhase = activePhase
        if (previousPhase && previousPhase.type === 'work') {
          finalizeWorkPhase(previousPhaseIndex)
        }
        lastPhase = previousPhase
        if (tickId !== lastTickId) return
        timerStatusMessage = isTimerPaused ? 'Timer paused' : 'Timer running'
        activePhaseIndex = message.phaseIndex
        activePhase = message.phase ?? null
        phaseRemainingMs =
          (message.phase?.durationSeconds ? message.phase.durationSeconds * 1000 : 0) ?? 0
        lastTickTimestamp = Date.now()
        nextWorkCountdownIndex = null
        workFinishCountdownIndex = null
        announcementState = {
          phaseIndex: activePhaseIndex,
          spokenIds: new Set()
        }
        const phaseChangeReason = pendingSkipReset ? 'skip' : 'progress'
        pendingSkipReset = false
        dispatch('phaseChange', {
          phaseIndex: activePhaseIndex,
          phase: activePhase,
          previousPhase: lastPhase,
          reason: phaseChangeReason
        })
        console.debug('[tts] phaseStarted reset announcement state', {
          phaseIndex: activePhaseIndex,
          phaseId: activePhase?.id
        })
        if (audioEnabled) {
          if (!audioAvailable) {
            ensureAudioReady()
          }
          if (audioAvailable && activePhase) {
            if (activePhase.type === 'prep') {
              playCue('prep')
            } else if (activePhase.type !== 'work') {
              playCue(activePhase.type)
            }
          }
        }
        if (notificationsEnabled && activePhase) {
          maybeNotifyPhase(activePhase)
        }
        stopAllSpeech()

        if (enableMetronome) {
          const durationSeconds = activePhase?.durationSeconds ?? 0
          startMetronomeForPhase(activePhase, durationSeconds)
        }

        if (
          ttsEnabled &&
          activePhase &&
          activePhase.type === 'prep' &&
          !ttsPrefetchAllDone
        ) {
          const upcomingAll = (announcementSchedule ?? []).filter(
            (item) => item.phaseIndex > activePhaseIndex
          )
          const seen = new Set()
          upcomingAll.forEach((item) => {
            const key = `${item.voice ?? ''}::${item.text}`
            if (!seen.has(key)) {
              seen.add(key)
              handlePrefetchAnnouncement(item.text, item.voice)
            }
          })
          ttsPrefetchAllDone = true
          console.debug('[tts] prefetch triggered during preStart', {
            count: seen.size
          })
        }

        if (ttsEnabled && activePhase) {
          const upcoming = (announcementSchedule ?? []).filter(
            (item) => item.phaseIndex === activePhaseIndex
          )
          upcoming.forEach((item) => {
            if (!announcementState.spokenIds.has(item.announcementId)) {
              handlePrefetchAnnouncement(item.text, item.voice)
            }
          })
        }
        return
      }

      if (type === 'tick') {
        if (tickId !== lastTickId) return
        if (isTimerRunning) {
          timerStatusMessage = 'Timer running'
        }
        lastTickTimestamp = message.timestamp ?? Date.now()
        elapsedMs = message.elapsedMs ?? elapsedMs
        phaseRemainingMs = message.phaseRemainingMs ?? phaseRemainingMs
        totalDurationMs = message.totalDurationMs ?? totalDurationMs
        const phaseIndex = activePhaseIndex
        if (
          nextPhase &&
          nextPhase.type === 'work' &&
          phaseRemainingMs > 0 &&
          phaseRemainingMs <= 3000 &&
          nextWorkCountdownIndex !== phaseIndex
        ) {
          nextWorkCountdownIndex = phaseIndex
          if (audioEnabled) {
            if (!audioAvailable) {
              ensureAudioReady()
            }
            if (audioAvailable) {
              playCountdown()
            }
          }
        }

        if (
          activePhase &&
          activePhase.type === 'work' &&
          phaseRemainingMs > 0 &&
          phaseRemainingMs <= 3000 &&
          workFinishCountdownIndex !== phaseIndex
        ) {
          workFinishCountdownIndex = phaseIndex
          if (audioEnabled) {
            if (!audioAvailable) {
              ensureAudioReady()
            }
            if (audioAvailable) {
              playCountdown()
            }
          }
        }

        if (ttsEnabled) {
          const inPhaseElapsedMs =
            (activePhase?.durationSeconds ?? 0) * 1000 - (message.phaseRemainingMs ?? 0)
          const announcements = selectDueAnnouncements({
            schedule: announcementSchedule,
            phaseIndex,
            inPhaseElapsedMs,
            triggeredCache: announcementState.spokenIds
          })
          if (announcements.length) {
            console.debug('[tts] due announcements', {
              phaseIndex,
              inPhaseElapsedMs,
              count: announcements.length,
              pendingIds: announcements.map((item) => item.announcementId)
            })
            announcements.forEach((item) => {
              if (!announcementState.spokenIds.has(item.announcementId)) {
                const updatedIds = new Set(announcementState.spokenIds)
                updatedIds.add(item.announcementId)
                announcementState = {
                  phaseIndex,
                  spokenIds: updatedIds
                }
              console.debug('[tts] announcing', {
                id: item.announcementId,
                text: item.text,
                voice: item.voice ?? openAiVoice
              })
              speakAnnouncement(item.text, item.voice).catch((error) => {
                  const retryIds = new Set(announcementState.spokenIds)
                  retryIds.delete(item.announcementId)
                  announcementState = {
                    phaseIndex,
                    spokenIds: retryIds
                  }
                  console.debug('[tts] rescheduled announcement after failure', {
                    id: item.announcementId,
                    error: error?.message ?? String(error)
                  })
                })
              }
            })
          }
        }
        return
      }

      if (type === 'completed') {
        if (activePhase && activePhase.type === 'work') {
          finalizeWorkPhase(activePhaseIndex)
        }
        if (tickId !== lastTickId) return
        isTimerRunning = false
        isTimerPaused = false
        timerStatusMessage = 'Workout complete'
        activePhaseIndex = -1
        activePhase = null
        phaseRemainingMs = 0
        elapsedMs = totalDurationMs
        nextWorkCountdownIndex = null
        workFinishCountdownIndex = null
        return
      }

      if (type === 'paused') {
        if (tickId !== lastTickId) return
        isTimerRunning = false
        isTimerPaused = true
        timerStatusMessage = 'Timer paused'
        elapsedMs = message.elapsedMs ?? elapsedMs
        phaseRemainingMs = message.phaseRemainingMs ?? phaseRemainingMs
        activePhaseIndex = message.phaseIndex ?? activePhaseIndex
        nextWorkCountdownIndex = null
        workFinishCountdownIndex = null
        return
      }

      if (type === 'resumed') {
        if (tickId !== lastTickId) return
        isTimerRunning = true
        isTimerPaused = false
        timerStatusMessage = 'Timer running'
        nextWorkCountdownIndex = null
        workFinishCountdownIndex = null
        return
      }

      if (type === 'stopped') {
        if (tickId !== lastTickId) return
        isTimerRunning = false
        isTimerPaused = false
        timerStatusMessage =
          message.reason === 'manual-stop'
            ? 'Timer stopped'
            : message.reason === 'restarted'
              ? 'Timer restarting'
              : 'Timer stopped'
        activePhaseIndex = -1
        activePhase = null
        phaseRemainingMs = 0
        nextWorkCountdownIndex = null
        workFinishCountdownIndex = null
        return
      }

      if (type === 'error') {
        timerError = message.message ?? 'Unknown timer error'
        timerStatusMessage = 'Timer error'
        isTimerRunning = false
        isTimerPaused = false
        return
      }
    })

    timerWorker.postMessage({ type: 'ping' })
  }

  const startTimer = async () => {
    initWorker()
    if (!timerWorker) return
    if (parseError) {
      timerError = 'Fix YAML configuration before starting the timer.'
      return
    }
    if (!timeline.length) {
      timerError = 'Workout has no phases to run.'
      return
    }

    if (audioEnabled) {
      const ready = ensureAudioReady()
      if (!ready) {
        timerError = 'Audio cues are not supported in this browser.'
      }
    }

    if (notificationsEnabled && notificationPermission === 'default') {
      await requestNotificationPermission()
    }

    timerStatusMessage = 'Starting timer…'
    timerError = null
    isTimerPaused = false
    nextWorkCountdownIndex = null
    workFinishCountdownIndex = null
    activePhaseIndex = -1
    activePhase = null
    phaseRemainingMs = 0
    elapsedMs = 0

    const payloadTimeline =
      typeof structuredClone === 'function'
        ? structuredClone(timeline)
        : timeline.map((phase) => ({ ...phase }))

    timerWorker.postMessage({
      type: 'start',
      payload: { tickLengthMs: 1000, timeline: payloadTimeline }
    })
    const key = buildSummaryKey()
    summaryPlanKeyValue = key
    setSummaryEntries(buildSummaryEntries(), key)
    lastFinalizedPhaseIndex = -1
    sessionStartMs = Date.now()
    setSummaryMetadata({
      title: plan.title,
      workoutId: selectedWorkoutId,
      startedAt: sessionStartMs,
      durationSeconds: timelineDuration
    })
    dispatch('start')
  }

  const stopTimer = () => {
    if (!timerWorker || (!isTimerRunning && !isTimerPaused)) return
    timerStatusMessage = 'Stopping timer…'
    isTimerRunning = false
    isTimerPaused = false
    nextWorkCountdownIndex = null
    workFinishCountdownIndex = null
    stopAllSpeech()
    timerWorker.postMessage({ type: 'stop', payload: { reason: 'manual-stop' } })
    emitState()
    setSummaryMetadata({
      title: plan.title,
      workoutId: selectedWorkoutId,
      startedAt: sessionStartMs,
      finishedAt: Date.now(),
      durationSeconds: timelineDuration
    })
    dispatch('stop')
  }

  const pauseTimer = () => {
    if (!timerWorker || !isTimerRunning) return
    timerStatusMessage = 'Pausing…'
    isTimerRunning = false
    isTimerPaused = true
    nextWorkCountdownIndex = null
    workFinishCountdownIndex = null
    stopAllSpeech()
    timerWorker.postMessage({ type: 'pause' })
    emitState()
    setSummaryMetadata({
      title: plan.title,
      workoutId: selectedWorkoutId,
      startedAt: sessionStartMs,
      finishedAt: Date.now(),
      durationSeconds: timelineDuration
    })
    dispatch('pause')
  }

  const resumeTimer = () => {
    if (!timerWorker || !isTimerPaused) return
    timerStatusMessage = 'Resuming…'
    isTimerRunning = true
    isTimerPaused = false
    nextWorkCountdownIndex = null
    workFinishCountdownIndex = null
    timerWorker.postMessage({ type: 'resume' })
    emitState()
    dispatch('resume')
  }

  const handleTimerTap = () => {
    if (isTimerRunning) {
      pauseTimer()
    } else if (isTimerPaused) {
      resumeTimer()
    }
  }

  const finalizeWorkPhase = (phaseIndex) => {
    if (!Number.isInteger(phaseIndex) || phaseIndex < 0) return
    if (phaseIndex === lastFinalizedPhaseIndex) return
    const currentCount =
      latestRepCountValue === null || latestRepCountValue === undefined
        ? get(summaryLatestRepCount)
        : latestRepCountValue
    if (currentCount === null || currentCount === undefined) return
    applyRepCountToPhase(phaseIndex, currentCount, summaryPlanKeyValue)
    lastFinalizedPhaseIndex = phaseIndex
  }

  const mergeSummaryEntries = (freshEntries) => {
    const existing = get(summaryEntries) ?? []
    if (!Array.isArray(freshEntries) || !freshEntries.length) return freshEntries ?? []
    const existingById = new Map(existing.map((item) => [item.id, item]))
    return freshEntries.map((item) => {
      const prev = existingById.get(item.id)
      if (!prev) return item
      return {
        ...item,
        loggedReps: prev.loggedReps ?? item.loggedReps ?? null,
        autoFilled: prev.autoFilled ?? item.autoFilled ?? false,
        weight: prev.weight ?? item.weight ?? null
      }
    })
  }

  const openSummary = () => {
    const key = buildSummaryKey()
    summaryPlanKeyValue = key
    setSummaryEntries(mergeSummaryEntries(buildSummaryEntries()), key)
    setSummaryMetadata({
      title: plan.title,
      workoutId: selectedWorkoutId,
      startedAt: sessionStartMs,
      finishedAt: Date.now(),
      durationSeconds: timelineDuration
    })
    openSummaryModal()
  }

  const skipPhase = () => {
    if (!timerWorker || (!isTimerRunning && !isTimerPaused)) return
    if (activePhase && activePhase.type === 'work') {
      finalizeWorkPhase(activePhaseIndex)
    }
    timerStatusMessage = 'Skipping phase…'
    nextWorkCountdownIndex = null
    workFinishCountdownIndex = null
    stopAllSpeech()
    pendingSkipReset = true
    dispatch('phaseChange', {
      phaseIndex: activePhaseIndex,
      phase: activePhase,
      previousPhase: activePhase,
      reason: 'skip'
    })
    timerWorker.postMessage({ type: 'skip' })
    emitState()
  }

  const OPENAI_CHAT_MODEL = 'gpt-4o-mini'

  const systemPrompt = `You are a fitness coach that outputs workouts as YAML. Use this schema:
title: string
description: string (optional, short summary)
preStartSeconds: number (optional, default 0)
preStartLabel: string (optional)
rounds: array of objects
  - id: string (optional)
    label: string (optional)
    repetitions: integer >= 1 (default 1)
    restAfterSeconds: number >= 0 (optional)
    sets: array of objects, in order
      - id: string (optional)
        label: string (mandatory)
        workSeconds: number > 0 (seconds for work interval)
        restSeconds: number >= 0 (optional, default 0) between repetitions of the same set
        repetitions: integer >= 1 (optional, default 1)
        transitionSeconds: number >= 0 (optional, default 0) rest before next set
        targetRpm: number > 0 (optional) reps-per-minute metronome target during work
        announcements: optional array of objects describing voice prompts
          - text: string (what to say)
            atSeconds: number or array of numbers (seconds from the start of the work interval; negative values mean seconds before the end of that interval; do not use \"at\")
            once: boolean (optional, default false)
            voice: string (optional, OpenAI TTS voice name)
        restAnnouncements: optional array of objects for rest-phase voice prompts (same structure as announcements; negative atSeconds counts backwards from the end of the rest)

Rules:
- Output valid YAML only. Do not wrap in code fences or include explanations.
- Use seconds for every duration field.
- Provide descriptive yet concise labels and include a short description when possible.
- Include announcements sparingly to cue important work intervals (start, halfway, last 10 seconds, etc.) and use restAnnouncements to preview the next effort or countdown the restart.
- If the user description lacks details, make reasonable assumptions and keep the workout balanced.
- Ensure IDs are unique when provided.
- Avoid additional properties beyond this schema.`

  const extractYaml = (content) => {
    if (!content) return ''
    const fenceMatch = content.match(/```(?:yaml)?\s*([\s\S]*?)```/i)
    if (fenceMatch) {
      return fenceMatch[1].trim()
    }
    return content.trim()
  }

  const generateWorkoutFromAi = async () => {
    const description = aiPrompt.trim()
    if (!description) {
      aiError = 'Describe the workout before generating.'
      aiStatus = ''
      return
    }
    const key = openAiKey.trim()
    if (!key) {
      aiError = 'Add your OpenAI API key to generate workouts.'
      aiStatus = ''
      updateTtsStatus('missing OpenAI key')
      return
    }

    aiError = ''
    aiStatus = 'Contacting OpenAI…'
    isGenerating = true

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: OPENAI_CHAT_MODEL,
          temperature: 0.7,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: `Create a workout YAML configuration that matches this description:\n${description}`
            }
          ]
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`OpenAI request failed: ${response.status} ${errorText}`)
      }

      const data = await response.json()
      const content = data?.choices?.[0]?.message?.content ?? ''
      const yaml = extractYaml(content)
      if (!yaml) {
        throw new Error('OpenAI response did not contain YAML output.')
      }

      applyYamlSource(yaml)
      saveName = previewResult.plan?.title ?? saveName
      aiStatus = 'Workout generated. Review and adjust as needed.'
      aiError = ''
    } catch (error) {
      console.warn('OpenAI workout generation error', error)
      aiError = error?.message ?? 'Failed to generate workout.'
      aiStatus = ''
    } finally {
      isGenerating = false
    }
  }

  const modifyWorkoutWithAi = async () => {
    const instructions = aiEditInstructions.trim()
    if (!instructions) {
      aiEditError = 'Describe how to modify the current workout.'
      aiEditStatus = ''
      return
    }
    const key = openAiKey.trim()
    if (!key) {
      aiEditError = 'Add your OpenAI API key to modify workouts.'
      aiEditStatus = ''
      updateTtsStatus('missing OpenAI key')
      return
    }

    aiEditError = ''
    aiEditStatus = 'Contacting OpenAI…'
    isAiEditing = true

    const userContent = `Here is the current workout YAML:\n${editorSource}\n\nApply these changes:\n${instructions}\n\nKeep IDs stable when possible and return YAML only.`

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: OPENAI_CHAT_MODEL,
          temperature: 0.7,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
          ]
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`OpenAI request failed: ${response.status} ${errorText}`)
      }

      const data = await response.json()
      const content = data?.choices?.[0]?.message?.content ?? ''
      const yaml = extractYaml(content)
      if (!yaml) {
        throw new Error('OpenAI response did not contain YAML output.')
      }

      applyYamlSource(yaml)
      aiEditStatus = 'Workout updated. Review and apply changes as needed.'
      aiEditError = ''
    } catch (error) {
      console.warn('OpenAI workout edit error', error)
      aiEditError = error?.message ?? 'Failed to modify workout.'
      aiEditStatus = ''
    } finally {
      isAiEditing = false
    }
  }

  const applyEditorChanges = () => {
    if (previewResult.error || !previewResult.plan) {
      return
    }
    plan = previewResult.plan
    lastAppliedSource = editorSource
    ttsPrefetchAllDone = false
    if (!isTimerRunning) {
      timerStatusMessage = 'Timer idle'
      timerError = null
      elapsedMs = 0
      phaseRemainingMs = 0
      activePhase = null
      activePhaseIndex = -1
    }
  }

  const applyYamlSource = (yamlSource) => {
    const result = tryParsePlan(yamlSource)
    if (result.error || !result.plan) {
      throw result.error ?? new Error('Invalid workout YAML')
    }
    editorSource = yamlSource
    plan = result.plan
    lastAppliedSource = yamlSource
    ttsPrefetchAllDone = false
    if (!isTimerRunning) {
      timerStatusMessage = 'Timer idle'
      timerError = null
      elapsedMs = 0
      phaseRemainingMs = 0
      activePhase = null
      activePhaseIndex = -1
    }
  }

  const revertEditorChanges = () => {
    editorSource = lastAppliedSource
  }

  const resetEditorToDefault = () => {
    editorSource = initialSource
    selectedWorkoutId = null
    saveName = ''
    if (!isTimerRunning) {
      timerStatusMessage = 'Timer idle'
      timerError = null
      elapsedMs = 0
      phaseRemainingMs = 0
      activePhase = null
      activePhaseIndex = -1
    }
  }

  const openRoundEditor = (round, roundIndex) => {
    roundEditorData = round
    roundEditorIndex = roundIndex
    roundEditorOpen = true
  }

  const closeRoundEditor = () => {
    roundEditorOpen = false
    roundEditorIndex = null
    roundEditorData = null
  }

  const handleRoundSave = (event) => {
    const detail = event?.detail ?? {}
    const index = Number.isInteger(detail.roundIndex) ? detail.roundIndex : roundEditorIndex
    if (!Number.isInteger(index) || index < 0) {
      closeRoundEditor()
      return
    }
    const values = detail.values ?? {}
    applyPlanUpdate((rawPlan) => {
      const target =
        Array.isArray(rawPlan.rounds) && rawPlan.rounds[index] ? rawPlan.rounds[index] : null
      if (!target) return
      const nextLabel = values.label?.trim()
      if (nextLabel) {
        target.label = nextLabel
      } else if (!target.label) {
        target.label = `Round ${index + 1}`
      }
      target.repetitions = coerceRepetitions(values.repetitions ?? target.repetitions)
      target.restAfterSeconds = coerceSeconds(values.restAfterSeconds ?? target.restAfterSeconds)
    })
    closeRoundEditor()
  }

  const openSetEditor = (roundIndex, setIndex) => {
    setEditorRoundIndex = roundIndex
    setEditorSetIndex = setIndex
    setEditorData = plan?.rounds?.[roundIndex]?.sets?.[setIndex] ?? null
    setEditorOpen = true
  }

  const closeSetEditor = () => {
    setEditorOpen = false
    setEditorRoundIndex = null
    setEditorSetIndex = null
    setEditorData = null
  }

  const handleSetSave = (event) => {
    const detail = event?.detail ?? {}
    const roundIndex = Number.isInteger(detail.roundIndex)
      ? detail.roundIndex
      : setEditorRoundIndex
    const setIndex = Number.isInteger(detail.setIndex) ? detail.setIndex : setEditorSetIndex
    if (!Number.isInteger(roundIndex) || roundIndex < 0 || !Number.isInteger(setIndex) || setIndex < 0) {
      closeSetEditor()
      return
    }
    const values = detail.values ?? {}
    applyPlanUpdate((rawPlan) => {
      const targetRound =
        Array.isArray(rawPlan.rounds) && rawPlan.rounds[roundIndex]
          ? rawPlan.rounds[roundIndex]
          : null
      if (!targetRound || !Array.isArray(targetRound.sets) || !targetRound.sets[setIndex]) {
        return
      }
      const targetSet = targetRound.sets[setIndex]
      const nextLabel = values.label?.trim()
      if (nextLabel) {
        targetSet.label = nextLabel
      } else if (!targetSet.label) {
        targetSet.label = `Set ${setIndex + 1}`
      }
      targetSet.workSeconds = coerceSeconds(values.workSeconds ?? targetSet.workSeconds)
      targetSet.restSeconds = coerceSeconds(values.restSeconds ?? targetSet.restSeconds)
      targetSet.transitionSeconds = coerceSeconds(
        values.transitionSeconds ?? targetSet.transitionSeconds
      )
      targetSet.repetitions = coerceRepetitions(values.repetitions ?? targetSet.repetitions)
      const rpm = values.targetRpm
      if (rpm === null) {
        delete targetSet.targetRpm
      } else if (rpm === undefined || rpm === '') {
        delete targetSet.targetRpm
      } else {
        targetSet.targetRpm = Math.max(Number(rpm) || 0, 0)
      }
    })
    closeSetEditor()
  }

  const openPlanEditor = () => {
    planEditorOpen = true
  }

  const closePlanEditor = () => {
    planEditorOpen = false
  }

  const handlePlanSave = (event) => {
    const values = event?.detail?.values ?? {}
    applyPlanUpdate((rawPlan) => {
      const nextTitle = values.title?.trim()
      if (nextTitle) {
        rawPlan.title = nextTitle
      } else if (!rawPlan.title) {
        rawPlan.title = 'Untitled session'
      }

      const nextDescription = values.description ?? ''
      if (typeof nextDescription === 'string' && nextDescription.trim().length) {
        rawPlan.description = nextDescription.trim()
      } else {
        delete rawPlan.description
      }

      rawPlan.preStartSeconds = coerceSeconds(values.preStartSeconds ?? rawPlan.preStartSeconds)

      const nextLabel = values.preStartLabel ?? ''
      if (typeof nextLabel === 'string' && nextLabel.trim().length) {
        rawPlan.preStartLabel = nextLabel.trim()
      } else {
        delete rawPlan.preStartLabel
      }
    })
    closePlanEditor()
  }

  const handleSaveWorkout = () => {
    if (previewResult.error || !previewResult.plan) return
    const normalizedName =
      saveName?.trim() || previewResult.plan.title?.trim() || 'Untitled session'
    if (!normalizedName) return

    const now = Date.now()
    const id = selectedWorkoutId ?? createId()

    const entry = {
      id,
      name: normalizedName,
      source: editorSource,
      updatedAt: now
    }

    const others = savedWorkouts.filter((item) => item.id !== id && item.name !== normalizedName)
    savedWorkouts = [entry, ...others]
    persistSavedWorkouts(savedWorkouts)
    saveWorkoutToApi(entry, previewResult.plan)
    pushToast('Workout saved.', 'success')

    selectedWorkoutId = id
    saveName = normalizedName
    plan = previewResult.plan
    lastAppliedSource = editorSource
  }

  const loadWorkout = (workout) => {
    if (!workout) return
    const result = tryParsePlan(workout.source)
    editorSource = workout.source
    lastAppliedSource = workout.source
    if (!result.error && result.plan) {
      plan = result.plan
      summaryNeedsFullRebuild = true
    }
    selectedWorkoutId = workout.id
    saveName = workout.name
    pushToast('Workout loaded.', 'success')
    if (!isTimerRunning) {
      timerStatusMessage = 'Timer idle'
      timerError = null
      elapsedMs = 0
      phaseRemainingMs = 0
      activePhase = null
      activePhaseIndex = -1
    }
  }

  const deleteWorkout = (id) => {
    savedDeleteStatus = 'Deleting…'
    savedDeleteError = ''
    savedWorkouts = savedWorkouts.filter((item) => item.id !== id)
    persistSavedWorkouts(savedWorkouts)
    if (selectedWorkoutId === id) {
      selectedWorkoutId = null
    }
    savedDeleteStatus = 'Deleted'
    setTimeout(() => {
      if (savedDeleteStatus === 'Deleted') savedDeleteStatus = ''
    }, 1500)
    confirmSavedDeleteId = null
    pushToast('Deleted saved workout.', 'success')
  }

  const requestDeleteWorkout = (id) => {
    confirmSavedDeleteId = id
    savedDeleteError = ''
    savedDeleteStatus = ''
  }

  const pushToast = (message, type = 'info', duration = 2400) => {
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`
    const toast = { id, message, type }
    toasts = [...toasts, toast]
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id)
    }, duration)
  }

  const loadPlannedWorkout = async (id) => {
    try {
      const res = await fetch(`/api/planned-workouts/${id}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.item) return
      const item = data.item
      const source = item.yaml_source ?? ''
      const parsed = tryParsePlan(source)
      editorSource = source
      lastAppliedSource = source
      if (!parsed.error && parsed.plan) {
        plan = parsed.plan
        summaryNeedsFullRebuild = true
      }
      selectedWorkoutId = null
      saveName = item.title ?? 'Planned workout'
      if (!isTimerRunning) {
        timerStatusMessage = 'Timer idle'
        timerError = null
        elapsedMs = 0
        phaseRemainingMs = 0
        activePhase = null
        activePhaseIndex = -1
      }
    } catch (error) {
      console.warn('Failed to load planned workout', error)
    }
  }

  const normalizeMagicPayload = (value) => {
    if (!value) return ''
    let payload = value.trim()
    if (payload.startsWith('gswt://')) {
      payload = payload.slice(7)
    } else if (payload.startsWith('gswt:')) {
      payload = payload.slice(5)
    }
    return payload.trim()
  }

  const handleCopyMagicString = async () => {
    if (!shareMagicString) {
      shareCopyStatus = 'Nothing to copy yet.'
      return
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareMagicString)
        shareCopyStatus = 'Copied to clipboard.'
      } else {
        shareCopyStatus = 'Copy not supported on this device.'
      }
    } catch (error) {
      console.warn('Failed to copy magic string', error)
      shareCopyStatus = 'Copy failed.'
    }
    setTimeout(() => {
      shareCopyStatus = ''
    }, 3000)
  }

  const handleImportMagicString = () => {
    const payload = normalizeMagicPayload(shareImportValue)
    if (!payload) {
      shareImportStatus = 'Paste a magic string first.'
      return
    }
    try {
      const decompressed = decompressFromEncodedURIComponent(payload)
      if (!decompressed) {
        shareImportStatus = 'Invalid magic string.'
        return
      }
      editorSource = decompressed
      shareImportValue = ''
      applyEditorChanges()
      shareImportStatus = 'Magic string applied. Review and apply changes.'
    } catch (error) {
      console.warn('Failed to import magic string', error)
      shareImportStatus = 'Unable to decode magic string.'
    }
    setTimeout(() => {
      shareImportStatus = ''
    }, 4000)
  }

  const handlePrefetchAnnouncement = (text, voice) => {
    const trimmedKey = openAiKey.trim()
    if (!ttsEnabled || !trimmedKey || !text) return
    speakWithOpenAI({
      text,
      voice: voice ?? openAiVoice,
      apiKey: trimmedKey,
      prefetchOnly: true
    }).catch((error) => {
      console.debug('[tts] prefetch failed', error?.message ?? error)
    })
  }

  const startMetronomeForPhase = (phase, remainingSeconds) => {
    if (!enableMetronome || !audioEnabled) return
    if (!phase || phase.type !== 'work') return
    const targetRpm = Number(phase?.metadata?.targetRpm) || 0
    if (!targetRpm) return
    const durationSeconds = Math.max(
      remainingSeconds && Number.isFinite(remainingSeconds)
        ? remainingSeconds
        : phase.durationSeconds ?? 0,
      0
    )
    if (durationSeconds <= 0) return
    if (activeMetronomePhaseId === phase.id) return
    if (!audioAvailable) {
      const ready = ensureAudioReady()
      if (!ready) return
    }
    stopMetronomePlayback()
    startMetronome({ rpm: targetRpm, totalDurationSeconds: durationSeconds })
    activeMetronomePhaseId = phase.id
    console.debug('[metronome] started', {
      phaseId: phase.id,
      rpm: targetRpm,
      durationSeconds
    })
  }

  onMount(() => {
    unsubscribeLatestRep = summaryLatestRepCount.subscribe((value) => {
      latestRepCountValue = value
    })
    pendingInitialWorkoutId = initialWorkoutId
    pendingInitialPlannedId = initialPlannedId
    if (typeof window !== 'undefined') {
      try {
        const storedVoice = window.localStorage.getItem('gs_ai_timer_openai_voice')
        if (storedVoice && openAiVoiceOptions.includes(storedVoice)) {
          openAiVoice = storedVoice
        }
        const storedMetronome = window.localStorage.getItem('gs_ai_timer_metronome_enabled')
        if (storedMetronome !== null) {
          enableMetronome = storedMetronome === 'true'
        }
      } catch (error) {
        console.warn('Failed to read saved OpenAI settings', error)
      }
      // initialize timer toggles from settings (already set in declarations)
      audioEnabled = audioSupported && $settings.timer.audioEnabled
      notificationsEnabled = $settings.timer.notificationsEnabled
      ttsEnabled = $settings.timer.ttsEnabled
      enableMetronome = $settings.timer.enableMetronome
    }
    savedWorkouts = loadSavedWorkoutsFromStorage()
    loadSavedWorkoutsFromApi().then((remote) => {
      if (remote?.length) {
        savedWorkouts = mergeWorkouts(savedWorkouts, remote)
        persistSavedWorkouts(savedWorkouts)
      }
    })
    if (!audioSupported) {
      audioEnabled = false
    }
    if (canUseNotifications) {
      notificationPermission = window.Notification.permission
    } else {
      notificationsEnabled = false
      notificationPermission = 'denied'
    }
    updateTtsStatus()
    storageReady = true

    const isStandalone =
      (typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches) ||
      Boolean(window?.navigator?.standalone)

    if (isStandalone && canRequestWakeLock) {
      acquireWakeLock()
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', handleVisibilityChange)
        wakeLockListenerAttached = true
      }
    }
    const doc = typeof document !== 'undefined' ? document : null
    if (doc) {
      const support =
        doc.fullscreenEnabled ||
        doc.webkitFullscreenEnabled ||
        doc.mozFullScreenEnabled ||
        doc.msFullscreenEnabled
      isFullscreenSupported = Boolean(support)
      fullscreenChangeEvents.forEach((eventName) =>
        doc.addEventListener(eventName, handleFullscreenChange)
      )
      handleFullscreenChange()
    }
  })


  $: if (storageReady && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem('gs_ai_timer_openai_voice', openAiVoice)
      window.localStorage.setItem('gs_ai_timer_metronome_enabled', enableMetronome ? 'true' : 'false')
      setTimerSettings({
        audioEnabled,
        notificationsEnabled,
        enableMetronome,
        ttsEnabled,
        openAiVoice
      })
    } catch (error) {
      console.warn('Failed to persist OpenAI settings', error)
    }
  }

  $: updateTtsStatus()
  $: shareMagicString = (() => {
    if (!editorSource) return ''
    try {
      const compressed = compressToEncodedURIComponent(editorSource)
      return compressed ? `gswt:${compressed}` : ''
    } catch (error) {
      console.warn('Failed to compress magic string', error)
      return ''
    }
  })()

</script>

<main class="page" class:compact-page={compact}>
  {#if !compact && !hideHeader}
    <header class="page__header">
      <div>
        <p class="page__eyebrow">Workout plan</p>
        <h1>{plan.title}</h1>
        <p class="page__subtitle">
          {plan.rounds.length} rounds · {formatDuration(planTotals.total)} total
          time
        </p>
        {#if plan.description}
          <p class="page__description">{plan.description}</p>
        {/if}
      </div>
    </header>
  {/if}

  <div class="layout" class:side-slot-layout={showInlineSlot}>
    <section
      class="timer-panel"
      bind:this={timerPanelEl}
      class:timer-panel--fullscreen={isFullscreen}
    >
      <div class="timer-panel__status">
        <div class="timer-panel__status-group">
          <span class="timer-panel__status-pill">{timerStatusMessage}</span>
          <span class="timer-panel__phase">
            {#if timeline.length}
              {phasePositionLabel}
            {:else}
              No phases defined
            {/if}
          </span>
        </div>
        <div class="status-actions">
          {#if !isFullscreen}
            <button class="ghost small" type="button" on:click={openSummary}>Summary</button>
          {/if}
          {#if isFullscreenSupported}
            <button
              type="button"
              class="timer-panel__fullscreen-button"
              on:click={toggleFullscreen}
              aria-pressed={isFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {#if isFullscreen}
                <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
                  <path
                    d="M9 4a1 1 0 0 1 2 0v3h3a1 1 0 1 1 0 2h-4a1 1 0 0 1-1-1Zm6 16a1 1 0 0 1-1-1v-3h-3a1 1 0 1 1 0-2h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1ZM4 9a1 1 0 0 1 1-1h3V5a1 1 0 0 1 2 0v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Zm16 6a1 1 0 0 1-1 1h-3v3a1 1 0 0 1-2 0v-4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1Z"
                    fill="currentColor"
                  />
                </svg>
              {:else}
                <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
                  <path
                    d="M4 10a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4a1 1 0 1 1 0 2H5v3a1 1 0 0 1-1 1Zm16 0a1 1 0 0 1-1-1V6h-3a1 1 0 1 1 0-2h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1Zm-1 10h-4a1 1 0 1 1 0-2h3v-3a1 1 0 1 1 2 0v4a1 1 0 0 1-1 1Zm-15-1v-4a1 1 0 1 1 2 0v3h3a1 1 0 0 1 0 2H5a1 1 0 0 1-1-1Z"
                    fill="currentColor"
                  />
                </svg>
              {/if}
            </button>
          {/if}
        </div>
      </div>

      {#if timerError}
        <p class="timer-panel__error">{timerError}</p>
      {/if}

      <div class="timer-inline" class:timer-inline--with-slot={showInlineSlot}>
        <div class="timer-card">
          <div class="timer-and-slot">
  <TimerDisplay
    {activePhase}
    {phaseRemainingSeconds}
    {phaseProgressPercent}
    {nextPhase}
    totalRemainingSeconds={totalRemainingSeconds}
    overallProgressPercent={overallProgressPercent}
    isRunning={isTimerRunning}
    isPaused={isTimerPaused}
    showInlineSlot={showInlineSlot}
    on:toggleTimer={handleTimerTap}
  >
    <svelte:fragment slot="inline">
      {#if showInlineSlot}
        <div class="inline-content">
          <slot name="inline" />
        </div>
      {/if}
    </svelte:fragment>
  </TimerDisplay>
          </div>

          {#if !hideControlBar}
            <ControlBar
              isRunning={isTimerRunning}
              isPaused={isTimerPaused}
              canStart={canStartTimer}
              canSkip={canSkipPhase}
              on:start={startTimer}
              on:pause={pauseTimer}
              on:resume={resumeTimer}
              on:stop={stopTimer}
              on:skip={skipPhase}
            />
          {/if}
        </div>
      </div>

      {#if !isFullscreen}
        <PhaseQueue phases={timeline} activeIndex={activePhaseIndex} />
      {/if}
    </section>

    {#if !compact}
    <section class="planner-panel">
      <section class="saved-workouts">
        <div class="saved-workouts__header">
          <div class="saved-workouts__intro">
            <h2>Saved workouts</h2>
            <p>
              {#if savedWorkouts.length === 0}
                Nothing saved yet. Use the YAML editor to tailor a plan and press “Save workout”.
              {:else}
                {savedWorkouts.length} saved {savedWorkouts.length === 1 ? 'plan' : 'plans'}.
              {/if}
            </p>
          </div>
          {#if libraryWorkouts.length}
            <button class="ghost saved-workouts__library-button" type="button" on:click={openLibraryModal}>
              Load from library
            </button>
          {/if}
        </div>
        {#if savedWorkouts.length === 0}
          <p class="saved-workouts__empty">
            Saved workouts will appear here for quick re-use.
          </p>
        {:else}
          <ul class="saved-workouts__list">
            {#each savedWorkouts as workout (workout.id)}
              <li class:saved-workouts__item--active={workout.id === selectedWorkoutId}>
                <div class="saved-workouts__info">
                  <strong>{workout.name}</strong>
                  <span>Updated {formatUpdatedAt(workout.updatedAt)}</span>
                </div>
                <div class="saved-workouts__actions">
                  <button
                    type="button"
                    class="text-button"
                    on:click={() => loadWorkout(workout)}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    class="text-button text-button--danger"
                    on:click={() => requestDeleteWorkout(workout.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
      {#if confirmSavedDeleteId}
        <div class="modal-backdrop"></div>
        <div class="confirm-modal">
          <p>Delete this saved workout?</p>
          {#if savedDeleteError}<p class="error small">{savedDeleteError}</p>{/if}
          <div class="confirm-actions">
            <button
              class="ghost"
              type="button"
              on:click={() => {
                confirmSavedDeleteId = null
                savedDeleteError = ''
                savedDeleteStatus = ''
              }}
            >
              Cancel
            </button>
            <button
              class="danger"
              type="button"
              disabled={savedDeleteStatus === 'Deleting…'}
              on:click={() => confirmSavedDeleteId && deleteWorkout(confirmSavedDeleteId)}
            >
              {savedDeleteStatus || 'Delete'}
            </button>
          </div>
        </div>
      {/if}
      {#if toasts.length}
        <div class="toast-stack">
          {#each toasts as toast (toast.id)}
            <div class={`toast ${toast.type}`}>
              <span>{toast.message}</span>
              <button
                class="ghost icon-btn"
                aria-label="Dismiss"
                type="button"
                on:click={() => (toasts = toasts.filter((t) => t.id !== toast.id))}
              >
                ×
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <section class="ai-panel">
        <h2>AI Assistant</h2>
        <p class="ai-panel__note">
          Set your OpenAI API key in Settings (stored locally) and describe the workout you want.
          Press generate to replace the YAML configuration below.
        </p>
        <div class="ai-panel__controls">
          <button class="ghost" type="button" on:click={openSettings}>Settings</button>
          <label>
            <span>TTS Voice</span>
            <select bind:value={openAiVoice} on:change={handleOpenAiVoiceChange}>
              {#each openAiVoiceOptions as voice}
                <option value={voice}>{voice}</option>
              {/each}
            </select>
          </label>
        </div>
        <div class="ai-panel__description">
          <textarea
            rows="4"
            placeholder="Describe your workout goals, equipment, duration, and preferences..."
            bind:value={aiPrompt}
          ></textarea>
        </div>
        <div class="ai-panel__actions">
          <button
            class="primary"
            type="button"
            on:click={generateWorkoutFromAi}
            disabled={isGenerating || !aiPrompt.trim() || !openAiKey.trim()}
          >
            {#if isGenerating}
              Generating…
            {:else}
              Generate workout
            {/if}
          </button>
          {#if aiStatus}
            <span class="ai-status">{aiStatus}</span>
          {/if}
          {#if aiError}
            <span class="ai-error">{aiError}</span>
          {/if}
        </div>
        <div class="ai-panel__description ai-panel__description--edit">
          <textarea
            rows="3"
            placeholder="Tell the AI how to change the current YAML (e.g. 'make 6 rounds of 1 minute work/30s rest')"
            bind:value={aiEditInstructions}
          ></textarea>
        </div>
        <div class="ai-panel__actions">
          <button
            class="secondary"
            type="button"
            on:click={modifyWorkoutWithAi}
            disabled={isAiEditing || !aiEditInstructions.trim() || !openAiKey.trim()}
          >
            {#if isAiEditing}
              Applying…
            {:else}
              Modify current YAML
            {/if}
          </button>
          {#if aiEditStatus}
            <span class="ai-status">{aiEditStatus}</span>
          {/if}
          {#if aiEditError}
            <span class="ai-error">{aiEditError}</span>
          {/if}
        </div>
      </section>

      <section class="config-editor">
        <div class="config-editor__header">
          <div class="config-editor__title">
            <h2>Configuration (YAML)</h2>
            <button
              class="text-button text-button--info"
              type="button"
              on:click={() => (showYamlHelp = true)}
            >
              Syntax help
            </button>
            <label class="config-editor__label">
              <span>Workout name</span>
              <input
                type="text"
                placeholder="e.g. Lower Body Burner"
                bind:value={saveName}
              />
            </label>
          </div>
          <div class="config-editor__buttons">
            <button
              class="primary"
              type="button"
              on:click={handleSaveWorkout}
              disabled={!!parseError}
            >
              Save workout
            </button>
            <button
              class="accent"
              type="button"
              on:click={applyEditorChanges}
              disabled={!!parseError || !hasPendingChanges}
            >
              Apply changes
            </button>
            <button
              class="secondary"
              type="button"
              on:click={revertEditorChanges}
              disabled={!hasPendingChanges}
            >
              Revert edits
            </button>
            <button
              class="ghost"
              type="button"
              on:click={resetEditorToDefault}
              disabled={isUsingDefaultSource}
            >
              Reset to default
            </button>
          </div>
          <div class="config-editor__buttons config-editor__buttons--secondary">
            <button class="secondary" type="button" on:click={triggerImport}>
              Import YAML
            </button>
            <button class="ghost" type="button" on:click={exportWorkout}>
              Export YAML
            </button>
            <input
              class="file-input-hidden"
              bind:this={fileInputEl}
              type="file"
              accept=".yaml,.yml,text/yaml,text/plain"
              on:change={handleImportChange}
            />
          </div>
        </div>
        <div class="config-editor__body">
          <textarea
            class:has-error={!!parseError}
            bind:value={editorSource}
            rows="18"
            spellcheck="false"
          ></textarea>
          <div class="config-editor__status">
            {#if parseError}
              <p class="status status--error">
                Parse error: {parseError.message}
              </p>
            {:else if hasPendingChanges}
              <p class="status status--pending">
                Parsed successfully. Apply to update the workout overview.
              </p>
            {:else}
              <p class="status status--ok">Config is in sync with the workout.</p>
            {/if}

            {#if previewTotals}
              <ul class="config-editor__summary">
                <li>Total rounds: {previewResult.plan.rounds.length}</li>
                <li>Total work: {formatDuration(previewTotals.work)}</li>
                <li>Total rest: {formatDuration(previewTotals.rest)}</li>
                <li>Total time: {formatDuration(previewTotals.total)}</li>
              </ul>
            {/if}
          </div>
          <div class="magic-share">
            <h3>Magic share string</h3>
            <p class="magic-share__hint">
              Share compressed workouts between devices. Copy the generated string or paste one you received.
            </p>
            <div class="magic-share__row">
              <input
                class="magic-share__output"
                type="text"
                readonly
                value={shareMagicString}
                placeholder="Apply changes to generate magic string"
              />
              <button
                class="secondary"
                type="button"
                on:click={handleCopyMagicString}
                disabled={!shareMagicString}
              >
                Copy
              </button>
            </div>
            {#if shareCopyStatus}
              <p class="magic-share__status">{shareCopyStatus}</p>
            {/if}
            <div class="magic-share__row magic-share__row--import">
              <input
                class="magic-share__input"
                type="text"
                bind:value={shareImportValue}
                placeholder="Paste magic string (gswt:...)"
              />
              <button class="accent" type="button" on:click={handleImportMagicString}>
                Import
              </button>
            </div>
            {#if shareImportStatus}
              <p class="magic-share__status">{shareImportStatus}</p>
            {/if}
          </div>
        </div>
      </section>

      <section class="overview">
        <h2>Session overview</h2>
        <div class="overview__grid">
          <div class="overview__item">
            <span>Total work</span>
            <strong>{formatDuration(planTotals.work)}</strong>
          </div>
          <div class="overview__item">
            <span>Total rest</span>
            <strong>{formatDuration(planTotals.rest)}</strong>
          </div>
          <div class="overview__item">
            <span>Rounds</span>
            <strong>{plan.rounds.length}</strong>
          </div>
        </div>
      </section>

      <section class="rounds">
        <div class="rounds__header">
          <h2>Rounds &amp; sets</h2>
          <button class="ghost rounds__header-button" type="button" on:click={openPlanEditor}>
            Edit session info
          </button>
        </div>
        <div class="rounds__list">
          {#each plan.rounds as round, roundIndex}
            {#key round.id}
              {@const roundTotals = getRoundTotals(round, roundIndex, roundTotalsMap)}
              <article class="round">
                <header class="round__header">
                  <div>
                    <h3>
                      Round {roundIndex + 1}: {round.label}
                    </h3>
                    <p>
                      Repetitions: {round.repetitions} · Rest after round:{' '}
                      {formatDuration(round.restAfterSeconds || 0)}
                    </p>
                  </div>
                  <div class="round__actions">
                    <div class="round__badges">
                      {#if round.repetitions > 1}
                        <span class="round__badge round__badge--repeat">
                          {round.repetitions}× cycle
                        </span>
                      {/if}
                      <span class="round__badge round__badge--duration">
                        {formatDuration(roundTotals.total)}
                      </span>
                    </div>
                    <button
                      type="button"
                      class="text-button"
                      on:click={() => openRoundEditor(round, roundIndex)}
                    >
                      Edit round
                    </button>
                  </div>
                </header>

                <div
                  class="round-timeline"
                  class:round-timeline--single={round.repetitions <= 1}
                >
                  {#if round.repetitions > 1}
                    <div class="round-timeline__repeat-label">
                      {round.repetitions}× round
                    </div>
                  {/if}
                  <div class="round-timeline__content">
                    <ul class="set-list">
                      {#each round.sets as set, setIndex (set.id)}
                        {#key `${set.id}-${setIndex}`}
                          {@const segments = buildSetSegments(
                            set,
                            round.sets[setIndex + 1]?.label,
                            round.repetitions,
                            round.restAfterSeconds,
                            roundIndex < plan.rounds.length - 1
                          )}
                          {@const hasSetBadge = segments.setRepetitions > 1 && (segments.work || segments.rest)}
                          <li class="set">
                            <div class="set__header">
                              <div>
                                <h4>{set.label}</h4>
                                <p>
                                  {set.repetitions} × {formatDuration(set.workSeconds)} work
                                  {#if set.restSeconds}
                                    · rest {formatDuration(set.restSeconds)} between reps
                                  {/if}
                                  {#if set.targetRpm}
                                    · {set.targetRpm} RPM
                                  {/if}
                                </p>
                              </div>
                              <div class="set__meta">
                                <span class="set__meta-total">
                                  Total: {formatDuration(segments.total)}
                                </span>
                                {#if setIndex < round.sets.length - 1 && set.transitionSeconds}
                                  <span class="set__meta-transition">
                                    Next transition: {formatDuration(set.transitionSeconds)}
                                  </span>
                                {/if}
                                <button
                                  type="button"
                                  class="text-button set__edit-button"
                                  on:click={() => openSetEditor(roundIndex, setIndex)}
                                >
                                  Edit set
                                </button>
                              </div>
                            </div>
                            <div
                              class="set-timeline"
                              class:set-timeline--compact={!hasSetBadge}
                              aria-label={`Timeline for ${set.label}`}
                            >
                              {#if hasSetBadge}
                                <div class="set-repeat-labels">
                                  <div class="set-repeat-label">
                                    {segments.setRepetitions}× reps
                                  </div>
                                </div>
                              {/if}
                              <div class="set-timeline__segments">
                                {#if segments.work}
                                  <div class="segment-block segment-block--work">
                                    <span class="segment-block__label">
                                      {#if segments.setRepetitions > 1}
                                        {set.targetRpm
                                          ? `Work per rep (${set.targetRpm} RPM)`
                                          : 'Work per rep'}
                                      {:else}
                                        {set.targetRpm ? `Work (${set.targetRpm} RPM)` : 'Work'}
                                      {/if}
                                    </span>
                                    <span class="segment-block__time">{formatDuration(segments.work)}</span>
                                  </div>
                                {/if}
                                {#if segments.rest}
                                  <div class="segment-block segment-block--rest">
                                    <span class="segment-block__label">
                                      {segments.setRepetitions > 1 ? 'Rest between reps' : 'Rest'}
                                    </span>
                                    <span class="segment-block__time">{formatDuration(segments.rest)}</span>
                                  </div>
                                {/if}
                              </div>
                            </div>
                          </li>
                          {#if segments.transitionSegment}
                            <li class="set-transition">
                              <div class="segment-block segment-block--transition">
                                <span class="segment-block__label">
                                  {segments.transitionSegment.label}
                                </span>
                                <span class="segment-block__time">{formatDuration(segments.transitionSegment.duration)}</span>
                              </div>
                            </li>
                          {/if}
                        {/key}
                      {/each}
                    </ul>
                    {#if roundIndex < plan.rounds.length - 1 && round.restAfterSeconds > 0}
                      <div class="round-rest-block">
                        <span class="round-rest-block__label">Rest between rounds</span>
                        <span class="round-rest-block__time">{formatDuration(round.restAfterSeconds)}</span>
                      </div>
                    {/if}
                  </div>
                </div>
              </article>
            {/key}
          {/each}
        </div>
      </section>
    </section>
    {/if}
  </div>

</main>

<PlanEditorModal
  open={planEditorOpen}
  title={plan.title}
  description={plan.description}
  preStartSeconds={plan.preStartSeconds}
  preStartLabel={plan.preStartLabel}
  on:close={closePlanEditor}
  on:save={handlePlanSave}
/>

<RoundEditorModal
  open={roundEditorOpen}
  round={roundEditorData}
  roundIndex={roundEditorIndex ?? 0}
  on:close={closeRoundEditor}
  on:save={handleRoundSave}
/>

<SetEditorModal
  open={setEditorOpen}
  roundIndex={setEditorRoundIndex ?? 0}
  setIndex={setEditorSetIndex ?? 0}
  set={setEditorData}
  on:close={closeSetEditor}
  on:save={handleSetSave}
/>

<LibraryModal
  open={libraryModalOpen}
  workouts={libraryWorkouts}
  on:close={() => (libraryModalOpen = false)}
  on:select={handleLibraryTemplateSelect}
/>

<YamlHelpModal open={showYamlHelp} on:close={() => (showYamlHelp = false)} />

<style>
  .page {
    max-width: 960px;
    margin: 0 auto;
    padding: 2.5rem 1.25rem 3.5rem;
    display: flex;
    flex-direction: column;
    gap: 2.25rem;
  }
  .page.compact-page {
    max-width: none;
    padding: 0.75rem;
    gap: 0.75rem;
  }

  .page__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .page__eyebrow {
    margin: 0 0 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .page__header h1 {
    margin: 0;
    font-size: clamp(1.25rem, 3.5vw + 0.4rem, 1.85rem);
    font-weight: 600;
    line-height: 1.2;
  }

  .page__subtitle {
    margin: 0.25rem 0 0;
    color: var(--color-text-secondary);
    font-size: 0.95rem;
  }

  .page__description {
    margin: 0.5rem 0 0;
    color: var(--color-text-muted);
    font-size: 0.95rem;
    max-width: 540px;
  }

  button.primary {
    background: var(--color-accent);
    border: 1px solid var(--color-accent);
    border-radius: 14px;
    color: var(--color-surface-deeper);
    font-weight: 600;
    padding: 0.7rem 1.4rem;
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease;
  }

  button.primary:hover {
    background: var(--color-accent-hover);
    border-color: var(--color-accent-hover);
  }

  button.primary:active {
    background: var(--color-accent-active);
    border-color: var(--color-accent-active);
  }

  .overview {
    background: var(--color-surface-2);
    border-radius: 16px;
    padding: 1.75rem;
    border: 1px solid var(--color-border);
  }

  .overview h2,
  .rounds h2 {
    margin: 0 0 1rem;
    font-size: 1.5rem;
  }

  .overview__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 1rem;
  }

  .overview__item {
    background: var(--color-surface-1);
    border-radius: 12px;
    padding: 1.25rem;
    border: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .overview__item span {
    font-size: 0.9rem;
    color: var(--color-text-muted);
  }

  .overview__item strong {
    font-size: 1.4rem;
  }

  .rounds__list {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .rounds__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.35rem;
  }

  .rounds__header-button {
    padding: 0.55rem 1.2rem;
  }

 .round {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    transition: border-color 180ms ease, background-color 180ms ease;
  }

  .round__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .round__header h3 {
    margin: 0;
    font-size: 1.3rem;
  }

  .round__header p {
    margin: 0.35rem 0 0;
    color: var(--color-text-secondary);
    font-size: 0.9rem;
  }

  .round__actions {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .round__badge {
    background: var(--color-border);
    color: var(--color-badge-text);
    border-radius: 999px;
    padding: 0.35rem 0.9rem;
    font-size: 0.85rem;
    font-weight: 600;
    transition: background-color 180ms ease, color 180ms ease, border-color 180ms ease;
  }

  .round__badges {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .round__badge--repeat {
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    color: var(--color-roundrepeat-text);
    border: 1px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
  }

  .round__badge--duration {
    background: color-mix(in srgb, var(--color-surface-deeper) 85%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border) 55%, transparent);
  }

  .round-timeline {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: stretch;
    gap: 1rem;
    border-radius: 16px;
    padding: 0.75rem 1rem 1rem;
    background: color-mix(in srgb, var(--color-surface-deeper) 88%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border) 55%, transparent);
    transition: border-color 180ms ease, background-color 180ms ease;
  }

  .round-timeline--single {
    grid-template-columns: 1fr;
  }

  .round-timeline--single .round-timeline__repeat-label {
    display: none;
  }

  .round-timeline__repeat-label {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.45rem 0.85rem;
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    border: 1px dashed color-mix(in srgb, var(--color-accent) 45%, transparent);
    border-radius: 12px;
    font-weight: 700;
    font-size: 0.85rem;
    color: var(--color-roundrepeat-text);
    white-space: nowrap;
  }

  .round-timeline__content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .round-rest-block {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.6rem;
    padding: 0.75rem 0.85rem;
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 35%, transparent);
    font-size: 0.9rem;
    color: var(--color-roundrest-text);
    transition: border-color 180ms ease, background-color 180ms ease, color 180ms ease;
  }

  .round-rest-block__label {
    font-weight: 600;
  }

  .round-rest-block__time {
    font-family: 'Inter', system-ui, sans-serif;
  }

  .set-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .set-transition {
    list-style: none;
    margin: 0.35rem 0 0.55rem;
  }

  .set {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 1.1rem 1.25rem;
    background: var(--color-surface-1);
    transition: border-color 180ms ease, background-color 180ms ease;
  }

  .set__header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .set h4 {
    margin: 0 0 0.35rem;
    font-size: 1.05rem;
  }

  .set p {
    margin: 0;
    font-size: 0.9rem;
    color: var(--color-text-muted);
  }

  .set__meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.2rem;
    font-size: 0.82rem;
    color: var(--color-text-secondary);
    text-align: right;
  }

  .set__meta-total {
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .set__edit-button {
    padding: 0.15rem 0;
    font-size: 0.85rem;
  }

  .set-timeline {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.75rem;
    width: 100%;
    align-items: stretch;
  }

  .set-timeline--compact {
    display: block;
  }

  .set-repeat-labels {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    justify-content: flex-start;
    min-width: 3.4rem;
  }

  .set-repeat-label {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.28rem 0.75rem;
    background: color-mix(in srgb, var(--color-border) 20%, transparent);
    border: 1px dashed color-mix(in srgb, var(--color-border) 45%, transparent);
    border-radius: 10px;
    font-weight: 700;
    font-size: 0.82rem;
    color: var(--color-text-primary);
    white-space: nowrap;
    align-self: flex-start;
  }

  .set-timeline__segments {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding-left: 1rem;
    border-left: 2px solid color-mix(in srgb, var(--color-border) 45%, transparent);
  }

  .set-timeline__segments::before,
  .set-timeline__segments::after {
    content: '';
    position: absolute;
    left: -2px;
    width: 10px;
    height: 12px;
    border-left: 2px solid color-mix(in srgb, var(--color-border) 45%, transparent);
  }

  .set-timeline__segments::before {
    top: -2px;
    border-top: 2px solid color-mix(in srgb, var(--color-border) 45%, transparent);
    border-radius: 4px 0 0 0;
  }

  .set-timeline__segments::after {
    bottom: -2px;
    border-bottom: 2px solid color-mix(in srgb, var(--color-border) 45%, transparent);
    border-radius: 0 0 0 4px;
  }

  .set-timeline--compact .set-timeline__segments {
    padding-left: 0;
    border-left: none;
  }

  .set-timeline--compact .set-timeline__segments::before,
  .set-timeline--compact .set-timeline__segments::after {
    display: none;
  }

  .segment-block {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    padding: 0.65rem 0.85rem;
    border-radius: 10px;
    color: var(--color-segment-text);
    border: 1px solid transparent;
    font-size: 0.85rem;
    box-sizing: border-box;
    transition: background-color 180ms ease, border-color 180ms ease, color 180ms ease;
  }

  .segment-block__label {
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .segment-block__time {
    font-size: 0.8rem;
    opacity: 0.85;
  }

  .segment-block--work {
    background: var(--color-work-bg);
    border-color: var(--color-work-border);
  }

  .segment-block--rest {
    background: var(--color-rest-bg);
    border-color: var(--color-success);
  }

  .segment-block--transition {
    background: var(--color-transition-bg);
    border-color: var(--color-accent-soft);
  }

  @media (max-width: 680px) {
    .set {
      padding: 1rem;
    }

    .set-timeline {
      gap: 0.6rem;
      grid-template-columns: auto 1fr;
    }

    .set-repeat-labels {
      flex-direction: column;
      gap: 0.3rem;
      min-width: 3.6rem;
    }

    .set-repeat-label {
      padding: 0.25rem 0.55rem;
      border-radius: 8px;
      font-size: 0.78rem;
    }

    .set-timeline__segments {
      gap: 0.4rem;
      padding-left: 0.75rem;
    }

    .segment-block {
      flex-wrap: wrap;
      gap: 0.4rem;
      padding: 0.55rem 0.65rem;
      font-size: 0.8rem;
    }

    .set-transition {
      margin: 0.3rem 0 0.5rem;
    }

    .set-timeline__segments::before,
    .set-timeline__segments::after {
      width: 8px;
      height: 9px;
    }

    .set-timeline--compact {
      display: block;
    }

    .set-timeline--compact .set-repeat-labels {
      display: none;
    }

    .round-timeline {
      grid-template-columns: 1fr;
      padding: 0.65rem 0.85rem 0.85rem;
    }

    .round-timeline__repeat-label {
      display: inline-flex;
      padding: 0.35rem 0.7rem;
      font-size: 0.8rem;
    }

    .round-timeline__content {
      gap: 0.75rem;
    }

    .round-rest-block {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.3rem;
      font-size: 0.85rem;
    }

    .magic-share {
      padding: 1rem 1.05rem;
    }

    .magic-share__row {
      gap: 0.6rem;
    }

    .magic-share__output,
    .magic-share__input {
      flex: 1 1 100%;
    }

  }

  .config-editor {
    background: var(--color-surface-2);
    border-radius: 16px;
    padding: 1.75rem;
    border: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .config-editor__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .config-editor__title {
    display: flex;
    align-items: flex-end;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .config-editor__label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  .config-editor__label span {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.7rem;
  }

  .config-editor__label input {
    border-radius: 14px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: 0.55rem 1rem;
    font-size: 0.95rem;
    min-width: 200px;
  }

  .config-editor__label input::placeholder {
    color: var(--color-placeholder);
  }

  .config-editor__label input:focus {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .config-editor__buttons {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .config-editor__buttons--secondary {
    margin-top: 0.5rem;
  }

  .config-editor__buttons--secondary button {
    padding: 0.55rem 1.2rem;
  }

  .file-input-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }

  .config-editor__body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.25rem;
  }

  .config-editor textarea {
    width: 100%;
    min-height: 260px;
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-family: 'Fira Code', 'SFMono-Regular', Menlo, Consolas, monospace;
    font-size: 0.95rem;
    padding: 1rem;
    resize: vertical;
    line-height: 1.4;
    box-sizing: border-box;
  }

  .config-editor textarea.has-error {
    border-color: var(--color-danger);
  }

  .config-editor__status {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .magic-share {
    margin-top: 0.25rem;
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 1.2rem 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .magic-share h3 {
    margin: 0;
    font-size: 1.05rem;
  }

  .magic-share__hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  .magic-share__row {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .magic-share__row--import {
    margin-top: 0.1rem;
  }

  .magic-share__output,
  .magic-share__input {
    flex: 1 1 260px;
    min-width: 0;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-deep);
    color: var(--color-text-primary);
    padding: 0.6rem 0.8rem;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 0.9rem;
  }

  .magic-share__output::placeholder,
  .magic-share__input::placeholder {
    color: var(--color-placeholder);
  }

  .magic-share__status {
    margin: 0;
    font-size: 0.8rem;
    color: var(--color-accent-soft);
  }

  .config-editor__summary {
    margin: 0;
    padding-left: 1rem;
    font-size: 0.9rem;
    color: var(--color-text-muted);
  }

  .status {
    margin: 0;
    font-size: 0.9rem;
  }

  .status--error {
    color: var(--color-danger-soft);
  }

  .status--pending {
    color: var(--color-warning);
  }

  .status--ok {
    color: var(--color-success-soft);
  }

  button.ghost {
    background: transparent;
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    font-weight: 600;
    padding: 0.7rem 1.5rem;
    cursor: pointer;
    transition: border-color 120ms ease, color 120ms ease;
  }

  button.ghost:hover {
    color: var(--color-text-inverse);
    border-color: var(--color-border-hover);
  }

  button.ghost:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  button.accent {
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    color: var(--color-accent-muted);
    border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
    border-radius: 999px;
    font-weight: 600;
    padding: 0.7rem 1.5rem;
    cursor: pointer;
    transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
  }

  button.accent:hover {
    color: var(--color-text-inverse);
    border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
    background: color-mix(in srgb, var(--color-accent) 25%, transparent);
  }

  button.accent:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .layout {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  .timer-inline {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
    align-items: start;
  }
  .timer-card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .timer-panel {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    background: color-mix(in srgb, var(--color-surface-deep) 88%, transparent);
    border-radius: 24px;
    border: 1px solid color-mix(in srgb, var(--color-border) 55%, transparent);
    padding: clamp(1.25rem, 3vw, 1.75rem);
  }

  .timer-panel__status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
  }
  .status-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  .timer-panel__status-group {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
  }

  .timer-panel__status-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    padding: 0.4rem 0.95rem;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    background: color-mix(in srgb, var(--color-accent) 22%, transparent);
    color: var(--color-status-pill-text);
    border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
    white-space: nowrap;
    transition: background-color 180ms ease, color 180ms ease, border-color 180ms ease;
  }

  .timer-panel__phase {
    font-size: 0.85rem;
    color: var(--color-text-secondary);
    transition: color 160ms ease;
  }

  .timer-panel__error {
    margin: 0;
    color: var(--color-danger-soft);
    font-size: 0.9rem;
  }

  .timer-panel__fullscreen-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.45rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
    line-height: 0;
  }

  .timer-panel__fullscreen-button:hover,
  .timer-panel__fullscreen-button:focus-visible {
    background: color-mix(in srgb, var(--color-surface-3) 85%, transparent);
    border-color: var(--color-border-hover);
    outline: none;
  }

  .timer-panel__fullscreen-button:focus-visible {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 25%, transparent);
  }

  .timer-panel__fullscreen-button[aria-pressed='true'] {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
    color: var(--color-accent-soft);
  }

  .timer-panel__fullscreen-button svg {
    width: 1.25rem;
    height: 1.25rem;
  }

  .timer-panel--fullscreen {
    position: relative;
    max-width: none;
    width: 100%;
    min-height: 100vh;
    border-radius: 0;
    padding: clamp(1.75rem, 6vw, 3.5rem);
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: clamp(1.5rem, 4vh, 2.8rem);
    background: color-mix(in srgb, var(--color-surface-deep) 94%, transparent);
  }

  .timer-panel--fullscreen .timer-panel__status,
  .timer-panel--fullscreen :global(.timer-display),
  .timer-panel--fullscreen :global(.control-bar) {
    max-width: min(1200px, 100%);
    margin-left: auto;
    margin-right: auto;
    width: 100%;
  }

  .timer-panel--fullscreen :global(.timer-display) {
    align-self: center;
    width: min(1200px, 100%);
  }

  .timer-panel--fullscreen :global(.timer-display__time) {
    font-size: clamp(4.8rem, 20vw, 9.2rem);
  }

  .timer-panel--fullscreen :global(.timer-display__label) {
    font-size: clamp(1.4rem, 5vw, 2.4rem);
  }

  .timer-panel--fullscreen :global(.timer-display__current) {
    padding: clamp(2.4rem, 10vw, 4.5rem);
    width: 100%;
  }

  .timer-panel--fullscreen :global(.timer-display__bars) {
    width: 100%;
    max-width: min(1000px, 100%);
    margin-left: auto;
    margin-right: auto;
  }

  .timer-panel--fullscreen :global(.control-bar) {
    padding: clamp(1.1rem, 3vh, 1.6rem);
    width: min(100%, 1000px);
    margin-left: auto;
    margin-right: auto;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  }

  @media (min-width: 1500px) {
    .timer-panel--fullscreen {
      max-width: calc(100% - 260px);
      margin: 0 auto;
      padding: clamp(2.5rem, 5vw, 4rem);
    }

    .timer-panel--fullscreen .timer-panel__status,
    .timer-panel--fullscreen :global(.timer-display),
    .timer-panel--fullscreen :global(.control-bar) {
      max-width: none;
      width: 100%;
    }

    .timer-panel--fullscreen :global(.timer-display__time) {
      font-size: clamp(6rem, 8vw, 14vh);
    }

    .timer-panel--fullscreen :global(.timer-display__label) {
      font-size: clamp(2rem, 5vh, 3.4rem);
    }

    .timer-panel--fullscreen :global(.timer-display__current) {
      padding: clamp(3rem, 8vh, 6rem);
    }

  .timer-panel--fullscreen :global(.timer-display__bars) {
    max-width: none;
    width: 100%;
  }

  .timer-panel--fullscreen :global(.bar) {
      height: 18px;
      border-width: 2px;
    }

    .timer-panel--fullscreen :global(.control-bar) {
      width: 100%;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 1rem;
    }

    .timer-panel--fullscreen :global(.control-bar button) {
      font-size: clamp(1rem, 2.7vh, 1.45rem);
      padding: clamp(0.9rem, 2.2vh, 1.3rem) clamp(1rem, 2.7vh, 1.45rem);
    }

    .timer-panel--fullscreen :global(.timer-display__next) {
      padding: clamp(1.4rem, 2.7vh, 2.3rem);
      gap: clamp(0.5rem, 1.2vh, 1.1rem);
    }

    .timer-panel--fullscreen :global(.timer-display__next-label) {
      font-size: clamp(1rem, 1.8vh, 1.4rem);
      letter-spacing: 0.1em;
    }

    .timer-panel--fullscreen :global(.timer-display__next-meta) {
      font-size: clamp(1.1rem, 2.6vh, 1.6rem);
      gap: clamp(0.35rem, 0.9vh, 0.75rem);
    }

    .timer-panel--fullscreen :global(.timer-display__next-meta strong) {
      font-size: clamp(1.25rem, 3.1vh, 1.9rem);
    }
  }

  @media (max-width: 680px) {
    .timer-panel__fullscreen-button {
      padding: 0.4rem;
    }

    .timer-panel--fullscreen {
      padding: clamp(1.25rem, 5vw, 2rem);
      grid-template-rows: auto 1fr auto;
    }

    .timer-panel--fullscreen :global(.control-bar) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .planner-panel {
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
  }

  .ai-panel {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    padding: 1.75rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .ai-panel h2 {
    margin: 0;
    font-size: 1.4rem;
  }

  .ai-panel__note {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.9rem;
  }

  .ai-panel__controls {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
  }

  .ai-panel__controls label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  .ai-panel__controls select {
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-soft);
    padding: 0.55rem 0.8rem;
    font-size: 0.95rem;
  }

  .ai-panel__description textarea {
    width: 100%;
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-soft);
    font-size: 0.95rem;
    padding: 1rem;
    resize: vertical;
    min-height: 120px;
    box-sizing: border-box;
  }

  .ai-panel__description--edit textarea {
    min-height: 90px;
  }

  .ai-panel__actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .ai-status {
    color: var(--color-success-soft);
    font-size: 0.9rem;
  }

  .ai-error {
    color: var(--color-danger-soft);
    font-size: 0.9rem;
  }

  .saved-workouts {
    background: var(--color-surface-2);
    border-radius: 16px;
    padding: 1.75rem;
    border: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .saved-workouts__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .saved-workouts__intro {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .saved-workouts__header h2 {
    margin: 0;
  }

  .saved-workouts__header p {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.9rem;
  }

  .saved-workouts__empty {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.95rem;
  }

  .saved-workouts__library-button {
    align-self: flex-start;
    white-space: nowrap;
  }

  .saved-workouts__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .saved-workouts__list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 1rem 1.25rem;
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
  }

  .saved-workouts__item--active {
    border-color: var(--color-accent);
    background: var(--color-surface-3);
  }

  .saved-workouts__info {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .saved-workouts__info strong {
    font-size: 1rem;
  }

  .saved-workouts__info span {
    color: var(--color-text-muted);
    font-size: 0.85rem;
  }

  .saved-workouts__actions {
    display: flex;
    gap: 0.75rem;
  }

  .text-button {
    background: transparent;
    border: 0;
    color: var(--color-accent);
    font-weight: 600;
    cursor: pointer;
    padding: 0;
  }

  .text-button:hover {
    color: var(--color-accent-hover);
  }

  .text-button--danger {
    color: var(--color-danger);
  }

  .text-button--danger:hover {
    color: var(--color-danger-soft);
  }

  .text-button--info {
    font-size: 0.85rem;
    font-weight: 500;
  }

  button.secondary {
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    font-weight: 600;
    padding: 0.7rem 1.5rem;
    cursor: pointer;
    transition: border-color 120ms ease, color 120ms ease;
  }

  button.secondary:hover {
    border-color: var(--color-border-hover);
    color: var(--color-text-inverse);
  }

  button.secondary:disabled,
  button.primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .toast-stack {
    position: fixed;
    top: 1rem;
    right: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    z-index: 200;
    pointer-events: none;
  }
  .toast {
    min-width: 240px;
    padding: 0.65rem 0.85rem;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
    color: var(--color-text-inverse);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    pointer-events: auto;
    animation: toast-in 220ms ease, toast-out 180ms ease 2.2s forwards;
  }
  .toast.error {
    background: color-mix(in srgb, var(--color-danger) 85%, var(--color-surface-1) 15%);
    border-color: var(--color-danger);
    color: var(--color-text-inverse);
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 30;
  }

  .confirm-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 31;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 1rem;
    min-width: 260px;
    box-shadow: 0 16px 60px rgba(0, 0, 0, 0.4);
  }

  .confirm-modal .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .error.small {
    font-size: 0.9rem;
  }

  @media (max-width: 680px) {
    .page {
      padding: 1.8rem 1.1rem 2.6rem;
      gap: 1.75rem;
    }

    .page__header h1 {
      font-size: clamp(1.1rem, 4.5vw + 0.35rem, 1.6rem);
    }

    .set,
    .round__header,
    .page__header {
      align-items: flex-start;
    }

    .set__meta {
      align-items: flex-start;
    }
  }
</style>
