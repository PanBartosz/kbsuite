<script lang="ts">
  import { onMount } from 'svelte'
  import YAML from 'yaml'
  import defaultPlanSource from '$lib/timer/config/default-plan.yaml?raw'
  import { buildTimeline } from '$lib/timer/lib/timeline.js'
  import { settings, openSettingsModal } from '$lib/stores/settings'
  import LibraryModal from '$lib/timer/components/LibraryModal.svelte'
  import PhaseQueue from '$lib/timer/components/PhaseQueue.svelte'
  import { libraryTemplates } from '$lib/timer/library/index.js'

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
  let templates: WorkoutTemplate[] = []
  let libraryWorkouts: WorkoutTemplate[] = []
  let libraryModalOpen = false
  let todayPlan: Planned | null = null
  let previewResult: { plan: any | null; error: Error | null } = { plan: null, error: null }
  let previewTotals: { work: number; rest: number; total: number } | null = null
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

  const dayKey = (ts: number) => {
    const d = new Date(ts)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
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

  const templatesLoad = async () => {
    try {
      const res = await fetch('/api/workouts')
      const data = await res.json().catch(() => ({}))
      templates = data?.workouts ?? []
    } catch {
      templates = []
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
      editOpen = false
      computeToday()
    } catch (err) {
      error = (err as any)?.message ?? 'Failed to save plan'
    }
  }

  const deletePlan = async (id: string) => {
    try {
      await fetch(`/api/planned-workouts/${id}`, { method: 'DELETE' })
      plans = plans.filter((p) => p.id !== id)
      computeToday()
    } catch {
      // ignore
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

  const coerceRepetitions = (value: any) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return 1
    return Math.max(1, Math.round(numeric))
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

      return {
        id: roundId,
        label: typeof round.label === 'string' ? round.label : `Round ${roundIndex + 1}`,
        repetitions: coerceRepetitions(round.repetitions ?? 1),
        restAfterSeconds: coerceSeconds(round.restAfterSeconds ?? 0),
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
            restAnnouncements: Array.isArray(set.restAnnouncements) ? set.restAnnouncements : []
          }
        })
      }
    })

    return { ...candidate, preStartSeconds, preStartLabel, description, rounds }
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

  const durationOf = (phase: any) => {
    const raw = phase?.durationSeconds ?? phase?.duration ?? 0
    const seconds = Number(raw)
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  }

  const formatDuration = (seconds?: number | null) => {
    const safe = Number(seconds)
    if (!Number.isFinite(safe) || safe <= 0) return '0s'
    const mins = Math.floor(safe / 60)
    const secs = Math.round(safe % 60)
    if (mins <= 0) return `${secs}s`
    return `${mins}m ${secs}s`
  }

  const computePlanTotals = (planToMeasure: any) => {
    if (!planToMeasure || !Array.isArray(planToMeasure.rounds)) {
      return { work: 0, rest: 0, total: 0 }
    }
    const derivedTimeline = buildTimeline(planToMeasure)
    return derivedTimeline.reduce(
      (totals, phase) => {
        const duration = durationOf(phase)
        totals.total += duration
        if (phase.type === 'work') totals.work += duration
        else totals.rest += duration
        return totals
      },
      { work: 0, rest: 0, total: 0 }
    )
  }

  const roundKeyFor = (round: any, index: number) => round?.id ?? `round-${index + 1}`

  const buildRoundTotalsMap = (phases: any[]) => {
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

  const getRoundTotals = (round: any, index: number, totalsMap: Map<string, any>) =>
    totalsMap.get(roundKeyFor(round, index)) ?? { work: 0, rest: 0, total: 0 }

  const buildSetSegments = (
    set: any,
    nextSetLabel: string,
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

  const systemPrompt = `You are an expert kettlebell and interval-training coach. Output ONLY valid YAML that fits this schema (no prose):
title: string (required)
description: string (optional)
preStartSeconds: number >= 0
preStartLabel: string
rounds: array of objects, in order
  - id: string (optional)
    label: string (mandatory)
    repetitions: integer >= 1
    restAfterSeconds: number >= 0 (optional)
    sets: array of objects, in order
      - id: string (optional)
        label: string (mandatory)
        workSeconds: number > 0
        restSeconds: number >= 0 (optional)
        repetitions: integer >= 1 (optional, default 1)
        transitionSeconds: number >= 0 (optional, default 0)
        targetRpm: number > 0 (optional)
        announcements: optional array of objects
          - text: string
            atSeconds: number or array (>=0; negative means seconds before end)
            once: boolean (optional)
            voice: string (optional)
        restAnnouncements: optional array of objects (same shape)`

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
    previewTotals = computePlanTotals(result.plan)
  }

  $: previewResult = tryParsePlan(editYaml)
  $: previewTotals = previewResult.plan ? computePlanTotals(previewResult.plan) : null
  $: timelinePreview = previewResult.plan ? buildTimeline(previewResult.plan) : []
  $: roundTotalsMapPreview = buildRoundTotalsMap(timelinePreview)

  const timelineForYaml = (yaml?: string | null) => {
    if (!yaml) return []
    try {
      const parsed = normalizePlan(YAML.parse(yaml))
      return buildTimeline(parsed)
    } catch {
      return []
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
    } catch (error) {
      console.warn('OpenAI workout generation error', error)
      aiError = (error as any)?.message ?? 'Failed to generate workout.'
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
    } catch (error) {
      console.warn('OpenAI workout edit error', error)
      aiEditError = (error as any)?.message ?? 'Failed to modify workout.'
      aiEditStatus = ''
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
  $: selectedDayPlans = selectedDateKey ? dayPlans(selectedDateKey) : []

  const openTimer = (plan: Planned, mode: 'timer' | 'big') => {
    const id = plan.id
    if (!id) return
    const base = mode === 'big' ? '/big-picture' : '/timer'
    window.location.href = `${base}?planned=${encodeURIComponent(id)}`
  }

  onMount(() => {
    loadPlans()
    templatesLoad()
  })
</script>

<main class="page">
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
        <div class="today-actions">
          <button class="ghost" on:click={() => openNew(dayKey(Date.now()))}>Plan today</button>
          {#if todayPlan}
            <button class="primary" on:click={() => openTimer(todayPlan!, 'timer')}>Start in Timer</button>
            <button class="ghost" on:click={() => openTimer(todayPlan!, 'big')}>Start in Big Picture</button>
          {/if}
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
            <button class="ghost" on:click={() => openEdit(todayPlan!)}>Edit</button>
            <button class="ghost danger" on:click={() => deletePlan(todayPlan!.id)}>Delete</button>
          </div>
        </div>
      {:else}
        <p class="muted small">No plan for today.</p>
      {/if}
    </section>

    <section class="calendar-shell">
      <div class="calendar-head">
        <div class="month-nav">
          <button class="ghost" on:click={() => moveMonth(-1)}>←</button>
          <strong>{monthLabel(calendarMonth)}</strong>
          <button class="ghost" on:click={() => moveMonth(1)}>→</button>
        </div>
        <div class="inline-actions">
          <button class="primary" on:click={() => openNew()}>Add workout</button>
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
          <button
            type="button"
            class="day"
            class:active={selectedDateKey === key}
            on:click={() => (selectedDateKey = key)}
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
                  <div class="day-row" title={`${it.title || 'Workout'}`}>
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
    </section>

    <section class="day-detail">
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
          {#each selectedDayPlans as item}
            <article class="card">
              <div class="card-header">
                <div>
                  <h4>{item.title || 'Workout'}</h4>
                  <p class="muted small">{new Date(item.planned_for).toLocaleString()}</p>
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
                  <button class="ghost danger" on:click={() => deletePlan(item.id)}>Delete</button>
                </div>
              </div>
              {#if timelineForYaml(item.yaml_source).length}
                <div class="plan-timeline">
                  <PhaseQueue phases={timelineForYaml(item.yaml_source)} activeIndex={-1} />
                </div>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

{#if editOpen}
  <div class="modal-backdrop"></div>
  <div class="edit-modal">
      <header>
        <h3>{editId ? 'Edit planned workout' : 'Add planned workout'}</h3>
        <button class="ghost" on:click={() => (editOpen = false)}>✕</button>
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
                <button class="ghost icon-btn" on:click={() => (editTags = editTags.filter((t) => t !== tag))}>×</button>
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
        <label class="yaml-field">
          <span class="muted small">YAML</span>
          <textarea bind:value={editYaml} rows="18" spellcheck="false"></textarea>
          {#if previewResult.error}
            <p class="status error">Parse error: {previewResult.error.message}</p>
          {:else if previewTotals}
            <p class="status ok">
              Work: {Math.round((previewTotals?.work ?? 0) / 60)}m · Rest: {Math.round((previewTotals?.rest ?? 0) / 60)}m · Total: {Math.round((previewTotals?.total ?? 0) / 60)}m
            </p>
          {/if}
        </label>
        {#if templates.length}
          <div class="template-list">
            <p class="muted small">Templates</p>
            <div class="templates">
              {#each templates as tmpl}
                <button class="ghost small" type="button" on:click={() => selectTemplate(tmpl)}>
                  {tmpl.name}
                </button>
              {/each}
            </div>
            <button class="ghost small" type="button" on:click={() => (libraryModalOpen = true)}>
              Load from library
            </button>
  </div>
  <LibraryModal
    open={libraryModalOpen}
    workouts={libraryWorkouts}
    on:close={() => (libraryModalOpen = false)}
    on:select={(e) => selectTemplate(e.detail?.workout)}
  />
{/if}
        <section class="ai-panel">
          <h3>AI Assistant</h3>
          <p class="muted small">
            Uses your OpenAI key from Settings. Generate or modify the YAML below.
            <button class="ghost small" type="button" on:click={openSettings}>Open settings</button>
          </p>
          <textarea
            rows="3"
            placeholder="Describe the workout you want..."
            bind:value={aiPrompt}
          ></textarea>
          <div class="actions ai-actions">
            <button
              class="primary"
              type="button"
              on:click={generateWorkoutFromAi}
              disabled={isGenerating}
            >
              {#if isGenerating}Generating…{:else}Generate{/if}
            </button>
            {#if aiStatus}<span class="muted small">{aiStatus}</span>{/if}
            {#if aiError}<span class="error small">{aiError}</span>{/if}
          </div>
          <textarea
            rows="3"
            placeholder="Tell AI how to change current YAML…"
            bind:value={aiEditInstructions}
          ></textarea>
          <div class="actions ai-actions">
            <button
              class="secondary"
              type="button"
              on:click={modifyWorkoutWithAi}
              disabled={isAiEditing}
            >
              {#if isAiEditing}Applying…{:else}Modify YAML{/if}
            </button>
            {#if aiEditStatus}<span class="muted small">{aiEditStatus}</span>{/if}
            {#if aiEditError}<span class="error small">{aiEditError}</span>{/if}
          </div>
        </section>

        {#if timelinePreview.length}
          <section class="overview">
            <h3>Session overview</h3>
            <PhaseQueue phases={timelinePreview} activeIndex={-1} />
            <div class="overview__grid">
              <div class="overview__item">
                <span>Total work</span>
                <strong>{formatDuration(previewTotals?.work ?? 0)}</strong>
              </div>
              <div class="overview__item">
                <span>Total rest</span>
                <strong>{formatDuration(previewTotals?.rest ?? 0)}</strong>
              </div>
              <div class="overview__item">
                <span>Rounds</span>
                <strong>{previewResult.plan?.rounds?.length ?? 0}</strong>
              </div>
            </div>
            <div class="rounds-list">
              {#each previewResult.plan?.rounds ?? [] as round, roundIndex}
                {@const roundTotals = getRoundTotals(round, roundIndex, roundTotalsMapPreview)}
                <article class="round">
                  <header class="round__header">
                    <div>
                      <h4>Round {roundIndex + 1}: {round.label}</h4>
                      <p>
                        Repetitions: {round.repetitions} · Rest after round: {formatDuration(round.restAfterSeconds || 0)}
                      </p>
                    </div>
                    <div class="round__badges">
                      {#if round.repetitions > 1}
                        <span class="round__badge"> {round.repetitions}× cycle </span>
                      {/if}
                      <span class="round__badge">
                        {formatDuration(roundTotals.total)}
                      </span>
                    </div>
                  </header>
                  <ul class="set-list">
                    {#each round.sets as set, setIndex (set.id)}
                      {@const segments = buildSetSegments(
                        set,
                        round.sets[setIndex + 1]?.label,
                        round.repetitions,
                        round.restAfterSeconds,
                        roundIndex < (previewResult.plan?.rounds?.length ?? 0) - 1
                      )}
                      <li class="set">
                        <div class="set__header">
                          <div>
                            <h5>{set.label}</h5>
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
                          </div>
                        </div>
                        <div class="set-timeline" class:set-timeline--compact={!(segments.work || segments.rest)}>
                          <div class="set-timeline__segments">
                            {#if segments.work}
                              <div class="segment-block segment-block--work">
                                <span class="segment-block__label">
                                  {segments.setRepetitions > 1 ? 'Work per rep' : 'Work'}
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
                            {#if segments.transitionSegment}
                              <div class="segment-block segment-block--transition">
                                <span class="segment-block__label">
                                  {segments.transitionSegment.label}
                                </span>
                                <span class="segment-block__time">
                                  {formatDuration(segments.transitionSegment.duration)}
                                </span>
                              </div>
                            {/if}
                          </div>
                        </div>
                      </li>
                    {/each}
                  </ul>
                </article>
              {/each}
            </div>
          </section>
        {/if}
      </div>
      <div class="actions">
        <button class="primary" on:click={savePlan}>Save</button>
        <button class="ghost" on:click={() => (editOpen = false)}>Cancel</button>
      </div>
    </div>
  {/if}
</main>

<style>
  .page {
    max-width: 1400px;
    margin: 0 auto;
    padding: 1.5rem 1rem 2.5rem;
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
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
  }
  .calendar-shell {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
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
    min-height: 110px;
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
    background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-2));
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
  input,
  textarea {
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.5rem 0.65rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }
  textarea {
    font-family: 'Space Grotesk', monospace;
  }
  .yaml-field textarea {
    min-height: 280px;
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
  .template-list .templates {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .ai-panel {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background: color-mix(in srgb, var(--color-surface-1) 60%, transparent);
  }
  .ai-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .status.ok {
    color: var(--color-text-muted);
  }
  .overview__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 0.65rem;
    margin: 0.5rem 0;
  }
  .overview__item {
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.5rem 0.65rem;
    background: color-mix(in srgb, var(--color-surface-1) 60%, transparent);
  }
  .overview__item span {
    color: var(--color-text-muted);
    font-size: 0.9rem;
  }
  .overview__item strong {
    display: block;
    font-size: 1.2rem;
  }
  .rounds-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 0.5rem;
  }
  .round {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.65rem 0.75rem;
    background: color-mix(in srgb, var(--color-surface-1) 60%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .round__header {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .round__badges {
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .round__badge {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 0.2rem 0.55rem;
    font-size: 0.85rem;
  }
  .set-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .set {
    border-top: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
    padding-top: 0.4rem;
  }
  .set__header {
    display: flex;
    justify-content: space-between;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .set__meta {
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
    flex-wrap: wrap;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }
  .set-timeline {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-top: 0.2rem;
  }
  .set-timeline__segments {
    display: inline-flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .segment-block {
    border-radius: 8px;
    padding: 0.35rem 0.5rem;
    background: color-mix(in srgb, var(--color-surface-2) 60%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
  }
  .segment-block__label {
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }
  .segment-block__time {
    font-size: 0.9rem;
    font-weight: 700;
  }
  .segment-block--work {
    border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
  }
  .segment-block--rest {
    border-color: color-mix(in srgb, var(--color-text-muted) 50%, var(--color-border));
  }
  .segment-block--transition {
    border-color: color-mix(in srgb, var(--color-accent) 20%, var(--color-border));
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
