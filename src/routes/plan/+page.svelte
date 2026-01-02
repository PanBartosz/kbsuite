<script lang="ts">
  import { onMount } from 'svelte'
  import YAML from 'yaml'
  import defaultPlanSource from '$lib/timer/config/default-plan.yaml?raw'
  import { buildTimeline } from '$lib/timer/lib/timeline.js'
  import { computePlanTotals as computeTotals } from '$lib/timer/lib/planTotals'
  import { buildPlannedSummary, type PlannedSummaryBlock } from '$lib/timer/lib/planSummary'
  import { settings, openSettingsModal } from '$lib/stores/settings'
  import LibraryModal from '$lib/timer/components/LibraryModal.svelte'
  import PhaseQueue from '$lib/timer/components/PhaseQueue.svelte'
  import { libraryTemplates } from '$lib/timer/library/index.js'
  import TimelineView from '$lib/timer/components/shared/TimelineView.svelte'
  import SessionOverview from '$lib/timer/components/shared/SessionOverview.svelte'
  import RoundsSetsView from '$lib/timer/components/shared/RoundsSetsView.svelte'
  import AiAssistantPanel from '$lib/timer/components/shared/AiAssistantPanel.svelte'
  import YamlConfigEditor from '$lib/timer/components/shared/YamlConfigEditor.svelte'
  import YamlHelpModal from '$lib/timer/components/YamlHelpModal.svelte'
  import PlanEditorModal from '$lib/timer/components/PlanEditorModal.svelte'
  import RoundEditorModal from '$lib/timer/components/RoundEditorModal.svelte'
  import SetEditorModal from '$lib/timer/components/SetEditorModal.svelte'
  import SharePlanModal from '$lib/components/SharePlanModal.svelte'
  import { defaultAiSystemPrompt } from '$lib/ai/prompts'
  import { loadInvites, loadPendingCount, shares } from '$lib/stores/shares'
  import { pushToast } from '$lib/stores/toasts'
  import { modal } from '$lib/actions/modal'
  import { browser } from '$app/environment'

  type Planned = {
    id: string
    planned_for: number
    title: string
    yaml_source: string
    notes?: string
    tags?: string[]
  }

  type WorkoutTemplate = { id: string; name: string; description?: string; yaml_source?: string }

  let plans: Planned[] = []
  let loading = false
  let error = ''
  let selectedDateKey = ''
  let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
  let editOpen = false
  let editId: string | null = null
  let editTitle = ''
  let editDate = new Date().toISOString().slice(0, 10)
  let editYaml = defaultPlanSource
  let editNotes = ''
  let editTags: string[] = []
  let newTag = ''
  let libraryWorkouts: WorkoutTemplate[] = []
  let libraryModalOpen = false
  let todayPlan: Planned | null = null
  let previewResult: { plan: any | null; error: Error | null } = { plan: null, error: null }
  let previewTotals: { work: number; rest: number; total: number } | null = null
  let showYamlHelp = false
  let duplicateOpen = false
  let duplicateSource: Planned | null = null
  let duplicateDate = ''
  let duplicateCopyMeta = true
  let mobileWeekStart = Date.now()
  let planEditorOpen = false
  let dayDetailEl: HTMLElement | null = null
  let lastScrolledDay: string | null = null
  let hoverPlan: Planned | null = null
  let hoverSummary: PlannedSummaryBlock[] = []
  let hoverTotals: { work: number; rest: number; total: number } | null = null
  let hoverAlignX: 'left' | 'right' = 'right'
  let hoverAlignY: 'above' | 'below' = 'below'
  let hoverLeft = 8
  let hoverTop = 8
  let calendarShellEl: HTMLElement | null = null
  let roundEditorOpen = false
  let roundEditorData: any = null
  let roundEditorIndex: number | null = null
  let setEditorOpen = false
  let setEditorRoundIndex: number | null = null
  let setEditorSetIndex: number | null = null
  let setEditorData: any = null
  let aiPrompt = ''
  let aiStatus = ''
  let aiError = ''
  let isGenerating = false
  let aiEditInstructions = ''
  let aiEditStatus = ''
  let aiEditError = ''
  let isAiEditing = false
  const OPENAI_CHAT_MODEL = 'gpt-4o-mini'
  let openAiKey = ''
  $: openAiKey = $settings.openAiKey ?? ''
  const systemPrompt = defaultAiSystemPrompt
  let shareModalOpen = false
  let shareTarget: Planned | null = null
  let shareDefaultDate = ''
  let inviteDates: Record<string, string> = {}
  let inviteStatus: Record<string, string> = {}
  let inviteError: Record<string, string> = {}
  let confirmDeleteId: string | null = null
  let confirmDeletePlan: Planned | null = null
  let deleteStatus = ''
  let deleteError = ''

  const dayKey = (ts: number) => {
    const d = new Date(ts)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  const startOfWeek = (ts: number) => {
    const d = new Date(ts)
    const dow = (d.getDay() + 6) % 7 // Monday first
    d.setDate(d.getDate() - dow)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const startOfMonthWeekday = (ts: number) => {
    const d = new Date(ts)
    d.setDate(1)
    const dow = d.getDay()
    return (dow + 6) % 7 // Monday first
  }
  const daysInMonth = (ts: number) => {
    const d = new Date(ts)
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  }
  const moveMonth = (delta: number) => {
    const d = new Date(calendarMonth)
    d.setMonth(d.getMonth() + delta)
    calendarMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    selectedDateKey = ''
  }
  const monthLabel = (ts: number) =>
    new Date(ts).toLocaleString(undefined, { month: 'long', year: 'numeric' })
  const weekLabel = (startTs: number) => {
    const start = new Date(startTs)
    const end = new Date(startTs)
    end.setDate(end.getDate() + 6)
    return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  }

  const loadPlans = async () => {
    loading = true
    error = ''
    try {
      const res = await fetch('/api/planned-workouts')
      const data = await res.json().catch(() => ({}))
      plans = data?.items ?? []
    } catch (err) {
      error = (err as any)?.message ?? 'Failed to load plans'
    } finally {
      loading = false
      computeToday()
    }
  }

  const computeToday = () => {
    const key = dayKey(Date.now())
    todayPlan = plans.find((p) => dayKey(p.planned_for) === key) ?? null
  }

  const buildLibraryWorkouts = () =>
    libraryTemplates
      .map((template) => {
        try {
          const source = (template?.source ?? '').trim()
          if (!source) return null
          const parsed = YAML.parse(source)
          const plan = normalizePlan(parsed)
          const totals = computeTotals(plan)
          return {
            id: template?.id ?? plan.title ?? crypto.randomUUID(),
            name: plan.title ?? 'Untitled session',
            description: plan.description ?? '',
            roundCount: plan.rounds.length,
            totals,
            yaml_source: source
          }
        } catch {
          return null
        }
      })
      .filter(Boolean) as WorkoutTemplate[]

  const selectTemplate = (tmpl: WorkoutTemplate) => {
    if (tmpl?.yaml_source) {
      editTitle = tmpl.name ?? editTitle
      editYaml = tmpl.yaml_source
    }
    libraryModalOpen = false
  }

  const openNew = (dateKey?: string) => {
    editId = null
    editTitle = ''
    editYaml = defaultPlanSource
    editNotes = ''
    editTags = []
    newTag = ''
    editDate = dateKey ?? new Date().toISOString().slice(0, 10)
    editOpen = true
  }

  const openDuplicate = (plan: Planned) => {
    duplicateSource = plan
    duplicateDate = selectedDateKey || dayKey(plan.planned_for)
    duplicateCopyMeta = true
    duplicateOpen = true
  }

  const openShare = (plan: Planned) => {
    shareTarget = plan
    shareDefaultDate = new Date(plan.planned_for).toISOString().slice(0, 10)
    shareModalOpen = true
  }

  const closeShare = () => {
    shareModalOpen = false
    shareTarget = null
  }

  const closeDuplicate = () => {
    duplicateOpen = false
    duplicateSource = null
  }

  const closeEdit = () => {
    editOpen = false
  }

  const closeDeleteConfirm = () => {
    confirmDeleteId = null
    deleteError = ''
    deleteStatus = ''
  }

  const openEdit = (plan: Planned) => {
    editId = plan.id
    editTitle = plan.title ?? ''
    editYaml = plan.yaml_source ?? ''
    editNotes = plan.notes ?? ''
    editTags = (plan.tags ?? []).map((t) => t.trim()).filter(Boolean)
    editDate = new Date(plan.planned_for).toISOString().slice(0, 10)
    editOpen = true
  }

  const savePlan = async () => {
    const plannedFor = Date.parse(editDate)
    if (!plannedFor) {
      error = 'Invalid date'
      return
    }
    try {
      const res = await fetch('/api/planned-workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editId,
          title: editTitle,
          plannedFor,
          yaml_source: editYaml,
          notes: editNotes,
          tags: editTags
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to save plan')
      const item: Planned | null = data?.item ?? null
      if (item) {
        const existing = plans.find((p) => p.id === item.id)
        plans = existing ? plans.map((p) => (p.id === item.id ? item : p)) : [...plans, item]
      }
      const key = dayKey(plannedFor)
      selectedDateKey = key
      const d = new Date(plannedFor)
      calendarMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
      // ensure full refresh from backend so calendar updates without reload
      await loadPlans()
      editOpen = false
      computeToday()
      pushToast('Planned workout saved.', 'success')
    } catch (err) {
      error = (err as any)?.message ?? 'Failed to save plan'
      pushToast(error, 'error')
    }
  }

  const handleDuplicateSave = async () => {
    if (!duplicateSource) return
    const plannedFor = Date.parse(duplicateDate)
    if (!plannedFor) {
      error = 'Invalid date'
      return
    }
    try {
      const res = await fetch('/api/planned-workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: duplicateSource.title,
          plannedFor,
          yaml_source: duplicateSource.yaml_source,
          notes: duplicateCopyMeta ? duplicateSource.notes : '',
          tags: duplicateCopyMeta ? duplicateSource.tags : []
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to duplicate plan')
      const item: Planned | null = data?.item ?? null
      if (item) {
        plans = [...plans, item]
      }
      const key = dayKey(plannedFor)
      selectedDateKey = key
      const d = new Date(plannedFor)
      calendarMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
      await loadPlans()
      computeToday()
      pushToast('Workout duplicated.', 'success')
    } catch (err) {
      error = (err as any)?.message ?? 'Failed to duplicate plan'
      pushToast(error, 'error')
    } finally {
      closeDuplicate()
    }
  }

  const requestDeletePlan = (id: string) => {
    confirmDeleteId = id
    deleteStatus = ''
    deleteError = ''
  }

  const deletePlan = async (id: string) => {
    deleteStatus = 'Deleting…'
    deleteError = ''
    try {
      const res = await fetch(`/api/planned-workouts/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.error) throw new Error(data?.error ?? 'Failed to delete plan')
      plans = plans.filter((p) => p.id !== id)
      await loadPlans()
      computeToday()
      deleteStatus = 'Deleted'
      pushToast('Planned workout deleted.', 'success')
      setTimeout(() => (deleteStatus = ''), 1500)
      confirmDeleteId = null
    } catch (err) {
      deleteStatus = ''
      deleteError = (err as any)?.message ?? 'Failed to delete plan'
      pushToast(deleteError, 'error')
    }
  }

  const inviteForId = (id: string) => $shares?.pending?.find((inv) => inv.id === id)

  const acceptInvite = async (id: string) => {
    const invite = inviteForId(id)
    if (!invite) return
    const dateStr =
      inviteDates[id] || (invite.planned_for ? new Date(invite.planned_for).toISOString().slice(0, 10) : '')
    const plannedFor = dateStr ? Date.parse(dateStr) : null
    if (!plannedFor) {
      inviteError = { ...inviteError, [id]: 'Select a valid date.' }
      return
    }
    inviteStatus = { ...inviteStatus, [id]: 'Saving…' }
    inviteError = { ...inviteError, [id]: '' }
    try {
      const res = await fetch(`/api/shared-workouts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept', plannedFor })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to accept')
      await loadPendingCount()
      await loadInvites('incoming', 'pending')
      await loadPlans()
      inviteStatus = { ...inviteStatus, [id]: 'Added to planner.' }
      pushToast('Invite added to planner.', 'success')
      setTimeout(() => {
        inviteStatus = { ...inviteStatus, [id]: '' }
      }, 2000)
    } catch (err) {
      inviteError = { ...inviteError, [id]: (err as any)?.message ?? 'Failed to accept' }
      inviteStatus = { ...inviteStatus, [id]: '' }
      pushToast(inviteError[id] || 'Failed to accept invite', 'error')
    }
  }

  const rejectInvite = async (id: string) => {
    inviteStatus = { ...inviteStatus, [id]: 'Updating…' }
    inviteError = { ...inviteError, [id]: '' }
    try {
      const res = await fetch(`/api/shared-workouts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to reject')
      await loadPendingCount()
      await loadInvites('incoming', 'pending')
      inviteStatus = { ...inviteStatus, [id]: 'Rejected.' }
      pushToast('Invite rejected.', 'success')
      setTimeout(() => {
        inviteStatus = { ...inviteStatus, [id]: '' }
      }, 1500)
    } catch (err) {
      inviteError = { ...inviteError, [id]: (err as any)?.message ?? 'Failed to reject' }
      inviteStatus = { ...inviteStatus, [id]: '' }
      pushToast(inviteError[id] || 'Failed to reject invite', 'error')
    }
  }

  const addTag = () => {
    const t = newTag.trim()
    if (!t) return
    if (editTags.includes(t)) {
      newTag = ''
      return
    }
    editTags = [...editTags, t].slice(0, 8)
    newTag = ''
  }

  const openSettings = () => openSettingsModal()

  const coerceSeconds = (value: any) => {
    const numeric = Number(value)
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0
  }

  const updatePlanSource = (mutate: (plan: any) => void) => {
    const parsed = tryParsePlan(editYaml)
    if (parsed.error || !parsed.plan) return
    const nextPlan = JSON.parse(JSON.stringify(parsed.plan))
    mutate(nextPlan)
    editYaml = YAML.stringify(nextPlan)
  }

  const openPlanEditor = () => {
    planEditorOpen = true
  }

  const setInviteDate = (id: string, value: string) => {
    inviteDates = { ...inviteDates, [id]: value }
  }

  const defaultInviteDate = (invite: any) =>
    invite?.planned_for ? new Date(invite.planned_for).toISOString().slice(0, 10) : ''

  const closePlanEditor = () => {
    planEditorOpen = false
  }

  const handlePlanSave = (event: CustomEvent) => {
    const values = (event?.detail as any)?.values ?? {}
    updatePlanSource((plan) => {
      const nextTitle = values.title?.trim()
      plan.title = nextTitle || plan.title || 'Planned session'
      const nextDescription = values.description?.trim?.() ?? ''
      if (nextDescription) {
        plan.description = nextDescription
      } else {
        delete plan.description
      }
      plan.preStartSeconds = coerceSeconds(values.preStartSeconds ?? plan.preStartSeconds)
      const nextLabel = values.preStartLabel?.trim?.() ?? ''
      if (nextLabel) {
        plan.preStartLabel = nextLabel
      } else {
        delete plan.preStartLabel
      }
    })
    closePlanEditor()
  }

  const openRoundEditor = (round: any, index: number) => {
    roundEditorData = round
    roundEditorIndex = index
    roundEditorOpen = true
  }

  const closeRoundEditor = () => {
    roundEditorOpen = false
    roundEditorData = null
    roundEditorIndex = null
  }

  const handleRoundSave = (event: CustomEvent) => {
    const detail = (event?.detail as any) ?? {}
    const roundIndex = Number(detail.roundIndex ?? roundEditorIndex)
    if (!Number.isInteger(roundIndex) || roundIndex < 0) {
      closeRoundEditor()
      return
    }
    const values = detail.values ?? {}
    updatePlanSource((plan) => {
      if (!Array.isArray(plan.rounds) || !plan.rounds[roundIndex]) return
      const target = plan.rounds[roundIndex]
      target.label = values.label?.trim?.() || target.label || `Round ${roundIndex + 1}`
      target.repetitions = coerceRepetitions(values.repetitions ?? target.repetitions)
      target.restAfterSeconds = coerceSeconds(values.restAfterSeconds ?? target.restAfterSeconds)
      if (
        values.transitionAfterSeconds === undefined ||
        values.transitionAfterSeconds === null ||
        values.transitionAfterSeconds === ''
      ) {
        delete target.transitionAfterSeconds
      } else {
        target.transitionAfterSeconds = coerceSeconds(values.transitionAfterSeconds)
      }
    })
    closeRoundEditor()
  }

  const openSetEditor = (roundIndex: number, setIndex: number) => {
    setEditorRoundIndex = roundIndex
    setEditorSetIndex = setIndex
    const parsed = tryParsePlan(editYaml)
    const setData =
      parsed.plan?.rounds?.[roundIndex]?.sets && parsed.plan.rounds[roundIndex].sets[setIndex]
    setEditorData = setData ?? null
    setEditorOpen = true
  }

  const closeSetEditor = () => {
    setEditorOpen = false
    setEditorRoundIndex = null
    setEditorSetIndex = null
    setEditorData = null
  }

  const handleSetSave = (event: CustomEvent) => {
    const detail = (event?.detail as any) ?? {}
    const roundIndex = Number(detail.roundIndex ?? setEditorRoundIndex)
    const setIndex = Number(detail.setIndex ?? setEditorSetIndex)
    if (!Number.isInteger(roundIndex) || roundIndex < 0 || !Number.isInteger(setIndex) || setIndex < 0) {
      closeSetEditor()
      return
    }
    const values = detail.values ?? {}
    updatePlanSource((plan) => {
      if (!Array.isArray(plan.rounds) || !plan.rounds[roundIndex]) return
      const round = plan.rounds[roundIndex]
      if (!Array.isArray(round.sets) || !round.sets[setIndex]) return
      const target = round.sets[setIndex]
      target.label = values.label?.trim?.() || target.label || `Set ${setIndex + 1}`
      target.workSeconds = coerceSeconds(values.workSeconds ?? target.workSeconds)
      target.restSeconds = coerceSeconds(values.restSeconds ?? target.restSeconds)
      target.transitionSeconds = coerceSeconds(values.transitionSeconds ?? target.transitionSeconds)
      target.repetitions = coerceRepetitions(values.repetitions ?? target.repetitions)
      const rpm = values.targetRpm
      if (rpm === null || rpm === undefined || rpm === '') {
        delete target.targetRpm
      } else {
        target.targetRpm = Math.max(Number(rpm) || 0, 0)
      }
    })
    closeSetEditor()
  }

  const coerceRepetitions = (value: any) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return 1
    return Math.max(1, Math.round(numeric))
  }

  const normalizeRepCounterMode = (value: any) => {
    if (typeof value !== 'string') return 'disabled'
    const normalized = value.trim().toLowerCase()
    if (normalized === 'swing' || normalized === 'lockout') return normalized
    if (normalized === 'disabled') return 'disabled'
    return 'disabled'
  }

  const normalizeRepCounterScope = (value: any) => (value === 'all' ? 'all' : 'work')

  const normalizeBoolean = (value: any, defaultValue: boolean) =>
    value === true ? true : value === false ? false : defaultValue

  const formatDuration = (seconds?: number | null) => {
    const safe = Number(seconds)
    if (!Number.isFinite(safe) || safe <= 0) return '0s'
    const mins = Math.floor(safe / 60)
    const secs = Math.round(safe % 60)
    if (mins <= 0) return `${secs}s`
    if (secs === 0) return `${mins}m`
    return `${mins}m ${secs}s`
  }

  const normalizePlan = (candidate: any) => {
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

    const rounds = candidate.rounds.map((round: any, roundIndex: number) => {
      if (!round || typeof round !== 'object') {
        throw new Error(`Round ${roundIndex + 1} must be an object`)
      }
      if (!Array.isArray(round.sets) || round.sets.length === 0) {
        throw new Error(
          `Round "${round.label ?? `#${roundIndex + 1}`}" requires a sets array`
        )
      }

      const roundId = round.id ?? `round-${roundIndex + 1}`
      const transitionAfterSecondsRaw = round.transitionAfterSeconds
      const transitionAfterSeconds =
        transitionAfterSecondsRaw === undefined ||
        transitionAfterSecondsRaw === null ||
        transitionAfterSecondsRaw === ''
          ? undefined
          : coerceSeconds(transitionAfterSecondsRaw)

      return {
        id: roundId,
        label: typeof round.label === 'string' ? round.label : `Round ${roundIndex + 1}`,
        repetitions: coerceRepetitions(round.repetitions ?? 1),
        restAfterSeconds: coerceSeconds(round.restAfterSeconds ?? 0),
        ...(transitionAfterSeconds !== undefined ? { transitionAfterSeconds } : {}),
        sets: round.sets.map((set: any, setIndex: number) => {
          if (!set || typeof set !== 'object') {
            throw new Error(`Set ${setIndex + 1} in round ${roundIndex + 1} must be an object`)
          }
          const workSeconds = coerceSeconds(set.workSeconds ?? set.work)
          const restSeconds = coerceSeconds(set.restSeconds ?? set.rest ?? 0)
          const repetitions = coerceRepetitions(set.repetitions ?? 1)
          const transitionSeconds = coerceSeconds(set.transitionSeconds ?? set.transition ?? 0)
          return {
            id: set.id ?? `set-${setIndex + 1}`,
            label: typeof set.label === 'string' ? set.label : `Set ${setIndex + 1}`,
            workSeconds,
            restSeconds,
            repetitions,
            transitionSeconds,
            targetRpm: Number.isFinite(Number(set.targetRpm)) ? Number(set.targetRpm) : null,
            announcements: Array.isArray(set.announcements) ? set.announcements : [],
            restAnnouncements: Array.isArray(set.restAnnouncements) ? set.restAnnouncements : [],
            repCounterMode: normalizeRepCounterMode(set.repCounterMode ?? defaultRepCounterMode),
            enableModeChanging: normalizeBoolean(set.enableModeChanging, enableModeChanging)
          }
        })
      }
    })

    return {
      ...candidate,
      preStartSeconds,
      preStartLabel,
      description,
      rounds,
      defaultRepCounterMode,
      enableRepCounter,
      enableModeChanging
    }
  }

  const tryParsePlan = (source: string) => {
    if (!source) return { plan: null, error: new Error('Empty source') }
    try {
      const raw = YAML.parse(source)
      const plan = normalizePlan(raw)
      return { plan, error: null }
    } catch (err) {
      return { plan: null, error: err as Error }
    }
  }


  const extractYaml = (content: string) => {
    if (!content) return ''
    const fenceMatch = content.match(/```(?:yaml)?\s*([\s\S]*?)```/i)
    if (fenceMatch) return fenceMatch[1].trim()
    return content.trim()
  }

  const applyYamlSource = (yaml: string) => {
    const result = tryParsePlan(yaml)
    if (result.error || !result.plan) {
      throw result.error ?? new Error('Invalid workout YAML')
    }
    editYaml = yaml
    previewResult = result
    previewTotals = computeTotals(result.plan)
  }

  $: previewResult = tryParsePlan(editYaml)
  $: previewTotals = previewResult.plan ? computeTotals(previewResult.plan) : null
  $: timelinePreview = previewResult.plan ? buildTimeline(previewResult.plan) : []

  const timelineForYaml = (yaml?: string | null) => {
    if (!yaml) return []
    try {
      const parsed = normalizePlan(YAML.parse(yaml))
      return buildTimeline(parsed)
    } catch {
      return []
    }
  }

  const planFromYaml = (yaml?: string | null) => {
    if (!yaml) return null
    try {
      return normalizePlan(YAML.parse(yaml))
    } catch {
      return null
    }
  }

  const totalsForYaml = (yaml?: string | null) => {
    if (!yaml) return null
    try {
      const plan = normalizePlan(YAML.parse(yaml))
      return computeTotals(plan)
    } catch {
      return null
    }
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
      editTitle = previewResult.plan?.title ?? editTitle
      aiStatus = 'Workout generated. Review and adjust as needed.'
      aiError = ''
      pushToast('Workout generated from AI.', 'success')
    } catch (error) {
      console.warn('OpenAI workout generation error', error)
      aiError = (error as any)?.message ?? 'Failed to generate workout.'
      aiStatus = ''
      pushToast(aiError || 'Failed to generate workout.', 'error')
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
      return
    }

    aiEditError = ''
    aiEditStatus = 'Contacting OpenAI…'
    isAiEditing = true

    const userContent = `Here is the current workout YAML:\n${editYaml}\n\nApply these changes:\n${instructions}\n\nKeep IDs stable when possible and return YAML only.`

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
      pushToast('Workout updated.', 'success')
    } catch (error) {
      console.warn('OpenAI workout edit error', error)
      aiEditError = (error as any)?.message ?? 'Failed to modify workout.'
      aiEditStatus = ''
      pushToast(aiEditError || 'Failed to modify workout.', 'error')
    } finally {
      isAiEditing = false
    }
  }

  const dayPlans = (key: string) => plans.filter((p) => dayKey(p.planned_for) === key)
  $: monthItems = plans.filter((p) => {
    const d = new Date(p.planned_for)
    const m = new Date(calendarMonth)
    return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth()
  })
  $: selectedDayPlans = selectedDateKey ? plans.filter((p) => dayKey(p.planned_for) === selectedDateKey) : []
  $: mobileWeekStart = selectedDateKey ? startOfWeek(Date.parse(selectedDateKey)) : mobileWeekStart
  $: mobileWeekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mobileWeekStart)
    d.setDate(d.getDate() + i)
    const ts = d.getTime()
    return { key: dayKey(ts), label: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) }
  })

  const openTimer = (plan: Planned, mode: 'timer' | 'big') => {
    const id = plan.id
    if (!id) return
    const base = mode === 'big' ? '/big-picture' : '/timer'
    window.location.href = `${base}?planned=${encodeURIComponent(id)}`
  }

  $: if ($shares?.pending?.length) {
    const next = { ...inviteDates }
    let changed = false
    for (const inv of $shares.pending) {
      if (!next[inv.id]) {
        next[inv.id] = defaultInviteDate(inv)
        changed = true
      }
    }
    if (changed) inviteDates = next
  }

  const shiftWeek = (delta: number) => {
    const next = new Date(mobileWeekStart)
    next.setDate(next.getDate() + delta * 7)
    mobileWeekStart = startOfWeek(next.getTime())
    const key = dayKey(mobileWeekStart)
    selectedDateKey = key
    calendarMonth = new Date(next.getFullYear(), next.getMonth(), 1).getTime()
  }

  onMount(() => {
    loadPlans()
    libraryWorkouts = buildLibraryWorkouts()
    loadPendingCount()
    loadInvites('incoming', 'pending')
  })

  $: confirmDeletePlan = confirmDeleteId ? plans.find((p) => p.id === confirmDeleteId) ?? null : null

  $: if (browser && selectedDateKey && dayDetailEl && selectedDateKey !== lastScrolledDay) {
    lastScrolledDay = selectedDateKey
    requestAnimationFrame(() =>
      dayDetailEl?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
    )
  }

  const setHoverPlan = (
    plan: Planned | null,
    alignX: 'left' | 'right' = 'right',
    anchorEl?: HTMLElement | null
  ) => {
    if (!plan) {
      hoverPlan = null
      hoverSummary = []
      hoverTotals = null
      return
    }
    hoverAlignX = alignX
    if (anchorEl && calendarShellEl) {
      const shellRect = calendarShellEl.getBoundingClientRect()
      const rect = anchorEl.getBoundingClientRect()
      const cardWidth = 360
      const cardHeight = browser
        ? Math.min(Math.max(window.innerHeight * 0.6, 320), 720)
        : 420
      const gutter = 12
      const maxLeft = Math.max(gutter, shellRect.width - cardWidth - gutter)
      const spaceRight = shellRect.right - rect.right
      const spaceLeft = rect.left - shellRect.left
      const placeRight = spaceRight >= spaceLeft
      hoverAlignX = placeRight ? 'right' : 'left'
      const desiredLeft =
        hoverAlignX === 'right'
          ? rect.right - shellRect.left + gutter
          : rect.left - shellRect.left - cardWidth - gutter
      hoverLeft = Math.min(Math.max(desiredLeft, gutter), maxLeft)

      const spaceBelow = shellRect.bottom - rect.bottom
      const spaceAbove = rect.top - shellRect.top
      const placeBelow = spaceBelow >= cardHeight || spaceBelow >= spaceAbove
      hoverAlignY = placeBelow ? 'below' : 'above'
      const desiredTop =
        hoverAlignY === 'below'
          ? rect.bottom - shellRect.top + gutter
          : rect.top - shellRect.top - cardHeight - gutter
      const maxTop = Math.max(gutter, shellRect.height - cardHeight - gutter)
      hoverTop = Math.min(Math.max(desiredTop, gutter), maxTop)
    }
    hoverPlan = plan
    const parsed = planFromYaml(plan.yaml_source)
    hoverTotals = parsed ? computeTotals(parsed) : totalsForYaml(plan.yaml_source)
    hoverSummary = parsed ? buildPlannedSummary(parsed) : []
  }

</script>

<div class="planner-page">
  <header>
    <h1>Planner</h1>
  </header>

  {#if loading}
    <p>Loading…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else}
    <section class="today-block">
      <div class="today-head">
        <div>
          <p class="eyebrow">Today</p>
          <h3>{new Date().toDateString()}</h3>
        </div>
      </div>
      {#if todayPlan}
        <div class="today-card">
          <div>
            <h4>{todayPlan.title || 'Planned workout'}</h4>
            {#if todayPlan.tags?.length}
              <div class="tag-row">
                {#each todayPlan.tags as tag}
                  <span class="tag-chip">{tag}</span>
                {/each}
              </div>
            {/if}
            {#if todayPlan.notes}<p class="muted small">{todayPlan.notes}</p>{/if}
          </div>
          <div class="today-actions">
            <button class="primary" on:click={() => openTimer(todayPlan!, 'timer')}>Start in Timer</button>
            <button class="ghost" on:click={() => openTimer(todayPlan!, 'big')}>Start in Big Picture</button>
            <button class="ghost" on:click={() => openEdit(todayPlan!)}>Edit</button>
            <button class="ghost" on:click={() => openShare(todayPlan!)}>Share</button>
            <button class="text-button" on:click={() => openDuplicate(todayPlan!)}>Duplicate</button>
            <button class="ghost danger destructive" on:click={() => requestDeletePlan(todayPlan!.id)}>Delete</button>
          </div>
        </div>
      {:else}
        <p class="muted small">No plan for today.</p>
      {/if}
    </section>

    <section class="calendar-shell" bind:this={calendarShellEl} role="presentation" on:mouseleave={() => setHoverPlan(null)}>
      <div class="week-head mobile-only">
        <div class="month-nav">
          <button class="ghost" on:click={() => shiftWeek(-1)}>←</button>
          <strong>{weekLabel(mobileWeekStart)}</strong>
          <button class="ghost" on:click={() => shiftWeek(1)}>→</button>
        </div>
        <div class="inline-actions">
          <button class="primary" on:click={() => openNew(selectedDateKey || dayKey(mobileWeekStart))}>
            Add workout
          </button>
        </div>
      </div>
      <div class="week-list mobile-only">
        {#each mobileWeekDays as dayInfo}
          {@const itemsForDay = dayPlans(dayInfo.key)}
          <button
            type="button"
            class="week-row"
            class:active={selectedDateKey === dayInfo.key}
            on:click={() => (selectedDateKey = dayInfo.key)}
            on:mouseenter={() => setHoverPlan(itemsForDay[0] ?? null)}
          >
            <div class="week-row__label">
              <span class="week-row__day">{dayInfo.label}</span>
              {#if itemsForDay.length}
                <span class="week-row__count">{itemsForDay.length}</span>
              {/if}
            </div>
            {#if itemsForDay.length}
              <div class="week-row__items">
                {#each itemsForDay as it}
                  <div class="week-row__item">
                    <span class="dot"></span>
                    <span class="week-row__title">{it.title || 'Workout'}</span>
                  </div>
                {/each}
              </div>
            {:else}
              <span class="muted tiny">No workouts</span>
            {/if}
          </button>
        {/each}
      </div>

      <div class="calendar-head">
        <div class="month-nav">
          <button class="ghost" on:click={() => moveMonth(-1)}>←</button>
          <strong>{monthLabel(calendarMonth)}</strong>
          <button class="ghost" on:click={() => moveMonth(1)}>→</button>
        </div>
        <div class="inline-actions">
          <button
            class="primary"
            on:click={() => openNew(selectedDateKey || dayKey(calendarMonth))}
          >
            Add workout
          </button>
        </div>
      </div>
      <div class="calendar-grid">
        <div class="dow">Mon</div>
        <div class="dow">Tue</div>
        <div class="dow">Wed</div>
        <div class="dow">Thu</div>
        <div class="dow">Fri</div>
        <div class="dow">Sat</div>
        <div class="dow">Sun</div>
        {#each Array(startOfMonthWeekday(calendarMonth)).fill(0) as _}
          <div class="day empty"></div>
        {/each}
        {#each Array(daysInMonth(calendarMonth)).fill(0).map((_, i) => i + 1) as day}
          {@const key = dayKey(new Date(new Date(calendarMonth).getFullYear(), new Date(calendarMonth).getMonth(), day).getTime())}
          {@const itemsForDay = dayPlans(key)}
          {@const colIndex = (startOfMonthWeekday(calendarMonth) + day - 1) % 7}
          <button
            type="button"
            class="day"
            class:active={selectedDateKey === key}
            on:click={() => (selectedDateKey = key)}
            on:mouseenter={(event) =>
              setHoverPlan(itemsForDay[0] ?? null, colIndex >= 4 ? 'right' : 'left', event.currentTarget as HTMLElement)
            }
            aria-pressed={selectedDateKey === key}
          >
            <div class="day-top">
              <span class="day-num">{day}</span>
              {#if itemsForDay.length}
                <span class="day-count">{itemsForDay.length}</span>
              {/if}
            </div>
            {#if itemsForDay.length}
              <div class="day-list">
                {#each itemsForDay as it}
                  {@const hrTag = it.tags?.includes('hr') || false}
                  <div
                    class="day-row"
                    title={`${it.title || 'Workout'}`}
                    on:mouseenter={(event) =>
                      setHoverPlan(it, colIndex >= 4 ? 'right' : 'left', event.currentTarget as HTMLElement)
                    }
                    role="presentation"
                  >
                    <span class="dot"></span>
                    <div class="day-row-body">
                      <span class="day-row-title">{it.title || 'Workout'}</span>
                      <div class="day-row-meta">
                        {#if hrTag}<span class="day-row-hr">HR</span>{/if}
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </button>
        {/each}
      </div>
      {#if hoverPlan}
        <div
          class="hover-card"
          class:visible={!!hoverPlan}
          class:left={hoverAlignX === 'left'}
          class:right={hoverAlignX === 'right'}
          class:above={hoverAlignY === 'above'}
          class:below={hoverAlignY === 'below'}
          style={`left:${hoverLeft}px; top:${hoverTop}px;`}
        >
          <div class="hover-head">
            <div>
              <p class="eyebrow">Preview</p>
              <h4>{hoverPlan.title || 'Workout'}</h4>
              <p class="muted tiny">
                {new Date(hoverPlan.planned_for).toLocaleDateString()}
                {#if hoverTotals}
                  · {formatDuration(hoverTotals.total)}
                {/if}
              </p>
              {#if hoverPlan.tags?.length}
                <div class="tag-row">
                  {#each hoverPlan.tags.slice(0, 3) as tag}
                    <span class="tag-chip">{tag}</span>
                  {/each}
                  {#if hoverPlan.tags.length > 3}
                    <span class="tag-chip muted">+{hoverPlan.tags.length - 3}</span>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
          {#if hoverSummary.length}
            <div class="compact-summary rich planner-summary hover-summary">
              {#each hoverSummary as block}
                <div class="summary-block">
                  <div class="summary-title">
                    {#if block.count && block.count > 1}
                      <span class="chip-pill pill-count">{block.count} ×</span>
                    {/if}
                    {block.title}
                  </div>
                  {#if block.items?.length}
                    <div class="summary-items">
                      {#each block.items as it}
                        <span class="summary-chip fancy">
                          {#if it.label}<span class="chip-label">{it.label}</span>{/if}
                          {#if it.count && it.count > 1}
                            <span class="chip-pill pill-count">{it.count} ×</span>
                          {/if}
                          {#if it.work}
                            <span class="chip-pill">
                              <span>{it.work}</span>
                            </span>
                          {/if}
                          {#if it.on || it.off}
                            <span class="chip-pill pill-rest">
                              {#if it.on}<span class="on">{it.on}</span>{/if}
                              {#if it.off}
                                <span class="divider">/</span>
                                <span class="off">{it.off}</span>
                              {/if}
                            </span>
                          {/if}
                          {#if !it.label && !it.work && !it.on && !it.off}
                            <span>{it.baseRaw}</span>
                          {/if}
                        </span>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {:else if hoverTotals}
            <p class="muted tiny">
              Total {formatDuration(hoverTotals.total)} · Work {formatDuration(hoverTotals.work)} · Rest {formatDuration(hoverTotals.rest)}
            </p>
          {/if}
        </div>
      {/if}
    </section>

    <section class="shares-block">
      <div class="shares-head">
        <div>
          <p class="eyebrow">Incoming shares</p>
          <h3>Shared with you</h3>
        </div>
        <p class="muted small">Accept to add to your planner.</p>
      </div>
      {#if !$shares.loaded && !$shares.pending.length}
        <p class="muted small">Loading shared workouts…</p>
      {:else if $shares.pending.length === 0}
        <p class="muted small">No pending shared workouts.</p>
      {:else}
        <div class="list">
          {#each $shares.pending as invite}
            <article class="card">
              <div class="card-header">
                <div>
                  <p class="muted small">From {invite.sender_username ?? 'someone'}</p>
                  <h4>{invite.title || 'Workout'}</h4>
                  {#if invite.message}
                    <p class="muted small">“{invite.message}”</p>
                  {/if}
                  {#if invite.tags?.length}
                    <div class="tag-row">
                      {#each invite.tags as tag}
                        <span class="tag-chip">{tag}</span>
                      {/each}
                    </div>
                  {/if}
                  {#if totalsForYaml(invite.yaml_source)}
                    {@const totals = totalsForYaml(invite.yaml_source)!}
                    <p class="muted small">
                      Total {formatDuration(totals.total)} · Work {formatDuration(totals.work)} · Rest {formatDuration(totals.rest)}
                    </p>
                  {/if}
                </div>
                <div class="actions">
                  <input
                    type="date"
                    value={inviteDates[invite.id] || defaultInviteDate(invite)}
                    on:input={(e) => setInviteDate(invite.id, (e.target as HTMLInputElement).value)}
                  />
                  <button class="primary" on:click={() => acceptInvite(invite.id)}>
                    Accept
                  </button>
                  <button class="ghost danger" on:click={() => rejectInvite(invite.id)}>Reject</button>
                </div>
              </div>
              {#if timelineForYaml(invite.yaml_source).length}
                {@const parsedPlan = planFromYaml(invite.yaml_source)}
                {#if parsedPlan}
                  {@const summaryBlocks = buildPlannedSummary(parsedPlan)}
                  {#if summaryBlocks.length}
                    <div class="compact-summary rich planner-summary">
                      {#each summaryBlocks as block}
                        <div class="summary-block">
                          <div class="summary-title">
                            {#if block.count && block.count > 1}
                              <span class="chip-pill pill-count">{block.count} ×</span>
                            {/if}
                            {block.title}
                          </div>
                          {#if block.items?.length}
                            <div class="summary-items">
                              {#each block.items as it}
                                <span class="summary-chip fancy">
                                  {#if it.label}<span class="chip-label">{it.label}</span>{/if}
                                  <span class="chip-pill pill-count">{it.count ?? 1} ×</span>
                                  {#if it.work}
                                    <span class="chip-pill">
                                      <span>{it.work}</span>
                                    </span>
                                  {/if}
                                  {#if it.on || it.off}
                                    <span class="chip-pill pill-rest">
                                      {#if it.on}<span class="on">{it.on}</span>{/if}
                                      {#if it.off}
                                        <span class="divider">/</span>
                                        <span class="off">{it.off}</span>
                                      {/if}
                                    </span>
                                  {/if}
                                  {#if !it.label && !it.work && !it.on && !it.off}
                                    <span>{it.baseRaw}</span>
                                  {/if}
                                </span>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}
                {/if}
              {/if}
              {#if inviteStatus[invite.id]}
                <p class="status">{inviteStatus[invite.id]}</p>
              {/if}
              {#if inviteError[invite.id]}
                <p class="error">{inviteError[invite.id]}</p>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section class="day-detail" bind:this={dayDetailEl}>
      <div class="day-head">
        <h3>{selectedDateKey || 'Select a day'}</h3>
        {#if selectedDateKey}
          <button class="ghost" on:click={() => openNew(selectedDateKey)}>Add workout</button>
        {/if}
      </div>
      {#if selectedDayPlans.length === 0}
        <p class="muted small">No planned workouts for this day.</p>
      {:else}
        <div class="list">
          {#each selectedDayPlans as item (item.id)}
            <article class="card">
              <div class="card-header">
                <div>
                  <h4>{item.title || 'Workout'}</h4>
                  {#if totalsForYaml(item.yaml_source)}
                    {@const totals = totalsForYaml(item.yaml_source)!}
                    <p class="muted small">
                      Total {formatDuration(totals.total)} · Work {formatDuration(totals.work)} · Rest {formatDuration(totals.rest)}
                    </p>
                  {:else}
                    <p class="muted small">{new Date(item.planned_for).toLocaleDateString()}</p>
                  {/if}
                  {#if item.tags?.length}
                    <div class="tag-row">
                      {#each item.tags as tag}
                        <span class="tag-chip">{tag}</span>
                      {/each}
                    </div>
                  {/if}
                  {#if item.notes}<p class="muted small">{item.notes}</p>{/if}
                </div>
                <div class="actions">
                  <button class="primary" on:click={() => openTimer(item, 'timer')}>Timer</button>
                  <button class="ghost" on:click={() => openTimer(item, 'big')}>Big Picture</button>
                  <button class="ghost" on:click={() => openEdit(item)}>Edit</button>
                  <button class="ghost" on:click={() => openShare(item)}>Share</button>
                  <button class="text-button" on:click={() => openDuplicate(item)}>Duplicate</button>
                  <button class="ghost danger destructive" on:click={() => requestDeletePlan(item.id)}>Delete</button>
                </div>
              </div>
              {#if timelineForYaml(item.yaml_source).length}
                {@const parsedPlan = planFromYaml(item.yaml_source)}
                {#if parsedPlan}
                  {@const summaryBlocks = buildPlannedSummary(parsedPlan)}
                  {#if summaryBlocks.length}
                    <div class="compact-summary rich planner-summary">
                      {#each summaryBlocks as block}
                        <div class="summary-block">
                          <div class="summary-title">
                            {#if block.count && block.count > 1}
                              <span class="chip-pill pill-count">{block.count} ×</span>
                            {/if}
                            {block.title}
                          </div>
                          {#if block.items?.length}
                            <div class="summary-items">
                              {#each block.items as it}
                                <span class="summary-chip fancy">
                                  {#if it.label}<span class="chip-label">{it.label}</span>{/if}
                                  {#if it.count && it.count > 1}
                                    <span class="chip-pill pill-count">{it.count} ×</span>
                                  {/if}
                                  {#if it.work}
                                    <span class="chip-pill">
                                      <span>{it.work}</span>
                                    </span>
                                  {/if}
                                  {#if it.on || it.off}
                                    <span class="chip-pill pill-rest">
                                      {#if it.on}<span class="on">{it.on}</span>{/if}
                                      {#if it.off}
                                        <span class="divider">/</span>
                                        <span class="off">{it.off}</span>
                                      {/if}
                                    </span>
                                  {/if}
                                  {#if !it.label && !it.work && !it.on && !it.off}
                                    {#if it.count && it.count > 1}
                                      <span class="chip-pill"><span class="count">{it.count} ×</span></span>
                                    {/if}
                                    <span>{it.baseRaw}</span>
                                  {/if}
                                </span>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}
                {/if}
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

{#if duplicateOpen}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="0"
    aria-label="Close modal"
    on:click={closeDuplicate}
    on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && closeDuplicate()}
  ></div>
  <div class="edit-modal" use:modal={{ onClose: closeDuplicate }}>
    <header>
      <h3>Duplicate workout</h3>
      <button class="ghost" on:click={closeDuplicate} aria-label="Close">✕</button>
    </header>
    <div class="form">
      <label>
        <span class="muted small">Target date</span>
        <input type="date" bind:value={duplicateDate} />
      </label>
      <label class="inline-checkbox">
        <input type="checkbox" bind:checked={duplicateCopyMeta} />
        <span class="muted small">Copy notes and tags</span>
      </label>
    </div>
    <div class="actions">
      <button class="primary" on:click={handleDuplicateSave}>Duplicate</button>
      <button class="ghost" on:click={closeDuplicate}>Cancel</button>
    </div>
  </div>
{/if}

{#if confirmDeleteId}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="0"
    aria-label="Close modal"
    on:click={closeDeleteConfirm}
    on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && closeDeleteConfirm()}
  ></div>
  <div class="confirm-modal" use:modal={{ onClose: closeDeleteConfirm }}>
    <p>Delete this planned workout?</p>
    <p class="muted small">{confirmDeletePlan?.title || 'Planned workout'}</p>
    {#if deleteError}<p class="error small">{deleteError}</p>{/if}
    <div class="actions">
      <button
        class="ghost"
        on:click={closeDeleteConfirm}
      >
        Cancel
      </button>
      <button
        class="danger"
        disabled={deleteStatus === 'Deleting…'}
        on:click={() => confirmDeleteId && deletePlan(confirmDeleteId)}
      >
        {deleteStatus || 'Delete'}
      </button>
    </div>
  </div>
{/if}

{#if shareModalOpen && shareTarget}
  <SharePlanModal
    open={shareModalOpen}
    title={shareTarget.title || 'Planned workout'}
    defaultDate={shareDefaultDate}
    plannedId={shareTarget.id}
    on:shared={() => {
      loadPendingCount()
      loadInvites('incoming', 'pending')
      pushToast('Workout shared.', 'success')
      closeShare()
    }}
    on:error={(e) => pushToast(e.detail?.message || 'Failed to share workout', 'error')}
    on:close={closeShare}
  />
{/if}

{#if editOpen}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="0"
    aria-label="Close modal"
    on:click={closeEdit}
    on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && closeEdit()}
  ></div>
  <div class="edit-modal" use:modal={{ onClose: closeEdit }}>
      <header>
        <h3>{editId ? 'Edit planned workout' : 'Add planned workout'}</h3>
        <button class="ghost" on:click={closeEdit} aria-label="Close">✕</button>
      </header>
      <div class="form">
        <label>
          <span class="muted small">Title</span>
          <input type="text" bind:value={editTitle} placeholder="Planned workout" />
        </label>
        <label>
          <span class="muted small">Date</span>
          <input type="date" bind:value={editDate} />
        </label>
        <label>
          <span class="muted small">Tags</span>
          <div class="tag-editor">
            {#each editTags as tag}
              <span class="tag-chip">
                {tag}
                <button class="ghost icon-btn" aria-label="Remove tag" on:click={() => (editTags = editTags.filter((t) => t !== tag))}>×</button>
              </span>
            {/each}
            <div class="tag-input-wrap">
              <input type="text" placeholder="Add tag" bind:value={newTag} />
              <button class="ghost small" type="button" on:click={addTag}>Add</button>
            </div>
          </div>
        </label>
        <label>
          <span class="muted small">Notes</span>
          <input type="text" bind:value={editNotes} placeholder="Optional notes" />
        </label>
        <YamlConfigEditor
          title="Configuration (YAML)"
          bind:value={editYaml}
          parseError={previewResult.error}
          hasPendingChanges={false}
          previewTotals={previewTotals}
          showActions={false}
          showShare={false}
          showNameInput={false}
          on:valueChange={(e) => (editYaml = e.detail)}
          on:openHelp={() => (showYamlHelp = true)}
        />
        <button class="ghost small" type="button" on:click={() => (libraryModalOpen = true)}>
          Load from library
        </button>
        <LibraryModal
          open={libraryModalOpen}
          workouts={libraryWorkouts}
          on:close={() => (libraryModalOpen = false)}
          on:select={(e) => selectTemplate(e.detail?.workout)}
        />
        <AiAssistantPanel
          bind:prompt={aiPrompt}
          bind:editInstructions={aiEditInstructions}
          isGenerating={isGenerating}
          status={aiStatus}
          error={aiError}
          isEditing={isAiEditing}
          editStatus={aiEditStatus}
          editError={aiEditError}
          on:generate={() => generateWorkoutFromAi()}
          on:modify={() => modifyWorkoutWithAi()}
          on:openSettings={openSettings}
        />

        {#if timelinePreview.length}
          <TimelineView phases={timelinePreview} activeIndex={-1} title="Timeline preview" />
          <SessionOverview
            totals={previewTotals ?? { work: 0, rest: 0, total: 0 }}
            roundCount={previewResult.plan?.rounds?.length ?? 0}
          />
          <RoundsSetsView
            plan={previewResult.plan}
            timeline={timelinePreview}
            showEditButtons={true}
            headerActionLabel="Edit session info"
            on:editPlan={openPlanEditor}
            on:editRound={(e) => openRoundEditor(e.detail.round, e.detail.index)}
            on:editSet={(e) => openSetEditor(e.detail.roundIndex, e.detail.setIndex)}
          />
        {/if}
      </div>
      <div class="actions">
        <button class="primary" on:click={savePlan}>Save</button>
        <button class="ghost" on:click={closeEdit}>Cancel</button>
      </div>
  </div>
{/if}

<YamlHelpModal open={showYamlHelp} on:close={() => (showYamlHelp = false)} />
<PlanEditorModal
  open={planEditorOpen}
  title={previewResult.plan?.title}
  description={previewResult.plan?.description}
  preStartSeconds={previewResult.plan?.preStartSeconds}
  preStartLabel={previewResult.plan?.preStartLabel}
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
</div>

<style>
  .planner-page {
    max-width: 1300px;
    width: min(1300px, 100%);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .today-block,
  .calendar-shell,
  .day-detail {
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 1rem;
    background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
  }
  .today-head,
  .day-head,
  .calendar-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }
  .today-card {
    margin-top: 0.5rem;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.5rem;
  }
  .today-actions {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
  }
  .today-actions .destructive {
    margin-left: auto;
  }
  .calendar-shell {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    position: relative;
  }
  .calendar-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 0.45rem;
    background: color-mix(in srgb, var(--color-surface-1) 60%, transparent);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 1rem;
  }
  .dow {
    text-align: center;
    font-size: 0.9rem;
    color: var(--color-text-muted);
  }
  .day {
    min-height: 90px;
    border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
    border-radius: 10px;
    padding: 0.55rem 0.55rem 0.45rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    cursor: pointer;
    background: color-mix(in srgb, var(--color-surface-2) 60%, transparent);
    transition: border-color 120ms ease, background 120ms ease;
  }
  .day:hover {
    border-color: var(--color-border-hover);
  }
  .day.empty {
    background: transparent;
    border: none;
    cursor: default;
  }
  .day.active {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface-2));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
  }
  .hover-card {
    display: none;
  }
  @media (hover: hover) and (min-width: 960px) {
    .hover-card {
      display: block;
      position: absolute;
      top: 0.5rem;
      width: min(360px, 42vw);
      max-width: 440px;
      max-height: min(84vh, 720px);
      overflow: auto;
      background: color-mix(in srgb, var(--color-surface-2) 90%, transparent);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 0.75rem;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
      opacity: 0;
      pointer-events: none;
      transition: opacity 160ms ease, transform 160ms ease;
      transform: translateY(6px);
      z-index: 5;
    }
    .hover-card.left {
      right: auto;
    }
    .hover-card.right {
      left: auto;
    }
    .hover-card.above {
      transform-origin: bottom right;
    }
    .hover-card.below {
      transform-origin: top right;
    }
    .hover-card.visible {
      opacity: 1;
      transform: translateY(0);
    }
    .hover-card .hover-head h4 {
      margin: 0 0 0.15rem;
    }
    .hover-card .tag-row {
      margin-top: 0.25rem;
    }
    .hover-card .hover-summary {
      margin-top: 0.35rem;
    }
  }
  .day:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .day-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .day-num {
    font-weight: 600;
  }
  .day-count {
    font-size: 0.85rem;
    background: color-mix(in srgb, var(--color-accent) 25%, var(--color-surface-1));
    border: 1px solid color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
    color: var(--color-text-primary);
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
  }
  .day-list {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .day-row {
    display: grid;
    grid-template-columns: 8px 1fr;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.15rem;
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-surface-1) 30%, transparent);
    min-width: 0;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-accent);
    opacity: 0.6;
  }
  .day-row-body {
    display: flex;
    flex-direction: column;
    gap: 0.12rem;
    min-width: 0;
  }
  .day-row-title {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-primary);
    font-size: 0.62rem;
    text-align: left;
  }
  .day-row-meta {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.55rem;
    color: var(--color-text-muted);
  }
  .day-row-hr {
    font-size: 0.55rem;
    padding: 0.08rem 0.3rem;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--color-accent) 60%, var(--color-border));
    color: var(--color-accent);
  }
  .day-detail .card {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--color-surface-1) 70%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .actions {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .tag-row {
    display: inline-flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .tag-chip {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 0.2rem 0.55rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: 0.9rem;
  }
  .plan-timeline :global(.phase-queue) {
    width: 100%;
  }
  .inline-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .actions .destructive {
    margin-left: auto;
  }
  .confirm-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 120;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 1rem;
    min-width: 260px;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
  }
  .confirm-modal .actions {
    justify-content: flex-end;
    margin-top: 0.75rem;
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 100;
  }
  .edit-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 110;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 1rem;
    width: min(960px, 95vw);
    max-height: 90vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .edit-modal header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .inline-checkbox {
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
  }
  input {
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.5rem 0.65rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }
  .tag-editor {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .tag-input-wrap {
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }
  :global(.text-button) {
    background: transparent;
    border: none;
    color: var(--color-accent);
    padding: 0.2rem 0.35rem;
    cursor: pointer;
    font-weight: 600;
  }
  :global(.text-button:hover) {
    color: var(--color-accent-hover);
    text-decoration: underline;
  }
  :global(.rounds__header-button) {
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
    color: var(--color-text-primary);
  }
  .mini-rounds {
    margin-top: 0.35rem;
  }
  .mini-rounds__title {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--color-text-primary);
    margin: 0 0 0.35rem;
  }
  .mini-rounds__scroller {
    max-height: 360px;
    overflow-y: auto;
    padding-right: 0.35rem;
  }
  :global(.mini-rounds .rounds__header) {
    display: none;
  }
  :global(.mini-rounds .rounds__list) {
    gap: 0.8rem;
  }
  :global(.mini-rounds .round) {
    padding: 1rem 1.1rem;
    gap: 0.8rem;
  }
  :global(.mini-rounds .round__header h3) {
    font-size: 1.05rem;
  }
  :global(.mini-rounds .round__header p) {
    font-size: 0.85rem;
  }
  :global(.mini-rounds .round__badge) {
    padding: 0.25rem 0.75rem;
    font-size: 0.78rem;
  }
  :global(.mini-rounds .set) {
    padding: 0.85rem 1rem;
    gap: 0.6rem;
  }
  :global(.mini-rounds .set h4) {
    font-size: 0.95rem;
  }
  :global(.mini-rounds .set p) {
    font-size: 0.85rem;
  }
  :global(.mini-rounds .segment-block) {
    padding: 0.55rem 0.65rem;
    font-size: 0.8rem;
  }
  :global(.mini-rounds .round-timeline) {
    padding: 0.6rem 0.75rem;
    gap: 0.7rem;
  }
  :global(.mini-rounds .round-rest-block) {
    padding: 0.6rem 0.7rem;
    font-size: 0.82rem;
  }
  .shares-block {
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 1rem;
    background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .shares-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .shares-block input[type='date'] {
    padding: 0.35rem 0.5rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }
  /* Compact summary chips (reused from history) */
  .compact-summary {
    margin-top: 0.4rem;
    padding: 0.6rem 0.75rem;
    border-radius: 10px;
    background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
    border: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    color: var(--color-text-primary);
    font-size: 0.95rem;
  }
  .compact-summary.rich {
    gap: 0.4rem;
  }
  .summary-block {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .summary-title {
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .summary-items {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .summary-chip {
    padding: 0.25rem 0.5rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface-1) 65%, transparent);
    font-size: 0.9rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  /* base pill style so it can be used outside summary-chip context (e.g., round count) */
  .chip-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
  }
  .summary-chip.fancy .chip-label {
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .summary-chip.fancy .chip-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-surface-2) 85%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
  }
  .summary-chip.fancy .chip-pill.pill-rest {
    background: color-mix(in srgb, var(--color-surface-2) 60%, transparent);
  }
  .summary-chip.fancy .chip-pill .on {
    font-weight: 600;
  }
  .summary-chip.fancy .chip-pill .count {
    font-weight: 700;
  }
  .summary-chip.fancy .chip-pill .off {
    opacity: 0.7;
  }
  .summary-chip.fancy .chip-pill .divider {
    opacity: 0.5;
  }
  .summary-chip.fancy .chip-pill.pill-count,
  .chip-pill.pill-count {
    font-weight: 700;
    background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
  }
  @media (max-width: 720px) {
    .today-head {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.35rem;
    }
    .today-card {
      flex-direction: column;
      align-items: stretch;
      gap: 0.75rem;
    }
    .today-actions {
      justify-content: flex-start;
      gap: 0.4rem;
    }
    .calendar-head {
      flex-wrap: wrap;
      align-items: flex-start;
      gap: 0.4rem;
    }
    .calendar-head .inline-actions {
      width: 100%;
      display: flex;
      justify-content: flex-start;
    }
    .calendar-head .inline-actions button {
      width: 100%;
    }
    .calendar-grid {
      gap: 0.35rem;
    }
    .day {
      padding: 0.45rem 0.45rem 0.4rem;
    }
    .calendar-head,
    .calendar-grid {
      display: none;
    }
    .week-head {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .week-list {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .week-row {
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 0.65rem;
      background: color-mix(in srgb, var(--color-surface-1) 60%, transparent);
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      align-items: flex-start;
      width: 100%;
      text-align: left;
    }
    .week-row.active {
      border-color: var(--color-accent);
      background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-1));
    }
    .week-row__label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      width: 100%;
      justify-content: space-between;
    }
    .week-row__day {
      font-weight: 700;
    }
    .week-row__count {
      background: color-mix(in srgb, var(--color-accent) 25%, var(--color-surface-1));
      border: 1px solid color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
      color: var(--color-text-primary);
      border-radius: 999px;
      padding: 0.1rem 0.5rem;
      font-size: 0.85rem;
    }
    .week-row__items {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      width: 100%;
    }
    .week-row__item {
      display: grid;
      grid-template-columns: 10px 1fr;
      gap: 0.35rem;
      align-items: center;
      width: 100%;
      text-align: left;
    }
    .week-row__title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mobile-only {
      display: block;
    }
  }
  @media (min-width: 721px) {
    .mobile-only {
      display: none;
    }
  }
  button {
    padding: 0.5rem 0.8rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    cursor: pointer;
  }
  button.primary {
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
    color: var(--color-text-inverse);
    border: none;
  }
  button.ghost {
    background: transparent;
  }
  button.danger {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }
  .icon-btn {
    padding: 0 0.35rem;
  }
  .error {
    color: var(--color-danger);
  }
</style>
