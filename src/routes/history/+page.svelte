<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import YAML from 'yaml'
  import { buildTimeline } from '$lib/timer/lib/timeline'
  import { browser } from '$app/environment'
  import { buildWorkoutSummary } from '$lib/stats/workoutSummary'
  import { rankSimilarWorkouts } from '$lib/stats/workoutSimilarity'
  import { buildAiPayloadBatch } from '$lib/stats/aiPayload'
  import { settings, openSettingsModal } from '$lib/stores/settings'
  import { getInsightsPrompt, defaultInsightsPrompt } from '$lib/ai/prompts'

  type CompletedSet = {
    phase_index?: number
    round_label?: string
    set_label?: string
    reps?: number | null
    weight?: number | null
    duration_s?: number | null
    type?: string | null
    rpe?: number | null
  }

  type CompletedWorkout = {
    id: string
    workout_id?: string | null
    title?: string
    started_at?: number | null
    finished_at?: number | null
    duration_s?: number | null
    created_at?: number
    notes?: string | null
    rpe?: number | null
    tags?: string[]
    sets: CompletedSet[]
  }

  type CompareTotals = {
    totalReps: number
    totalWorkSeconds: number
    totalSets: number
    tonnage: number
    avgWeight: number | null
  }

  type CompareSuggestion = {
    workout: CompletedWorkout
    score: number
    reasons: string[]
    totals: CompareTotals
  }
  type ExerciseRollup = {
    label: string
    key: string
    totalReps: number
    totalWorkSeconds: number
    tonnage: number
  }
  type ExerciseDiff = {
    label: string
    source: ExerciseRollup
    target: ExerciseRollup
    deltaReps: number
    deltaWorkSeconds: number
    deltaTonnage: number
  }

  let items: CompletedWorkout[] = []
  let loading = false
  let error = ''
  let editingId: string | null = null
  let editSets: CompletedSet[] = []
  let editTitle = ''
  let editStartedAt = ''
  let editFinishedAt = ''
  let editDurationMinutes: number | null = null
  let editNotes = ''
  let editRpe: number | null = null
  let editTags: string[] = []
  let newTagInput = ''
  let confirmDeleteSetIdx: number | null = null
  type Toast = { id: string; message: string; type: 'info' | 'success' | 'error' }
  let toasts: Toast[] = []
  let searchTerm = ''
  let dateFilter: 'all' | '7' | '30' = 'all'
  let visibleItems: CompletedWorkout[] = []
  let selectedTags: string[] = []
  let availableTags: string[] = []
  let templates: { id: string; name: string; description?: string; yaml_source?: string; plan_json?: any }[] = []
  let templateModalOpen = false
  let confirmDeleteId: string | null = null
  let viewMode: 'list' | 'calendar' = 'list'
  let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
  let selectedDateKey = ''
  let mobileWeekStart = new Date().getTime()
  let shareItem: CompletedWorkout | null = null
  let shareRoundCol = 120
  let shareShowReps = true
  let shareShowWork = true
  let shareShowSets = true
  let shareShowDividers = true
  let shareShowTagPills = true
  let shareShowNoise = true
  let shareColorCodeRests = true
  let shareShowBadge = true
  let shareShowHrBlock = true
  let shareHighlightEnabled = false
  let shareHighlights: Set<number> = new Set()
  let shareHighlightsKey = ''
  let sharePreviewRows: CompletedSet[] = []
  let shareSelectableRows: { label: string; index: number }[] = []
  let shareRenderMode: 'detailed' | 'summary' = 'detailed'
  let compareModalOpen = false
  let compareSource: CompletedWorkout | null = null
  let compareTarget: CompletedWorkout | null = null
  let compareSourceTotals: CompareTotals | null = null
  let compareTargetTotals: CompareTotals | null = null
  let compareSuggestions: CompareSuggestion[] = []
  let compareLoading = false
  let compareError = ''
  let compareSearch = ''
  let compareManualOptions: CompletedWorkout[] = []
  let compareExerciseDiffs: { matched: ExerciseDiff[]; onlySource: ExerciseRollup[]; onlyTarget: ExerciseRollup[] } = {
    matched: [],
    onlySource: [],
    onlyTarget: []
  }
  let compareHrSharedScale = false
  let compareResultsEl: HTMLDivElement | null = null
  let hrAttached: Record<string, boolean> = {}
  let hrRemoveTarget: string | null = null
  let hrRemoveSession: CompletedWorkout | null = null
  let confirmDeleteSession: CompletedWorkout | null = null
  let hrRemoveError = ''
  let hrRemoveStatus = ''
  let uploadTargetId: string | null = null
  let uploadStatus: Record<string, string> = {}
  let fileInputEl: HTMLInputElement | null = null
  let overflowOpen: Record<string, boolean> = {}
  let sharePreviewUrl = ''
  let hrDetails: Record<string, { avgHr: number | null; maxHr: number | null; samples?: { t: number; hr: number }[] }> = {}
  let hrSummary: Record<string, { avgHr: number | null; maxHr: number | null }> = {}
  let filterHasHr = false
  let sortBy: 'dateDesc' | 'dateAsc' | 'durationDesc' | 'durationAsc' | 'hrDesc' | 'rpeDesc' = 'dateDesc'
  let expanded: Record<string, boolean> = {}
  type HrSparkColors = { bg: string; border: string; line: string; avg: string; max: string }
  const defaultSparkColors: HrSparkColors = {
    bg: 'rgba(255,255,255,0.04)',
    border: 'rgba(255,255,255,0.08)',
    line: 'rgba(255,255,255,0.9)',
    avg: 'rgba(255,255,255,0.35)',
    max: 'rgba(255,170,120,0.9)'
  }
  let hrSparkColors: HrSparkColors = { ...defaultSparkColors }
  // Insights use a richer model; workout generation elsewhere stays on its own model.
  const OPENAI_CHAT_MODEL = 'gpt-5.1'
  let openAiKey = ''
  let insightsPrompt = defaultInsightsPrompt
  $: openAiKey = $settings.openAiKey ?? ''
  $: insightsPrompt = getInsightsPrompt($settings.aiInsightsPrompt)
  let insightsQuestion = ''
  let insightsStatus = ''
  let insightsError = ''
  let insightsAnswer = ''
  let insightsHtml = ''
  let insightsLoading = false
  let insightsModalOpen = false

  const toRgba = (color: string, alpha = 1) => {
    const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
    if (color.startsWith('#')) {
      const hex = color.slice(1)
      const full =
        hex.length === 3
          ? hex
              .split('')
              .map((c) => c + c)
              .join('')
          : hex
      const num = parseInt(full, 16)
      const r = (num >> 16) & 255
      const g = (num >> 8) & 255
      const b = num & 255
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
    const m = color.match(/rgba?\(([^)]+)\)/)
    if (m) {
      const parts = m[1].split(',').map((p) => parseFloat(p.trim()))
      const [r, g, b, a = 1] = parts
      return `rgba(${clamp(r)}, ${clamp(g)}, ${clamp(b)}, ${Math.max(0, Math.min(1, a * alpha))})`
    }
    return color
  }

  const parseRgb = (color: string): { r: number; g: number; b: number } | null => {
    if (color.startsWith('#')) {
      const hex = color.slice(1)
      const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
      const num = parseInt(full, 16)
      return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
    }
    const m = color.match(/rgba?\(([^)]+)\)/)
    if (m) {
      const parts = m[1].split(',').map((p) => parseFloat(p.trim()))
      const [r, g, b] = parts
      return { r, g, b }
    }
    return null
  }

  const luminance = (rgb: { r: number; g: number; b: number } | null) => {
    if (!rgb) return 0
    const toLin = (c: number) => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * toLin(rgb.r) + 0.7152 * toLin(rgb.g) + 0.0722 * toLin(rgb.b)
  }

  const getCssColor = (name: string, fallback: string) => {
    if (typeof window === 'undefined') return fallback
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  }

  const removeHrFile = async (id: string) => {
    hrRemoveStatus = 'Removing…'
    hrRemoveError = ''
    uploadStatus = { ...uploadStatus, [id]: 'Removing…' }
    try {
      const res = await fetch(`/api/completed-workouts/${id}/hr`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? 'Failed to remove')
      const { [id]: _summary, ...restSummary } = hrSummary
      const { [id]: _details, ...restDetails } = hrDetails
      hrSummary = restSummary
      hrDetails = restDetails
      hrAttached = { ...hrAttached, [id]: false }
      uploadStatus = { ...uploadStatus, [id]: 'Removed' }
      hrRemoveStatus = 'Removed'
      hrRemoveTarget = null
      pushToast('HR file removed.', 'success')
    } catch (err) {
      uploadStatus = { ...uploadStatus, [id]: (err as any)?.message ?? 'Remove failed' }
      hrRemoveStatus = ''
      hrRemoveError = (err as any)?.message ?? 'Remove failed'
      pushToast(hrRemoveError, 'error')
    } finally {
      setTimeout(() => {
        uploadStatus = { ...uploadStatus, [id]: '' }
      }, 2000)
      setTimeout(() => {
        if (hrRemoveStatus === 'Removed') hrRemoveStatus = ''
      }, 2000)
    }
  }

  const pushToast = (message: string, type: Toast['type'] = 'info', duration = 2400) => {
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
    const toast = { id, message, type }
    toasts = [...toasts, toast]
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id)
    }, duration)
  }

  const toggleOverflow = (id: string) => {
    const next: Record<string, boolean> = {}
    Object.keys(overflowOpen).forEach((key) => (next[key] = false))
    next[id] = !overflowOpen[id]
    overflowOpen = next
  }

  const requestRemoveHrFile = (id: string) => {
    hrRemoveTarget = id
    hrRemoveError = ''
    hrRemoveStatus = ''
  }

  const toggleExpanded = (id: string, state?: boolean) => {
    const next = { ...expanded, [id]: state ?? !expanded[id] }
    expanded = next
  }

  const monthLabel = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleString(undefined, { month: 'long', year: 'numeric' })
  }

  const dayKey = (ts: number) => {
    const d = new Date(ts)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const daysInMonth = (ts: number) => {
    const d = new Date(ts)
    const year = d.getFullYear()
    const month = d.getMonth()
    return new Date(year, month + 1, 0).getDate()
  }

  const startOfMonthWeekday = (ts: number) => {
    const d = new Date(ts)
    d.setDate(1)
    const dow = d.getDay() // 0 = Sunday
    return (dow + 6) % 7 // shift so Monday = 0
  }

  const moveMonth = (delta: number) => {
    const d = new Date(calendarMonth)
    d.setMonth(d.getMonth() + delta)
    calendarMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    selectedDateKey = ''
  }

  const dateMatchesMonth = (ts: number, monthTs: number) => {
    const d = new Date(ts)
    const m = new Date(monthTs)
    return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth()
  }

  const selectDate = (key: string) => {
    selectedDateKey = key
  }

  const startOfWeek = (ts: number) => {
    const d = new Date(ts)
    const dow = (d.getDay() + 6) % 7 // Monday first
    d.setDate(d.getDate() - dow)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  const weekLabel = (startTs: number) => {
    const start = new Date(startTs)
    const end = new Date(startTs)
    end.setDate(end.getDate() + 6)
    return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  }

  const shiftWeek = (delta: number) => {
    const next = new Date(mobileWeekStart)
    next.setDate(next.getDate() + delta * 7)
    mobileWeekStart = startOfWeek(next.getTime())
    const key = dayKey(mobileWeekStart)
    selectedDateKey = key
    calendarMonth = new Date(next.getFullYear(), next.getMonth(), 1).getTime()
  }

  const computeHrSparkColors = () => {
    const surface1 = getCssColor('--color-surface-1', '#0c1220')
    const textPrimary = getCssColor('--color-text-primary', '#f8fbff')
    const textMuted = getCssColor('--color-text-muted', 'rgba(255,255,255,0.7)')
    const accent = getCssColor('--color-accent', '#4dabf7')
    const isLightTheme = luminance(parseRgb(surface1)) > 0.5
    hrSparkColors = {
      bg: isLightTheme ? 'rgba(0,0,0,0.02)' : toRgba(textPrimary, 0.02),
      border: isLightTheme ? 'rgba(0,0,0,0.1)' : toRgba(textPrimary, 0.08),
      line: isLightTheme ? 'rgba(0,0,0,0.75)' : toRgba(textPrimary, 0.9),
      avg: isLightTheme ? 'rgba(0,0,0,0.35)' : toRgba(textMuted, 0.35),
      max: toRgba(accent, 0.9)
    }
  }
  computeHrSparkColors()

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

  const renderMarkdown = (md: string) => {
    const lines = md.split(/\r?\n+/)
    let html = ''
    let inList = false
    for (const line of lines) {
      const bullet = line.match(/^\s*[-*]\s+(.*)/)
      if (bullet) {
        if (!inList) {
          html += '<ul>'
          inList = true
        }
        html += `<li>${escapeHtml(bullet[1])}</li>`
        continue
      }
      if (inList) {
        html += '</ul>'
        inList = false
      }
      if (line.trim()) {
        html += `<p>${escapeHtml(line.trim())}</p>`
      }
    }
    if (inList) html += '</ul>'
    return html
  }

  const generateInsights = async () => {
    const key = openAiKey.trim()
    if (!key) {
      insightsError = 'Add your OpenAI API key in Settings to generate insights.'
      insightsStatus = ''
      return
    }
    if (!visibleItems.length) {
      insightsError = 'No workouts to analyze. Adjust filters first.'
      insightsStatus = ''
      return
    }
    const payload = buildAiPayloadBatch(visibleItems, hrSummary, 25)
    const question =
      insightsQuestion.trim() ||
      'Find notable trends in volume, HR vs RPE, and suggest next-step focus areas.'

    insightsLoading = true
    insightsError = ''
    insightsStatus = 'Contacting OpenAI…'

    try {
      console.log('insights payload', {
        prompt: insightsPrompt,
        question,
        model: OPENAI_CHAT_MODEL,
        payload
      })
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: OPENAI_CHAT_MODEL,
          temperature: 0.4,
          messages: [
            { role: 'system', content: insightsPrompt },
            {
              role: 'user',
              content: [
                'Analyze these completed workouts (array of objects).',
                'Highlight trends in volume/intensity, HR vs RPE, and recovery needs.',
                'Return 3-6 concise bullet points in Markdown (unordered list). Prefer specific suggestions over generic advice.',
                `User question: ${question}`,
                'Data:',
                JSON.stringify(payload)
              ].join('\n')
            }
          ]
        })
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`OpenAI request failed: ${res.status} ${text.slice(0, 180)}`)
      }
      const data = await res.json()
      const content = data?.choices?.[0]?.message?.content ?? ''
      insightsAnswer = typeof content === 'string' ? content.trim() : ''
      insightsHtml = renderMarkdown(insightsAnswer)
      insightsStatus = `Analyzed ${payload.length} session${payload.length === 1 ? '' : 's'}.`
    } catch (err) {
      insightsError = (err as any)?.message ?? 'Failed to generate insights.'
      insightsStatus = ''
    } finally {
      insightsLoading = false
    }
  }

  const loadHistory = async () => {
    loading = true
    error = ''
    try {
      const res = await fetch('/api/completed-workouts')
      if (!res.ok) throw new Error('Failed to load history')
      const data = await res.json()
      items =
        data?.items?.map((it: CompletedWorkout) => ({
          ...it,
          tags: Array.isArray(it.tags) ? it.tags : [],
          // Keep work rows that have duration/weight/reps and all non-work rows.
          sets: (it.sets ?? []).filter((s) => {
            if (s.type && s.type !== 'work') return true
            const hasReps = s.reps !== null && s.reps !== undefined
            const hasDuration = s.duration_s !== null && s.duration_s !== undefined
            const hasWeight = s.weight !== null && s.weight !== undefined
            return hasReps || hasDuration || hasWeight
          })
        })) ?? []
      availableTags = Array.from(
        new Set(
          items
            .flatMap((i) => i.tags ?? [])
            .filter((t) => typeof t === 'string')
            .map((t) => t.trim())
            .filter(Boolean)
        )
      ).slice(0, 30)
      // probe hr
      items.forEach((it) => checkHrStatus(it.id))
    } catch (err) {
      const message = (err as any)?.message ?? 'Failed to load history'
      error = message
    } finally {
      loading = false
    }
  }

  const checkHrStatus = async (id: string) => {
    try {
      const res = await fetch(`/api/completed-workouts/${id}/hr?details=1`)
      const data = await res.json().catch(() => ({}))
      hrAttached = { ...hrAttached, [id]: !!data?.attached }
      if (data?.summary) {
        hrSummary = {
          ...hrSummary,
          [id]: {
            avgHr: data.summary.avgHr ?? null,
            maxHr: data.summary.maxHr ?? null
          }
        }
        if (data.summary.samples) {
          hrDetails = {
            ...hrDetails,
            [id]: { avgHr: data.summary.avgHr ?? null, maxHr: data.summary.maxHr ?? null, samples: data.summary.samples }
          }
        }
        if (data.summary.samples) {
          hrDetails = {
            ...hrDetails,
            [id]: {
              avgHr: data.summary.avgHr ?? null,
              maxHr: data.summary.maxHr ?? null,
              samples: data.summary.samples ?? []
            }
          }
        }
      }
    } catch {
      hrAttached = { ...hrAttached, [id]: false }
    }
  }

  const loadHrDetails = async (id: string) => {
    try {
      const res = await fetch(`/api/completed-workouts/${id}/hr?details=1`)
      const data = await res.json().catch(() => ({}))
      if (data?.summary) {
        hrSummary = {
          ...hrSummary,
          [id]: {
            avgHr: data.summary.avgHr ?? null,
            maxHr: data.summary.maxHr ?? null
          }
        }
        hrDetails = {
          ...hrDetails,
          [id]: {
            avgHr: data.summary.avgHr ?? null,
            maxHr: data.summary.maxHr ?? null,
            samples: data.summary.samples ?? []
          }
        }
        hrAttached = { ...hrAttached, [id]: !!data.attached }
      }
    } catch {
      // ignore
    }
  }

  const normalize = (value?: string | null) => value?.toLowerCase().trim() ?? ''

  const matchesFilters = (
    item: CompletedWorkout,
    termValue: string,
    range: 'all' | '7' | '30'
  ) => {
    const term = normalize(termValue)
    const ts = item.started_at ?? item.created_at
    if (range !== 'all' && ts) {
      const days = range === '7' ? 7 : 30
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
      if (ts < cutoff) return false
    }
    if (!term) return true
    const haystack: string[] = []
    haystack.push(item.title ?? '')
    haystack.push(item.notes ?? '')
    haystack.push(item.workout_id ?? '')
    ;(item.tags ?? []).forEach((t) => haystack.push(t))
    ;(item.sets ?? []).forEach((s) => {
      if (s.round_label) haystack.push(s.round_label)
      if (s.set_label) haystack.push(s.set_label)
    })
    const tokens = term.split(/\s+/).filter(Boolean)
    const normalizedHaystack = haystack.map((v) => normalize(v))
    const allTokensMatch = tokens.every((token) =>
      normalizedHaystack.some((text) => text.includes(token))
    )
    if (!allTokensMatch) return false
    if (selectedTags.length === 0) return true
    const tagsSet = new Set((item.tags ?? []).map((t) => normalize(t)))
    return selectedTags.every((t) => tagsSet.has(normalize(t)))
  }

  const loadTemplates = async () => {
    try {
      const res = await fetch('/api/workouts')
      const data = await res.json().catch(() => ({}))
      const list = (data?.workouts ?? []).filter((w: any) => w.is_template)
      templates = list.map((w: any) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        yaml_source: w.yaml_source,
        plan_json: w.plan_json
      }))
    } catch {
      templates = []
    }
  }

  const ensureCompareTotals = (item: CompletedWorkout, provided?: CompareTotals | null) => {
    if (provided) return provided
    const t = computeTotals(item)
    return {
      totalReps: t.totalReps,
      totalWorkSeconds: t.totalWorkSeconds,
      totalSets: t.totalSets,
      tonnage: t.tonnage,
      avgWeight: t.avgWeight ?? null
    }
  }

  const loadCompareSuggestions = async (item: CompletedWorkout) => {
    compareLoading = true
    compareError = ''
    compareSuggestions = []
    try {
      const res = await fetch(`/api/completed-workouts/${item.id}/similar?pool=320&limit=5`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load comparisons')
      compareSuggestions =
        data?.suggestions?.map((s: any) => {
          const workout: CompletedWorkout = {
            ...(s.workout ?? {}),
            tags: Array.isArray(s?.workout?.tags) ? s.workout.tags : [],
            sets: Array.isArray(s?.workout?.sets) ? s.workout.sets : []
          }
          return {
            workout,
            score: Number(s.score ?? 0),
            reasons: Array.isArray(s?.reasons) ? s.reasons : [],
            totals: ensureCompareTotals(workout)
          }
        }) ?? []
    } catch (err) {
      compareError = (err as any)?.message ?? 'Failed to load comparisons'
      try {
        const ranked = rankSimilarWorkouts(item, items, { limit: 5 })
        if (ranked.length) {
          compareSuggestions = ranked.map((r) => ({
            workout: r.workout as CompletedWorkout,
            score: r.score,
            reasons: r.reasons,
            totals: r.fingerprint.totals
          }))
          compareError = `${compareError} (using visible sessions)`
        }
      } catch {
        // ignore fallback errors
      }
    } finally {
      compareLoading = false
    }
  }

  const openCompareModal = (item: CompletedWorkout) => {
    compareModalOpen = true
    compareSource = item
    compareTarget = null
    compareSourceTotals = ensureCompareTotals(item)
    compareTargetTotals = null
    compareSuggestions = []
    compareSearch = ''
    loadCompareSuggestions(item)
  }

  const closeCompareModal = () => {
    compareModalOpen = false
    compareSource = null
    compareTarget = null
    compareSourceTotals = null
    compareTargetTotals = null
    compareSuggestions = []
    compareError = ''
    compareSearch = ''
  }

  const chooseCompareTarget = (workout: CompletedWorkout, totals?: CompareTotals | null) => {
    compareTarget = workout
    compareTargetTotals = ensureCompareTotals(workout, totals)
  }

  const swapCompareSides = () => {
    if (!compareSource || !compareTarget) return
    const newSource = compareTarget
    const newTarget = compareSource
    const newSourceTotals = ensureCompareTotals(newSource, compareTargetTotals)
    const newTargetTotals = ensureCompareTotals(newTarget, compareSourceTotals)
    compareSource = newSource
    compareTarget = newTarget
    compareSourceTotals = newSourceTotals
    compareTargetTotals = newTargetTotals
  }

  const matchesCompareSearch = (item: CompletedWorkout, term: string) => {
    const norm = term.toLowerCase().trim()
    if (!norm) return true
    const haystack: string[] = []
    haystack.push(item.title ?? '')
    ;(item.tags ?? []).forEach((t) => haystack.push(t))
    ;(item.sets ?? []).forEach((s) => {
      if (s.set_label) haystack.push(s.set_label)
      if (s.round_label) haystack.push(s.round_label)
    })
    return haystack.some((v) => v?.toLowerCase?.().includes(norm))
  }

  const formatTonnage = (value?: number | null) => {
    if (!Number.isFinite(value as number) || !value) return '-'
    const rounded = Math.round(value as number)
    return rounded.toLocaleString()
  }

  const formatDelta = (a?: number | null, b?: number | null) => {
    if (!Number.isFinite(a as number) || !Number.isFinite(b as number)) return ''
    const diff = (a as number) - (b as number)
    if (diff === 0) return ''
    const rounded = Math.round(diff)
    return diff > 0 ? `+${rounded}` : String(rounded)
  }

  const normalizeLabelKey = (value?: string | null) =>
    (value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()

  const rollupExercises = (sets: CompletedSet[] = []): Map<string, ExerciseRollup> => {
    const map = new Map<string, ExerciseRollup>()
    sets.forEach((s) => {
      const type = (s.type ?? 'work').toLowerCase()
      if (type !== 'work') return
      const rawLabel = (s.set_label ?? s.round_label ?? '').trim()
      const key = normalizeLabelKey(rawLabel)
      if (!key) return
      const reps = Number(s.reps) || 0
      const work = Number(s.duration_s) || 0
      const weight = Number(s.weight) || 0
      const tonnage = reps && weight ? reps * weight : 0
      const prev = map.get(key)
      if (prev) {
        prev.totalReps += reps
        prev.totalWorkSeconds += work
        prev.tonnage += tonnage
      } else {
        map.set(key, {
          label: rawLabel || 'Set',
          key,
          totalReps: reps,
          totalWorkSeconds: work,
          tonnage
        })
      }
    })
    return map
  }

  const computeExerciseDiffs = (sourceSets: CompletedSet[] = [], targetSets: CompletedSet[] = []) => {
    const source = rollupExercises(sourceSets)
    const target = rollupExercises(targetSets)
    const matched: ExerciseDiff[] = []
    const onlySource: ExerciseRollup[] = []
    const onlyTarget: ExerciseRollup[] = []

    source.forEach((val, key) => {
      const other = target.get(key)
      if (other) {
        const deltaReps = val.totalReps - other.totalReps
        const deltaWorkSeconds = val.totalWorkSeconds - other.totalWorkSeconds
        const deltaTonnage = val.tonnage - other.tonnage
        if (deltaReps || deltaWorkSeconds || deltaTonnage) {
          matched.push({
            label: val.label || other.label,
            source: val,
            target: other,
            deltaReps,
            deltaWorkSeconds,
            deltaTonnage
          })
        }
      } else {
        onlySource.push(val)
      }
    })

    target.forEach((val, key) => {
      if (!source.has(key)) {
        onlyTarget.push(val)
      }
    })

    matched.sort((a, b) => a.label.localeCompare(b.label))
    onlySource.sort((a, b) => a.label.localeCompare(b.label))
    onlyTarget.sort((a, b) => a.label.localeCompare(b.label))

    return { matched, onlySource, onlyTarget }
  }

  const exerciseDeltaParts = (diff: ExerciseDiff) => {
    const parts: string[] = []
    if (diff.deltaReps) parts.push(`Reps ${formatDelta(diff.source.totalReps, diff.target.totalReps)}`)
    if (diff.deltaWorkSeconds) parts.push(`Work ${formatSignedSeconds(diff.deltaWorkSeconds)}`)
    if (diff.deltaTonnage) parts.push(`Load ${formatSignedTonnage(diff.deltaTonnage)}`)
    return parts
  }


  $: visibleItems = (() => {
    const list = items
      .filter((item) => matchesFilters(item, searchTerm, dateFilter))
      .filter((item) => !filterHasHr || !!hrAttached[item.id] || !!hrSummary[item.id])
    const keyTs = (it: CompletedWorkout) => it.started_at ?? it.created_at ?? 0
    const keyDuration = (it: CompletedWorkout) => Number(it.duration_s) || 0
    const keyHr = (it: CompletedWorkout) => hrSummary[it.id]?.avgHr ?? -Infinity
    const keyRpe = (it: CompletedWorkout) => Number(it.rpe) || -Infinity
    list.sort((a, b) => {
      if (sortBy === 'durationDesc') return keyDuration(b) - keyDuration(a)
      if (sortBy === 'durationAsc') return keyDuration(a) - keyDuration(b)
      if (sortBy === 'hrDesc') return keyHr(b) - keyHr(a)
      if (sortBy === 'rpeDesc') return keyRpe(b) - keyRpe(a)
      if (sortBy === 'dateAsc') return keyTs(a) - keyTs(b)
      return keyTs(b) - keyTs(a)
    })
    // reference hrSummary/hrAttached so reactive responds to changes
    hrSummary && hrAttached
    return list
  })()

  $: compareManualOptions = (() => {
    if (!compareSource) return []
    const srcId = compareSource.id
    return items
      .filter((it) => it.id !== srcId)
      .filter((it) => matchesCompareSearch(it, compareSearch))
      .slice(0, 20)
  })()

  $: compareExerciseDiffs = (() => {
    if (!compareSource || !compareTarget) return { matched: [], onlySource: [], onlyTarget: [] }
    return computeExerciseDiffs(compareSource.sets ?? [], compareTarget.sets ?? [])
  })()

  $: if (browser && compareModalOpen && compareTarget && compareResultsEl) {
    compareResultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  $: monthItems = visibleItems.filter((item) => {
    const ts = item.started_at ?? item.created_at
    if (!ts) return false
    return dateMatchesMonth(ts, calendarMonth)
  })

  $: dailyBuckets = (() => {
    const buckets: Record<string, CompletedWorkout[]> = {}
    visibleItems.forEach((item) => {
      const ts = item.started_at ?? item.created_at
      if (!ts) return
      const key = dayKey(ts)
      buckets[key] = buckets[key] ? [...buckets[key], item] : [item]
    })
    return buckets
  })()

  $: selectedDayItems =
    selectedDateKey && dailyBuckets[selectedDateKey] ? dailyBuckets[selectedDateKey] : []
  $: mobileWeekStart = selectedDateKey ? startOfWeek(Date.parse(selectedDateKey)) : mobileWeekStart
  $: mobileWeekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mobileWeekStart)
    d.setDate(d.getDate() + i)
    const ts = d.getTime()
    return { key: dayKey(ts), label: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) }
  })
  $: availableTags = Array.from(
    new Set(
      items
        .flatMap((i) => i.tags ?? [])
        .filter((t) => typeof t === 'string')
        .map((t) => t.trim())
        .filter(Boolean)
    )
  ).slice(0, 30)

  const formatSummary = (item: CompletedWorkout) => {
    const rounds: Record<string, { sets: CompletedSet[] }> = {}
    const order: string[] = []
    item.sets?.forEach((s) => {
      const roundLabel = s.round_label ?? 'Round'
      if (!rounds[roundLabel]) {
        rounds[roundLabel] = { sets: [] }
        order.push(roundLabel)
      }
      rounds[roundLabel].sets.push(s)
    })
    const lines: string[] = []
    order.forEach((round) => {
      const bucket = rounds[round]
      const hasWork = bucket.sets.some((s) => !s.type || s.type === 'work')
      if (!hasWork && bucket.sets.length) {
        const restDur = bucket.sets.find((s) => s.duration_s)?.duration_s
        const durLabel = restDur ? ` (${formatDuration(restDur)})` : ''
        lines.push(`- Rest${durLabel}`)
        return
      }
      lines.push(`- ${round}:`)
      bucket.sets.forEach((s) => {
        const weight = s.weight ? ` @ ${s.weight}` : ''
        const dur = s.duration_s ? ` (${formatDuration(s.duration_s)})` : ''
        if (s.type && s.type !== 'work') {
          lines.push(`  - Rest${dur}`)
        } else {
          lines.push(`  - ${s.set_label ?? 'Set'}: ${s.reps ?? '-'}${weight}${dur}`)
        }
      })
    })
    return lines.join('\n')
  }

  const copySummary = async (item: CompletedWorkout) => {
    try {
      await navigator.clipboard.writeText(formatSummary(item))
      pushToast('Copied summary', 'success')
    } catch (err) {
      pushToast('Copy failed', 'error')
    }
  }

  const copyCompactSummary = async (item: CompletedWorkout) => {
    try {
      const { text } = buildWorkoutSummary(item.sets)
      await navigator.clipboard.writeText(text || '')
      pushToast('Copied compact summary', 'success')
    } catch (err) {
      pushToast('Copy failed', 'error')
    }
  }

  const deleteItem = async (id: string) => {
    await fetch(`/api/completed-workouts/${id}`, { method: 'DELETE' })
    items = items.filter((i) => i.id !== id)
  }

  const duplicateLog = async (item: CompletedWorkout) => {
    try {
      const entries = (item.sets ?? []).map((s, idx) => ({
        phaseIndex:
          s.phase_index ?? (Number.isInteger((s as any).position) ? (s as any).position : idx),
        roundLabel: s.round_label ?? 'Round',
        setLabel: s.set_label ?? 'Set',
        reps: s.reps ?? null,
        weight: s.weight ?? null,
        durationSeconds: s.duration_s ?? null,
        type: s.type ?? 'work',
        rpe: s.rpe ?? null
      }))
      const res = await fetch('/api/completed-workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title ? `${item.title} (log)` : 'Workout log',
          workoutId: item.workout_id ?? null,
          startedAt: Date.now(),
          finishedAt: Date.now(),
          durationSeconds: item.duration_s ?? null,
          notes: item.notes ?? '',
          rpe: item.rpe ?? null,
          tags: item.tags ?? [],
          entries
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to duplicate')
      if (data?.item) {
        items = [data.item, ...items]
      }
      pushToast('Log duplicated.', 'success')
    } catch (err) {
      pushToast((err as any)?.message ?? 'Duplicate failed', 'error')
    }
  }

  const createEmptyCompletedWorkout = async () => {
    try {
      const res = await fetch('/api/completed-workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Manual log',
          startedAt: Date.now(),
          finishedAt: Date.now(),
          durationSeconds: null,
          notes: '',
          tags: [],
          entries: []
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to create log')
      // prepend
      if (data?.item) {
        items = [data.item, ...items]
      }
      pushToast('Created empty session log.', 'success')
    } catch (err) {
      pushToast((err as any)?.message ?? 'Create failed', 'error')
    }
  }

  const createLogFromTemplate = async (workoutId: string, name?: string) => {
    try {
      const res = await fetch(`/api/workouts/${workoutId}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.workout) throw new Error(data?.error ?? 'Template not found')
      const workout = data.workout
      let plan = workout.plan_json
      if (!plan && workout.yaml_source) {
        plan = YAML.parse(workout.yaml_source)
      }
      let entries: CompletedSet[] = []
      try {
        if (plan) {
          const timeline = buildTimeline(plan)
          const roundLabelById = new Map<string, string>()
          const roundLabelByIndex = new Map<number, string>()
          const setLabelByKey = new Map<string, string>()
          const setLabelByIndex = new Map<string, string>() // key: `${roundIndex}::${setIndex}`
          const setLabelById = new Map<string, string>()

          ;(plan.rounds ?? []).forEach((round: any, ri: number) => {
            const rId = round.id ?? `round-${ri}`
            const rLabel = round.label ?? `Round ${ri + 1}`
            roundLabelById.set(rId, rLabel)
            roundLabelByIndex.set(ri, rLabel)
            ;(round.sets ?? []).forEach((set: any, si: number) => {
              const sId = set.id ?? `set-${si}`
              const sLabel = set.label ?? `Set ${si + 1}`
              setLabelByKey.set(`${rId}::${sId}`, sLabel)
              setLabelByIndex.set(`${ri}::${si}`, sLabel)
              setLabelById.set(sId, sLabel)
            })
          })

          const getRoundLabel = (phase: any) => {
            if (phase?.metadata?.roundLabel) return phase.metadata.roundLabel
            if (phase?.roundId && roundLabelById.has(phase.roundId)) return roundLabelById.get(phase.roundId)
            if (Number.isInteger(phase?.roundIndex) && roundLabelByIndex.has(Number(phase.roundIndex))) {
              return roundLabelByIndex.get(Number(phase.roundIndex))
            }
            return plan?.title ?? 'Round'
          }

          const getSetLabel = (phase: any) => {
            if (phase?.metadata?.setLabel) return phase.metadata.setLabel
            const rId = phase?.roundId ?? null
            const sId = phase?.setId ?? null
            if (rId && sId) {
              const key = `${rId}::${sId}`
              if (setLabelByKey.has(key)) return setLabelByKey.get(key)
            }
            if (sId && setLabelById.has(sId)) return setLabelById.get(sId)
            if (Number.isInteger(phase?.roundIndex) && Number.isInteger(phase?.setIndex)) {
              const key = `${Number(phase.roundIndex)}::${Number(phase.setIndex)}`
              if (setLabelByIndex.has(key)) return setLabelByIndex.get(key)
            }
            if (phase?.label) return phase.label
            if (phase?.type === 'rest' || phase?.type === 'transition') return 'Rest'
            return 'Set'
          }

          entries = timeline
            .filter((phase: any) => phase.durationSeconds || phase.duration)
            .map((phase: any, idx: number) => ({
              phase_index: idx,
              round_label: getRoundLabel(phase),
              set_label: getSetLabel(phase),
              reps: null,
              weight: null,
              duration_s: phase.durationSeconds ?? phase.duration ?? null,
              type: phase.type ?? 'work',
              rpe: null
            }))
        }
      } catch (err) {
        console.warn('Failed to build timeline for template', err)
      }

      const resCreate = await fetch('/api/completed-workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: name ?? workout.name ?? 'Workout log',
          workoutId,
          startedAt: Date.now(),
          finishedAt: Date.now(),
          durationSeconds: null,
          notes: '',
          tags: [],
          entries
        })
      })
      const result = await resCreate.json().catch(() => ({}))
      if (!resCreate.ok) throw new Error(result?.error ?? 'Failed to create log')
      if (result?.item) {
        items = [result.item, ...items]
      }
      pushToast('Logged from template.', 'success')
    } catch (err) {
      pushToast((err as any)?.message ?? 'Copy failed', 'error')
    }
  }

  const duplicateWorkoutFromItem = async (item: CompletedWorkout) => {
    if (!item.workout_id) {
      await createEmptyCompletedWorkout()
      return
    }
    await createLogFromTemplate(item.workout_id, item.title ?? 'Workout log')
  }

  const startEdit = (item: CompletedWorkout) => {
    editingId = item.id
    expanded = { ...expanded, [item.id]: true }
    const ts = item.started_at ?? item.created_at
    if (ts) {
      selectedDateKey = dayKey(ts)
      calendarMonth = new Date(new Date(ts).getFullYear(), new Date(ts).getMonth(), 1).getTime()
    }
    editSets = item.sets?.map((s) => ({ ...s })) ?? []
    editTitle = item.title ?? ''
    editStartedAt = item.started_at ? toLocalDatetimeInput(item.started_at) : ''
    editFinishedAt = item.finished_at ? toLocalDatetimeInput(item.finished_at) : ''
    editDurationMinutes =
      item.duration_s && Number.isFinite(item.duration_s) ? Math.round(item.duration_s / 60) : null
    editNotes = item.notes ?? ''
    editRpe = item.rpe ?? null
    editTags = (item.tags ?? []).map((t) => t.trim()).filter(Boolean)
    newTagInput = ''
  }

  const cancelEdit = () => {
    editingId = null
    editSets = []
    editTitle = ''
    editTags = []
    newTagInput = ''
  }

  const addTag = () => {
    const tag = newTagInput.trim()
    if (!tag) return
    if (tag.length > 24) {
      newTagInput = tag.slice(0, 24)
    }
    const normalized = (newTagInput || tag).trim()
    if (!normalized) return
    if (editTags.includes(normalized)) {
      newTagInput = ''
      return
    }
    editTags = [...editTags, normalized].slice(0, 8)
    newTagInput = ''
  }

  const removeTag = (tag: string) => {
    editTags = editTags.filter((t) => t !== tag)
  }

  const toggleFilterTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      selectedTags = selectedTags.filter((t) => t !== tag)
    } else {
      selectedTags = [...selectedTags, tag]
    }
  }

  const updateSet = (index: number, key: 'reps' | 'weight', value: number | null) => {
    editSets = editSets.map((s, i) => (i === index ? { ...s, [key]: value } : s))
  }

  const updateSetField = (index: number, patch: Partial<CompletedSet>) => {
    editSets = editSets.map((s, i) => (i === index ? { ...s, ...patch } : s))
  }

  const addSet = (type: 'work' | 'rest' | 'transition' = 'work') => {
    editSets = [
      ...editSets,
      {
        type,
        round_label: '',
        set_label: type === 'work' ? 'New set' : 'Rest',
        reps: type === 'work' ? 0 : null,
        weight: null,
        duration_s: type === 'work' ? null : 30
      }
    ]
  }

  const computeTotals = (item: CompletedWorkout) => {
    let tonnage = 0
    let weightSum = 0
    let weightCount = 0
    const totalReps = (item.sets ?? []).reduce((sum, s) => sum + (Number(s.reps) || 0), 0)
    const totalWorkSeconds = (item.sets ?? []).reduce(
      (sum, s) => sum + ((s.type && s.type !== 'work') ? 0 : Number(s.duration_s) || 0),
      0
    )
    const totalSets = (item.sets ?? []).filter((s) => !s.type || s.type === 'work').length
    ;(item.sets ?? []).forEach((s) => {
      const isWork = !s.type || s.type === 'work'
      if (!isWork) return
      const reps = Number(s.reps) || 0
      const weight = Number(s.weight) || 0
      if (reps && weight) {
        tonnage += reps * weight
        weightSum += weight
        weightCount += 1
      }
    })
    return {
      totalReps,
      totalWorkSeconds,
      totalSets,
      tonnage,
      avgWeight: weightCount ? weightSum / weightCount : null
    }
  }

  const formatShort = (seconds?: number | null) => {
    if (!seconds || seconds <= 0) return ''
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return `${mins}m ${secs}s`
  }

  const formatSignedSeconds = (value: number) => {
    if (!value) return ''
    const sign = value > 0 ? '+' : '-'
    const abs = Math.abs(value)
    return `${sign}${formatShort(abs)}`
  }

  const formatSignedTonnage = (value: number) => {
    if (!value) return ''
    const sign = value > 0 ? '+' : '-'
    const abs = Math.round(Math.abs(value))
    return `${sign}${abs.toLocaleString()}`
  }

  const computeHrSharedRange = (
    srcSamples: { hr: number }[] = [],
    tgtSamples: { hr: number }[] = []
  ) => {
    if (!srcSamples.length || !tgtSamples.length) return null
    const vals = [...srcSamples, ...tgtSamples].map((p) => Number(p.hr)).filter((n) => Number.isFinite(n))
    if (!vals.length) return null
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const padding = Math.max(8, Math.round((max - min) * 0.15))
    return { min: min - padding, max: max + padding }
  }

  const copyCsv = async (item: CompletedWorkout) => {
    const rows = [
      ['Round', 'Set', 'Type', 'Duration(s)', 'Reps', 'Weight', 'RPE']
    ]
    ;(item.sets ?? []).forEach((s) => {
      rows.push([
        String(s.round_label ?? ''),
        String(s.set_label ?? ''),
        String(s.type ?? 'work'),
        s.duration_s !== null && s.duration_s !== undefined ? String(s.duration_s) : '',
        s.reps !== null && s.reps !== undefined ? String(s.reps) : '',
        s.weight !== null && s.weight !== undefined ? String(s.weight) : '',
        s.rpe !== null && s.rpe !== undefined ? String(s.rpe) : ''
      ])
    })
    const csv = rows
      .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    try {
      await navigator.clipboard.writeText(csv)
      pushToast('Copied CSV', 'success')
    } catch {
      pushToast('Copy failed', 'error')
    }
  }

  const loadInTimer = (item: CompletedWorkout) => {
    if (!item.workout_id || !browser) return
    window.location.href = `/timer?workout=${encodeURIComponent(item.workout_id)}`
  }

  const loadInBigPicture = (item: CompletedWorkout) => {
    if (!item.workout_id || !browser) return
    window.location.href = `/big-picture?workout=${encodeURIComponent(item.workout_id)}`
  }

  const drawPill = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    options: { fill: string; stroke: string; textColor: string; paddingX?: number; paddingY?: number; radius?: number }
  ) => {
    const paddingX = options.paddingX ?? 10
    const paddingY = options.paddingY ?? 6
    const radius = options.radius ?? 12
    const metrics = ctx.measureText(text)
    const w = metrics.width + paddingX * 2
    const h = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent + paddingY * 2
    const r = radius
    ctx.fillStyle = options.fill
    ctx.strokeStyle = options.stroke
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = options.textColor
    ctx.fillText(text, x + paddingX, y + h - paddingY - 4)
    return { width: w, height: h }
  }

  const mergeRests = (list: CompletedSet[]) => {
    const merged: CompletedSet[] = []
    let buffer: CompletedSet | null = null
    list.forEach((s) => {
      const isRest = s.type && s.type !== 'work'
      if (!isRest) {
        if (buffer) {
          merged.push(buffer)
          buffer = null
        }
        merged.push(s)
        return
      }
      const duration = s.duration_s ?? 0
      if (!buffer) {
        buffer = { ...s, duration_s: duration }
      } else {
        buffer.duration_s = (buffer.duration_s ?? 0) + duration
      }
    })
    if (buffer) merged.push(buffer)
    return merged
  }

  const saveShareCard = async (
    item: CompletedWorkout,
    opts?: {
      renderMode?: 'detailed' | 'summary'
      showReps?: boolean
      showWork?: boolean
      showSets?: boolean
      showDividers?: boolean
      showTagPills?: boolean
      showNoise?: boolean
      colorCodeRests?: boolean
      showBadge?: boolean
      showHrBlock?: boolean
      hrData?: { avgHr?: number | null; maxHr?: number | null; samples?: { t: number; hr: number }[] }
      highlights?: Set<number>
      previewEl?: HTMLImageElement
    }
  ) => {
    if (!browser) return
    const summary = buildWorkoutSummary(item.sets)
    const { totalReps, totalWorkSeconds, totalSets } = computeTotals(item)
    const filtered = (item.sets ?? []).filter((s) => (s.type ?? '').toLowerCase() !== 'prep')
    const sets = mergeRests(filtered)
    const rowHeight = 88
    const maxRows = 28
    const rowsForHeight = Math.min(sets.length || 1, maxRows)
    const width = 1200
    const pad = 60
    const dividerGap = opts?.renderMode === 'summary' ? 0 : opts?.showDividers === false ? 0 : 18
    let dividerCount = 0
    if (!opts?.renderMode || opts.renderMode === 'detailed') {
      if (opts?.showDividers ?? true) {
        let prevRound: string | null = null
        for (const s of sets.slice(0, rowsForHeight)) {
          const curr = s.round_label ?? ''
          if (curr && prevRound && curr !== prevRound) dividerCount += 1
          if (curr) prevRound = curr
        }
      }
    }
    const renderSummary = opts?.renderMode === 'summary'
    const headerBlock = 260
    let rowsHeight = 0
    if (renderSummary) {
      const measureCtx = document.createElement('canvas').getContext('2d')
      const chipH = 42
      const outerPadX = 12
      const pillPadX = 10
      const innerGap = 10
      if (measureCtx) {
        const startX = pad + 52
        const endX = width - pad - 52
        const maxWidth = endX - startX
        let y = 34 // after "Summary" title

        const workText = (it: any) => {
          const base = it.work || it.baseRaw || ''
          return it.count && it.count > 1 ? `${it.count} × ${base}` : base
        }

        const measureChip = (it: any) => {
          let w = outerPadX * 2
          let hasPrior = false
          if (it.label) {
            measureCtx.font = '600 21px "Inter", system-ui, -apple-system, sans-serif'
            w += measureCtx.measureText(it.label).width
            hasPrior = true
          }
          const wText = workText(it)
          if (wText) {
            if (hasPrior) w += innerGap
            measureCtx.font = '21px "Inter", system-ui, -apple-system, sans-serif'
            w += measureCtx.measureText(wText).width + pillPadX * 2
            hasPrior = true
          }
          if (it.on || it.off) {
            if (hasPrior) w += innerGap
            const on = (it.on || '').trim()
            const off = (it.off || '').trim()
            const restText = on && off ? `${on} / ${off}` : on || off
            measureCtx.font = '21px "Inter", system-ui, -apple-system, sans-serif'
            w += measureCtx.measureText(restText).width + pillPadX * 2
          }
          return w
        }

        summary.blocks.forEach((block) => {
          y += 18 // block top gap
          measureCtx.font = '24px "Inter", system-ui, -apple-system, sans-serif'
          y += 28 // title height
          let x = startX
          block.items.forEach((it) => {
            const w = measureChip(it)
            if (x + w > startX + maxWidth) {
              x = startX
              y += chipH + 10
            }
            x += w + 10
          })
          y += chipH + 12
        })
        rowsHeight = y + 60
      } else {
        rowsHeight = 320
      }
    } else {
      rowsHeight = rowsForHeight * rowHeight + dividerCount * dividerGap + 80
    }

    const height = Math.max(renderSummary ? 620 : 750, pad + headerBlock + rowsHeight + pad)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const surface1 = getCssColor('--color-surface-1', '#0c1220')
    const surface2 = getCssColor('--color-surface-2', '#0d2038')
    const border = getCssColor('--color-border', 'rgba(255,255,255,0.12)')
    const textPrimary = getCssColor('--color-text-primary', '#f8fbff')
    const textMuted = getCssColor('--color-text-muted', 'rgba(255,255,255,0.7)')
    const accent = getCssColor('--color-accent', '#4dabf7')
    const isLightTheme = luminance(parseRgb(surface1)) > 0.5

    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, surface2)
    gradient.addColorStop(1, surface1)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    // Card container
    const cardWidth = width - pad * 2
    const cardHeight = height - pad * 2
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.strokeStyle = border
    ctx.lineWidth = 2
    const radius = 28
    const r = radius
    ctx.beginPath()
    ctx.moveTo(pad + r, pad)
    ctx.lineTo(pad + cardWidth - r, pad)
    ctx.quadraticCurveTo(pad + cardWidth, pad, pad + cardWidth, pad + r)
    ctx.lineTo(pad + cardWidth, pad + cardHeight - r)
    ctx.quadraticCurveTo(pad + cardWidth, pad + cardHeight, pad + cardWidth - r, pad + cardHeight)
    ctx.lineTo(pad + r, pad + cardHeight)
    ctx.quadraticCurveTo(pad, pad + cardHeight, pad, pad + cardHeight - r)
    ctx.lineTo(pad, pad + r)
    ctx.quadraticCurveTo(pad, pad, pad + r, pad)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    // HR helpers (used for tags positioning and block)
    const hrSamplesPreview = opts?.hrData?.samples ?? []
    const hrActive =
      (opts?.showHrBlock ?? true) &&
      opts?.hrData &&
      (opts.hrData.avgHr || opts.hrData.maxHr || hrSamplesPreview.length)
    const hrPanelW = 360
    const hrPanelH = 170
    const hrPanelX = pad + cardWidth - hrPanelW - 20
    const hrPanelY = pad + 115

    // Text helpers
    const title = item.title ?? 'Workout'
    const dateStr = formatDate(item.started_at || item.created_at)
    const durationStr = formatShort(item.duration_s)
    const tags = (item.tags ?? []).slice(0, 4)

    ctx.fillStyle = textPrimary
    ctx.font = 'bold 50px "Inter", system-ui, -apple-system, sans-serif'
    ctx.fillText(title, pad + 36, pad + 80)

    ctx.font = '25px "Inter", system-ui, -apple-system, sans-serif'
    ctx.fillStyle = textMuted
    ctx.fillText(dateStr, pad + 36, pad + 120)
    if (durationStr) {
      ctx.fillText(`Duration: ${durationStr}`, pad + 36, pad + 152)
    }

    // Stats pills
    const pillY = pad + 190
    const pills = []
    if (opts?.showReps ?? true) pills.push({ label: 'Reps', value: totalReps ? totalReps.toString() : '-' })
    if (opts?.showWork ?? true) pills.push({ label: 'Work time', value: totalWorkSeconds ? formatShort(totalWorkSeconds) : '-' })
    if (opts?.showSets ?? true) pills.push({ label: 'Sets', value: totalSets ? totalSets.toString() : '-' })
    let pillX = pad + 36
    pills.forEach((p) => {
      const text = `${p.label}: ${p.value}`
      ctx.font = '22px "Inter", system-ui, -apple-system, sans-serif'
      const w = ctx.measureText(text).width + 30
      const h = 40
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(pillX, pillY, w, h, 14)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = textPrimary
      ctx.fillText(text, pillX + 15, pillY + 27)
      pillX += w + 14
    })

    // Tags
    if (tags.length) {
      ctx.font = '20px "Inter", system-ui, -apple-system, sans-serif'
      const label = 'Tags:'
      const labelW = ctx.measureText(label).width + 10
      let tagY = hrActive ? hrPanelY + hrPanelH + 16 : pillY + 20
      let tagX = hrActive ? hrPanelX + hrPanelW - 20 : pad + cardWidth - 52 // avoid overlapping HR card
      // place from right to left
      for (let i = tags.length - 1; i >= 0; i--) {
        const txt = `#${tags[i]}`
        const w = ctx.measureText(txt).width + 26
        tagX -= w
        if (opts?.showTagPills ?? true) {
          ctx.fillStyle = 'rgba(255,255,255,0.1)'
          ctx.strokeStyle = 'rgba(255,255,255,0.2)'
          ctx.beginPath()
          ctx.roundRect(tagX, tagY, w, 34, 12)
          ctx.fill()
          ctx.stroke()
          ctx.fillStyle = textPrimary
          ctx.fillText(txt, tagX + 12, tagY + 24)
        } else {
          ctx.fillStyle = textPrimary
          ctx.fillText(txt, tagX, tagY + 24)
        }
        tagX -= 8
      }
      // label to the left of pills
      tagX -= labelW
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      ctx.fillText(label, tagX, tagY + 24)
    }

    // HR block (top right)
    if (hrActive && opts?.hrData) {
      const hrSamples = opts.hrData.samples ?? []
      if (opts.hrData.avgHr || opts.hrData.maxHr || hrSamples.length) {
        const panelBg = isLightTheme ? 'rgba(0,0,0,0.03)' : toRgba(textPrimary, 0.05)
        const panelBorder = isLightTheme ? 'rgba(0,0,0,0.14)' : toRgba(textPrimary, 0.12)
        const plotBg = isLightTheme ? 'rgba(0,0,0,0.02)' : toRgba(textPrimary, 0.02)
        const plotBorder = isLightTheme ? 'rgba(0,0,0,0.1)' : toRgba(textPrimary, 0.08)
        const avgLineColor = isLightTheme ? 'rgba(0,0,0,0.35)' : toRgba(textMuted, 0.35)
        const lineColor = isLightTheme ? 'rgba(0,0,0,0.75)' : toRgba(textPrimary, 0.9)
        const maxDotColor = toRgba(accent, 0.9)

        ctx.fillStyle = panelBg
        ctx.strokeStyle = panelBorder
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.roundRect(hrPanelX, hrPanelY, hrPanelW, hrPanelH, 14)
        ctx.fill()
        ctx.stroke()
        // header stats
        ctx.font = '18px "Inter", system-ui, -apple-system, sans-serif'
        ctx.fillStyle = textMuted
        ctx.fillText('HR', hrPanelX + 12, hrPanelY + 24)
        ctx.textAlign = 'right'
        ctx.fillText(
          `${opts.hrData.avgHr ? `Avg ${opts.hrData.avgHr} bpm` : ''}${
            opts.hrData.maxHr ? `  Max ${opts.hrData.maxHr} bpm` : ''
          }`,
          hrPanelX + hrPanelW - 12,
          hrPanelY + 24
        )
        ctx.textAlign = 'left'
        // plot area
        const plotX = hrPanelX + 12
        const plotY = hrPanelY + 36
        const plotW = hrPanelW - 24
        const plotH = hrPanelH - 48
        ctx.fillStyle = plotBg
        ctx.strokeStyle = plotBorder
        ctx.beginPath()
        ctx.roundRect(plotX, plotY, plotW, plotH, 12)
        ctx.fill()
        ctx.stroke()
        if (hrSamples.length) {
          const maxT = Math.max(...hrSamples.map((p) => p.t), 1)
          const minHrRaw = Math.min(...hrSamples.map((p) => p.hr))
          const maxHrRaw = Math.max(...hrSamples.map((p) => p.hr))
          const padding = Math.max(8, Math.round((maxHrRaw - minHrRaw) * 0.15))
          const minHr = minHrRaw - padding
          const maxHr = maxHrRaw + padding
          const avgLine = opts.hrData.avgHr ?? null
          const maxPoint = hrSamples.reduce((acc, p) => (p.hr > acc.hr ? p : acc), hrSamples[0])
          // avg line
          if (avgLine) {
            const y =
              plotY + plotH - ((avgLine - minHr) / Math.max(1, maxHr - minHr)) * plotH
            ctx.strokeStyle = avgLineColor
            ctx.setLineDash([4, 4])
            ctx.beginPath()
            ctx.moveTo(plotX, y)
            ctx.lineTo(plotX + plotW, y)
            ctx.stroke()
            ctx.setLineDash([])
          }
          // polyline
          ctx.strokeStyle = lineColor
          ctx.lineWidth = 2
          ctx.beginPath()
          hrSamples.forEach((p, idx) => {
            const x = plotX + (p.t / maxT) * plotW
            const y = plotY + plotH - ((p.hr - minHr) / Math.max(1, maxHr - minHr)) * plotH
            if (idx === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          })
          ctx.stroke()
          // max point
          const mx = plotX + (maxPoint.t / maxT) * plotW
          const my = plotY + plotH - ((maxPoint.hr - minHr) / Math.max(1, maxHr - minHr)) * plotH
          ctx.fillStyle = maxDotColor
          ctx.beginPath()
          ctx.arc(mx, my, 4.5, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    // Column measurements for rows
    ctx.font = '21px "Inter", system-ui, -apple-system, sans-serif'
    const longestRoundPx =
      sets.reduce((max, s) => Math.max(max, ctx.measureText(s.round_label ?? '').width), 0) + 18
    const roundCol = Math.max(90, Math.min(260, longestRoundPx + 12))
    const durationCol = 130
    const repsCol = 115
    const weightCol = 125
    const rpeCol = 110
    const gutter = 8
    const startX = pad + 52
    const endX = pad + cardWidth - 52
    const metricsWidth = durationCol + repsCol + weightCol + rpeCol + gutter * 4
    const labelCol = Math.max(180, endX - startX - roundCol - metricsWidth - gutter * 3)

    // Sets (capped for space)
    const listY = pillY + 120

    if (renderSummary) {
      let yCursor = listY
      ctx.font = '30px "Inter", system-ui, -apple-system, sans-serif'
      ctx.fillStyle = textPrimary
      ctx.fillText('Summary', startX, yCursor)
      yCursor += 34
      ctx.textBaseline = 'middle'
      const maxWidth = endX - startX
      const chipH = 42
      const outerPadX = 12
      const pillPadX = 10
      const innerGap = 10
      const workText = (it: any) => {
        const base = it.work || it.baseRaw || ''
        return it.count && it.count > 1 ? `${it.count} × ${base}` : base
      }
      const restTextFor = (it: any) => {
        const on = (it.on || '').trim()
        const off = (it.off || '').trim()
        return on && off ? `${on} / ${off}` : on || off
      }

      summary.blocks.forEach((block) => {
        yCursor += 18
        ctx.font = '24px "Inter", system-ui, -apple-system, sans-serif'
        ctx.fillStyle = textPrimary
        ctx.fillText(block.title, startX, yCursor)
        yCursor += 28
        let x = startX
        ctx.font = '21px "Inter", system-ui, -apple-system, sans-serif'
        block.items.forEach((it) => {
          ctx.textBaseline = 'middle'
          // measure width
          let w = outerPadX * 2
          let hasPrior = false
          if (it.label) {
            ctx.font = '600 21px "Inter", system-ui, -apple-system, sans-serif'
            w += ctx.measureText(it.label).width
            hasPrior = true
          }
          const wText = workText(it)
          if (wText) {
            if (hasPrior) w += innerGap
            ctx.font = '21px "Inter", system-ui, -apple-system, sans-serif'
            w += ctx.measureText(wText).width + pillPadX * 2
            hasPrior = true
          }
          const restText = restTextFor(it)
          if (restText) {
            if (hasPrior) w += innerGap
            ctx.font = '21px "Inter", system-ui, -apple-system, sans-serif'
            w += ctx.measureText(restText).width + pillPadX * 2
          }
          if (x + w > startX + maxWidth) {
            x = startX
            yCursor += chipH + 10
          }
          // outer chip
          ctx.fillStyle = 'rgba(255,255,255,0.08)'
          ctx.strokeStyle = 'rgba(255,255,255,0.15)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.roundRect(x, yCursor, w, chipH, 12)
          ctx.fill()
          ctx.stroke()
          let cursor = x + outerPadX
          const centerY = yCursor + chipH / 2
          if (it.label) {
            ctx.font = '600 21px "Inter", system-ui, -apple-system, sans-serif'
            ctx.fillStyle = textPrimary
            ctx.fillText(it.label, cursor, centerY + 1)
            cursor += ctx.measureText(it.label).width
            cursor += innerGap
          }
          if (wText) {
            const pillW = ctx.measureText(wText).width + pillPadX * 2
            const pillH = chipH - 10
            ctx.fillStyle = 'rgba(255,255,255,0.12)'
            ctx.strokeStyle = 'rgba(255,255,255,0.18)'
            ctx.beginPath()
            ctx.roundRect(cursor, yCursor + (chipH - pillH) / 2, pillW, pillH, 10)
            ctx.fill()
            ctx.stroke()
            ctx.font = '21px "Inter", system-ui, -apple-system, sans-serif'
            ctx.fillStyle = textPrimary
            ctx.fillText(wText, cursor + pillPadX, centerY + 1)
            cursor += pillW + innerGap
          }
          if (restText) {
            const pillW = ctx.measureText(restText).width + pillPadX * 2
            const pillH = chipH - 10
            ctx.fillStyle = 'rgba(255,255,255,0.08)'
            ctx.strokeStyle = 'rgba(255,255,255,0.15)'
            ctx.beginPath()
            ctx.roundRect(cursor, yCursor + (chipH - pillH) / 2, pillW, pillH, 10)
            ctx.fill()
            ctx.stroke()
            ctx.font = '21px "Inter", system-ui, -apple-system, sans-serif'
            const on = (it.on || '').trim()
            const off = (it.off || '').trim()
            ctx.fillStyle = textPrimary
            if (on && off) {
              const onW = ctx.measureText(on).width
              ctx.fillText(on, cursor + pillPadX, centerY + 1)
              const slash = ' / '
              const slashW = ctx.measureText(slash).width
              ctx.fillText(slash, cursor + pillPadX + onW, centerY + 1)
              ctx.fillStyle = toRgba(textPrimary, 0.7)
              ctx.fillText(off, cursor + pillPadX + onW + slashW, centerY + 1)
            } else {
              ctx.fillText(restText, cursor + pillPadX, centerY + 1)
            }
            cursor += pillW + innerGap
          }
          x += w + 10
        })
        yCursor += chipH + 12
      })
      ctx.textBaseline = 'alphabetic'
    } else {
      ctx.font = '30px "Inter", system-ui, -apple-system, sans-serif'
      ctx.fillStyle = textPrimary
      ctx.fillText('Session', startX, listY)
      const rows = sets.slice(0, maxRows)
      ctx.font = '21px "Inter", system-ui, -apple-system, sans-serif'
      ctx.textBaseline = 'middle'
      let lastRound = ''
      let yCursor = listY + 38
      rows.forEach((s, i) => {
        const isRest = s.type && s.type !== 'work'
        const roundLabel = !isRest ? s.round_label ?? '' : ''
        if ((opts?.showDividers ?? true) && roundLabel && lastRound && roundLabel !== lastRound) {
          yCursor += dividerGap
          const lineWidth = 5
          const lineRadius = 8
          const dividerWidth = (endX - startX) * 0.7
          const x = startX + (endX - startX - dividerWidth) / 2
          const y = yCursor - dividerGap / 2 - lineWidth / 2
          ctx.fillStyle = 'rgba(255,255,255,0.16)'
          const w = dividerWidth
          const h = lineWidth
          ctx.beginPath()
          ctx.moveTo(x + lineRadius, y)
          ctx.lineTo(x + w - lineRadius, y)
          ctx.quadraticCurveTo(x + w, y, x + w, y + lineRadius)
          ctx.lineTo(x + w, y + h - lineRadius)
          ctx.quadraticCurveTo(x + w, y + h, x + w - lineRadius, y + h)
          ctx.lineTo(x + lineRadius, y + h)
          ctx.quadraticCurveTo(x, y + h, x, y + h - lineRadius)
          ctx.lineTo(x, y + lineRadius)
          ctx.quadraticCurveTo(x, y, x + lineRadius, y)
          ctx.closePath()
          ctx.fill()
        }
        const rowTop = yCursor
        const rowCenter = rowTop + rowHeight / 2
        const label = isRest ? 'Rest' : s.set_label ?? s.round_label ?? `Set ${i + 1}`
        const duration = s.duration_s ? formatShort(s.duration_s) : ''
        const reps =
          !isRest && s.reps !== null && s.reps !== undefined ? `${s.reps} reps` : ''
        const weight =
          !isRest && s.weight !== null && s.weight !== undefined ? `@ ${s.weight}` : ''
        const rpe = !isRest && s.rpe !== null && s.rpe !== undefined ? `RPE ${s.rpe}` : ''
        const isHighlighted = opts?.highlights ? opts.highlights.has(i) : false
        lastRound = roundLabel || lastRound

        // row background
        const inset = 20
        const restBg = opts?.colorCodeRests ?? true ? 'rgba(255, 170, 120, 0.12)' : 'rgba(255,255,255,0.07)'
        const workBg = i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.07)'
        ctx.fillStyle = isHighlighted ? 'rgba(255,255,255,0.12)' : isRest ? restBg : workBg
        ctx.fillRect(startX - inset, rowTop + 4, endX - startX + inset * 2, rowHeight - 10)

        // Round
        ctx.font = '23px "Inter", system-ui, -apple-system, sans-serif'
        ctx.fillStyle = textMuted
        if (roundLabel) {
          ctx.save()
          ctx.beginPath()
          ctx.rect(startX, rowTop - 8, roundCol, rowHeight + 10)
          ctx.clip()
          ctx.fillText(roundLabel, startX, rowCenter)
          ctx.restore()
        }

        // Label
        ctx.font = '25px "Inter", system-ui, -apple-system, sans-serif'
        ctx.fillStyle = isRest ? textMuted : textPrimary
        const labelX = startX + roundCol + gutter
        ctx.save()
        ctx.beginPath()
        ctx.rect(labelX, rowTop - 8, labelCol, rowHeight + 10)
        ctx.clip()
        ctx.fillText(label, labelX, rowCenter)
        ctx.restore()

        // Metrics columns (right aligned within fixed widths)
        ctx.font = '25px "Inter", system-ui, -apple-system, sans-serif'
        ctx.fillStyle = isRest ? textMuted : textPrimary
        let metricX = endX
        const drawMetric = (text: string, width: number) => {
          ctx.save()
          ctx.textAlign = 'right'
          ctx.fillText(text, metricX, rowCenter)
          ctx.restore()
          metricX -= width + gutter
        }
        drawMetric(rpe ?? '', rpeCol)
        drawMetric(weight ?? '', weightCol)
        drawMetric(reps ?? '', repsCol)
        drawMetric(duration ?? '', durationCol)
        ctx.textAlign = 'left'
        yCursor += rowHeight
      })
      ctx.textBaseline = 'alphabetic'
    }

    // Noise overlay
    if (opts?.showNoise ?? true) {
      const noiseDensity = 0.05
      const particles = Math.floor(width * height * 0.00004)
      ctx.fillStyle = 'rgba(255,255,255,' + noiseDensity + ')'
      for (let i = 0; i < particles; i++) {
        const x = Math.random() * width
        const y = Math.random() * height
        ctx.fillRect(x, y, 1, 1)
      }
    }

    // Footer badge
    if (opts?.showBadge ?? true) {
      ctx.font = '16px "Inter", system-ui, -apple-system, sans-serif'
      const badge = 'Logged with KB Suite'
      const textW = ctx.measureText(badge).width
      const w = textW + 22
      const h = 30
      const margin = 20
      const x = pad + cardWidth - w - margin
      const y = pad + cardHeight - h - margin
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, 10)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(badge, x + w / 2, y + h / 2 + 1)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
    }

    const dataUrl = canvas.toDataURL('image/png')

    if (opts?.previewEl) {
      opts.previewEl.src = dataUrl
      return
    }
    const link = document.createElement('a')
    const slug = (title || 'workout')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    link.download = `${slug || 'workout'}-share.png`
    link.href = dataUrl
    link.click()
  }

  const deleteSet = (idx: number) => {
    editSets = editSets.filter((_, i) => i !== idx)
  }

  const requestDeleteSet = (idx: number) => {
    confirmDeleteSetIdx = idx
  }

  const moveSet = (idx: number, delta: number) => {
    const target = idx + delta
    if (target < 0 || target >= editSets.length) return
    const next = [...editSets]
    const [item] = next.splice(idx, 1)
    next.splice(target, 0, item)
    editSets = next
  }

  const copySet = (idx: number) => {
    const source = editSets[idx]
    if (!source) return
    const clone = { ...source }
    editSets = [...editSets.slice(0, idx + 1), clone, ...editSets.slice(idx + 1)]
  }

  const saveEdit = async (id: string) => {
    try {
      const res = await fetch(`/api/completed-workouts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          entries: editSets,
          startedAt: editStartedAt ? Date.parse(editStartedAt) : null,
          finishedAt: editFinishedAt ? Date.parse(editFinishedAt) : null,
          durationSeconds:
            editDurationMinutes !== null && editDurationMinutes !== undefined
              ? editDurationMinutes * 60
              : null,
          notes: editNotes,
          rpe: editRpe,
          tags: editTags
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to save')
      items = items.map((it) =>
        it.id === id
          ? {
              ...it,
              title: editTitle,
              sets: editSets,
              started_at: editStartedAt ? Date.parse(editStartedAt) : it.started_at,
              finished_at: editFinishedAt ? Date.parse(editFinishedAt) : it.finished_at,
              duration_s:
                editDurationMinutes !== null && editDurationMinutes !== undefined
                  ? editDurationMinutes * 60
                  : it.duration_s,
              notes: editNotes,
              rpe: editRpe,
              tags: [...editTags]
            }
          : it
      )
      pushToast('Session updated.', 'success')
      cancelEdit()
    } catch (err) {
      pushToast((err as any)?.message ?? 'Save failed', 'error')
    }
  }

  const formatDate = (value?: number | null) => {
    if (!value) return 'Unknown'
    try {
      return new Date(value).toLocaleString()
    } catch {
      return 'Unknown'
    }
  }

  const formatDuration = (seconds?: number | null) => {
    if (!seconds || seconds <= 0) return ''
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return `${mins}m ${secs}s`
  }

  const toLocalDatetimeInput = (ts: number) => {
    try {
      const d = new Date(ts)
      const offset = d.getTimezoneOffset()
      const local = new Date(d.getTime() - offset * 60 * 1000)
      return local.toISOString().slice(0, 16)
    } catch {
      return ''
    }
  }

  onMount(loadHistory)
  onMount(async () => {
    await loadTemplates()
  })
  onMount(() => {
    computeHrSparkColors()
    if (!browser) return
    const observer = new MutationObserver(() => computeHrSparkColors())
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  })

  $: if (browser) {
    const anyModalOpen =
      !!hrRemoveTarget ||
      !!confirmDeleteId ||
      !!shareItem ||
      templateModalOpen ||
      insightsModalOpen ||
      compareModalOpen ||
      confirmDeleteSetIdx !== null
    document.body.classList.toggle('modal-open', anyModalOpen)
  }

  $: hrRemoveSession = hrRemoveTarget ? items.find((i) => i.id === hrRemoveTarget) ?? null : null
  $: confirmDeleteSession = confirmDeleteId ? items.find((i) => i.id === confirmDeleteId) ?? null : null

  onDestroy(() => {
    if (browser) document.body.classList.remove('modal-open')
  })

  const refreshSharePreview = async () => {
    if (!browser || !shareItem) return
    // Build rows exactly as the renderer uses (filtered/merged)
    const filtered = (shareItem.sets ?? []).filter((s) => (s.type ?? '').toLowerCase() !== 'prep')
    const merged = mergeRests(filtered)
    sharePreviewRows = merged
    const selectable = merged
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => !s.type || s.type === 'work')
      .map(({ s, idx }) => ({
        label: s.set_label ?? s.round_label ?? `Set ${idx + 1}`,
        index: idx
      }))
    shareSelectableRows = selectable
    // prune highlights to valid indices
    const valid = new Set(selectable.map((r) => r.index))
    shareHighlights = new Set([...shareHighlights].filter((i) => valid.has(i)))
    const img = new Image()
    const hrData = hrDetails[shareItem.id] ?? hrSummary[shareItem.id]
    await saveShareCard(shareItem, {
      renderMode: shareRenderMode,
      showReps: shareShowReps,
      showWork: shareShowWork,
      showSets: shareShowSets,
      showDividers: shareShowDividers,
      showTagPills: shareShowTagPills,
      showNoise: shareShowNoise,
      colorCodeRests: shareColorCodeRests,
      showBadge: shareShowBadge,
      showHrBlock: shareShowHrBlock,
      hrData,
      highlights: shareHighlightEnabled ? shareHighlights : new Set(),
      previewEl: img
    })
    sharePreviewUrl = img.src
  }

  $: shareHighlightsKey = JSON.stringify([...shareHighlights])

  $: if (shareItem) {
    const longest =
      shareItem.sets?.reduce((max, s) => Math.max(max, (s.round_label ?? '').length), 0) ?? 0
    shareRoundCol = Math.max(80, Math.min(180, longest * 8 + 16))
    // react to toggles as well
    shareShowReps && shareShowWork && shareShowSets // no-op to create dependencies
    shareShowDividers &&
      shareShowTagPills &&
      shareShowNoise &&
      shareColorCodeRests &&
      shareShowBadge &&
      shareShowHrBlock &&
      shareRenderMode
    shareHighlightEnabled && shareHighlightsKey
    refreshSharePreview()
  }
</script>

<div class="history-page">
  <header>
    <h1>History</h1>
  </header>

  {#if loading}
    <p>Loading…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if items.length === 0}
    <p>No completed workouts yet.</p>
  {:else}
    <div class="toolbar">
      <button class="ghost" on:click={createEmptyCompletedWorkout}>New empty session log</button>
      <button class="ghost" on:click={() => (templateModalOpen = true)}>From template</button>
      <button class="ghost" on:click={() => (insightsModalOpen = true)}>Insights</button>
      <div class="filters">
        <input
          type="search"
          placeholder="Search title, notes, labels…"
          bind:value={searchTerm}
        />
        <select bind:value={dateFilter}>
          <option value="all">All time</option>
          <option value="7">Past 7 days</option>
          <option value="30">Past 30 days</option>
        </select>
        <select bind:value={sortBy} class="compact">
          <option value="dateDesc">Newest first</option>
          <option value="dateAsc">Oldest first</option>
          <option value="durationDesc">Longest duration</option>
          <option value="durationAsc">Shortest duration</option>
          <option value="hrDesc">Highest avg HR</option>
          <option value="rpeDesc">Highest RPE</option>
        </select>
        <label class="inline-filter">
          <input type="checkbox" bind:checked={filterHasHr} />
          Has HR
        </label>
        {#if availableTags.length}
          <div class="tag-filter">
            {#each availableTags as tag}
              <button
                class:selected={selectedTags.includes(tag)}
                class="tag-chip"
                type="button"
                on:click={() => toggleFilterTag(tag)}
              >
                {tag}
              </button>
            {/each}
          </div>
        {/if}
        <div class="view-toggle">
          <button class:active={viewMode === 'list'} on:click={() => (viewMode = 'list')}>List</button>
          <button class:active={viewMode === 'calendar'} on:click={() => (viewMode = 'calendar')}>
            Calendar
          </button>
        </div>
      </div>
    </div>

    {#if viewMode === 'calendar'}
      <section class="calendar-shell">
        <div class="week-head mobile-only">
          <div class="month-nav">
            <button class="ghost" on:click={() => shiftWeek(-1)}>←</button>
            <strong>{weekLabel(mobileWeekStart)}</strong>
            <button class="ghost" on:click={() => shiftWeek(1)}>→</button>
          </div>
          <p class="muted small">
            Showing {selectedDayItems.length} session{selectedDayItems.length === 1 ? '' : 's'} this week (filters applied).
          </p>
        </div>
        <div class="week-list mobile-only">
          {#each mobileWeekDays as dayInfo}
            {@const itemsForDay = dailyBuckets[dayInfo.key] ?? []}
            <button
              type="button"
              class="week-row"
              class:active={selectedDateKey === dayInfo.key}
              on:click={() => selectDate(dayInfo.key)}
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
                    {@const dur = it.duration_s || 0}
                    {@const hrTag = hrAttached[it.id] || hrSummary[it.id]}
                    <div class="week-row__item">
                      <span class="dot" style={`opacity:${Math.min(1, dur / 3600 + 0.3)}`}></span>
                      <span class="week-row__title">{it.title || 'Workout'}</span>
                      <div class="week-row__meta">
                        <span class="day-row-badge">{dur ? formatShort(dur) : '-'}</span>
                        {#if hrTag}<span class="day-row-hr">HR</span>{/if}
                      </div>
                    </div>
                  {/each}
                </div>
              {:else}
                <p class="muted tiny">No workouts</p>
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
          <p class="muted small">
            Showing {monthItems.length} session{monthItems.length === 1 ? '' : 's'} in this month (filters applied).
          </p>
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
            {@const itemsForDay = dailyBuckets[key] ?? []}
            <button
              type="button"
              class="day"
              class:active={selectedDateKey === key}
              on:click={() => selectDate(key)}
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
                    {@const dur = it.duration_s || 0}
                    {@const hrTag = hrAttached[it.id] || hrSummary[it.id]}
                    <div class="day-row" title={`${it.title || 'Workout'}${dur ? ` · ${formatShort(dur)}` : ''}${hrTag ? ' · HR attached' : ''}`}>
                      <span class="dot" style={`opacity:${Math.min(1, dur / 3600 + 0.3)}`}></span>
                      <div class="day-row-body">
                        <span class="day-row-title">{it.title || 'Workout'}</span>
                        <div class="day-row-meta">
                          <span class="day-row-badge">{dur ? formatShort(dur) : '-'}</span>
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
      <div class="calendar-detail">
        {#if selectedDayItems.length === 0}
          <p class="muted small">Select a day to view sessions.</p>
        {:else}
          <h4>
            {selectedDateKey}
            <span class="muted small">({selectedDayItems.length} session{selectedDayItems.length === 1 ? '' : 's'})</span>
          </h4>
          <div class="list compact-list">
            {#each selectedDayItems as item}
              {@const totals = computeTotals(item)}
              {@const isExpanded = editingId === item.id || expanded[item.id]}
              {@const summary = buildWorkoutSummary(item.sets)}
              <article class="card">
                <div class="card-header two-col">
                  <div class="header-left">
                    {#if editingId === item.id}
                      <input
                        class="title-input"
                        bind:value={editTitle}
                        placeholder="Workout title"
                      />
                    {:else}
                      <h3>{item.title || 'Workout'}</h3>
                    {/if}
                    <div class="meta-row">
                      <span class="muted small">{formatDate(item.started_at || item.created_at)}</span>
                      {#if item.duration_s}
                        <span class="badge subtle">{formatDuration(item.duration_s)}</span>
                      {/if}
                    </div>
                    {#if item.tags?.length}
                      <div class="tag-row inline">
                        {#each item.tags as tag}
                          <span class="tag-chip selected">{tag}</span>
                        {/each}
                      </div>
                    {/if}
                  </div>
                  <div class="header-right">
                    <div class="summary-chips">
                      <span class="chip">{totals.totalSets || '-'} sets</span>
                      <span class="chip">{totals.totalReps || '-'} reps</span>
                      <span class="chip">{formatShort(totals.totalWorkSeconds) || '-'} work</span>
                      {#if item.rpe}<span class="chip">RPE {item.rpe}</span>{/if}
                      {#if hrSummary[item.id]}
                        <span class="chip hr">
                          HR {hrSummary[item.id].avgHr ?? '-'} / {hrSummary[item.id].maxHr ?? '-'}
                        </span>
                      {/if}
                    </div>
                    {#if hrSummary[item.id]}
                      <div class="hr-card">
                        <div class="hr-card-top">
                          <span class="muted small">HR</span>
                          <div class="hr-stats">
                            {#if hrSummary[item.id].avgHr}<span>Avg {hrSummary[item.id].avgHr} bpm</span>{/if}
                            {#if hrSummary[item.id].maxHr}<span>Max {hrSummary[item.id].maxHr} bpm</span>{/if}
                          </div>
                        </div>
                        {#if hrDetails[item.id]?.samples && hrDetails[item.id]?.samples?.length}
                          {#key hrDetails[item.id]?.samples}
                            {@const s = hrDetails[item.id]?.samples ?? []}
                            {@const maxT = Math.max(...s.map((p) => p.t), 1)}
                            {@const minHrRaw = Math.min(...s.map((p) => p.hr))}
                            {@const maxHrRaw = Math.max(...s.map((p) => p.hr))}
                            {@const padding = Math.max(8, Math.round((maxHrRaw - minHrRaw) * 0.15))}
                            {@const minHr = minHrRaw - padding}
                            {@const maxHr = maxHrRaw + padding}
                            {@const avgLine = hrSummary[item.id].avgHr ?? null}
                            {@const maxPoint = s.reduce((acc, p) => (p.hr > acc.hr ? p : acc), s[0] ?? { t: 0, hr: 0 })}
                            <svg
                              class="hr-spark"
                              viewBox="0 0 320 120"
                              preserveAspectRatio="none"
                              style:--hr-spark-bg={hrSparkColors.bg}
                              style:--hr-spark-border={hrSparkColors.border}
                              style:--hr-spark-line={hrSparkColors.line}
                              style:--hr-spark-avg={hrSparkColors.avg}
                              style:--hr-spark-max={hrSparkColors.max}
                            >
                              {#if avgLine}
                                <line
                                  class="avg-line"
                                  x1="0"
                                  x2="320"
                                  y1={120 - ((avgLine - minHr) / Math.max(1, maxHr - minHr)) * 120}
                                  y2={120 - ((avgLine - minHr) / Math.max(1, maxHr - minHr)) * 120}
                                  stroke-dasharray="4 4"
                                  stroke-width="1.25"
                                />
                              {/if}
                              <polyline
                                class="hr-line"
                                fill="none"
                                stroke-width="2"
                                points={s
                                  .map((p) => {
                                    const x = (p.t / maxT) * 320
                                    const y = 120 - ((p.hr - minHr) / Math.max(1, maxHr - minHr)) * 120
                                    return `${x},${y}`
                                  })
                                  .join(' ')}
                              />
                              {#if s.length}
                                <circle
                                  class="hr-max"
                                  cx={(maxPoint.t / maxT) * 320}
                                  cy={120 - ((maxPoint.hr - minHr) / Math.max(1, maxHr - minHr)) * 120}
                                  r="5"
                                />
                              {/if}
                            </svg>
                        {/key}
                        {/if}
                      </div>
                    {:else if item.duration_s}
                      <span class="badge">{formatDuration(item.duration_s)}</span>
                    {/if}
                  </div>
                </div>
                {#if !isExpanded}
                  {#if summary.blocks.length}
                    <div class="compact-summary rich">
                      {#each summary.blocks as block}
                        <div class="summary-block">
                          <div class="summary-title">{block.title}</div>
                          {#if block.items?.length}
                        <div class="summary-items">
                          {#each block.items as it}
                            <span class="summary-chip fancy">
                              {#if it.label}<span class="chip-label">{it.label}</span>{/if}
                              {#if it.work}
                                <span class="chip-pill">
                                  {#if it.count && it.count > 1}<span class="count">{it.count} ×</span>{/if}
                                  <span>{it.work}</span>
                                </span>
                              {:else if it.count && it.count > 1}
                                <span class="chip-pill">
                                  <span class="count">{it.count} ×</span>
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
                                {#if it.count && it.count > 1}<span class="chip-pill"><span class="count">{it.count} ×</span></span>{/if}
                                <span>{it.baseRaw}</span>
                              {/if}
                            </span>
                          {/each}
                        </div>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {:else if summary.text}
                    <div class="compact-summary">
                      {#each summary.text.split('\n') as line}
                        <div class="summary-line">{line}</div>
                      {/each}
                    </div>
                  {/if}
                {/if}
                {#if editingId === item.id}
                  <div class="meta-edit">
                    <label>
                      <span class="muted small">Started at</span>
                      <input type="datetime-local" bind:value={editStartedAt} />
                    </label>
                    <label>
                      <span class="muted small">Finished at</span>
                      <input type="datetime-local" bind:value={editFinishedAt} />
                    </label>
                    <label>
                      <span class="muted small">Duration (minutes)</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        bind:value={editDurationMinutes}
                        placeholder="auto"
                      />
                    </label>
                    <label>
                      <span class="muted small">Session RPE</span>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        step="1"
                        bind:value={editRpe}
                        placeholder="1-10"
                      />
                    </label>
                    <label class="notes-field">
                      <span class="muted small">Notes</span>
                      <input
                        type="text"
                        bind:value={editNotes}
                        placeholder='e.g., "jerks felt heavy"'
                      />
                    </label>
                    <label class="tags-field">
                      <span class="muted small">Tags</span>
                      <div class="tag-editor">
                        {#each editTags as tag}
                          <span class="tag-chip selected">
                            {tag}
                            <button class="ghost icon-btn" aria-label="Remove tag" on:click={() => removeTag(tag)}>
                              ×
                            </button>
                          </span>
                        {/each}
                        <div class="tag-input-wrap">
                          <input
                            type="text"
                            placeholder="Add tag"
                            bind:value={newTagInput}
                            on:keydown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                addTag()
                              }
                            }}
                          />
                          <button class="ghost small" type="button" on:click={addTag}>Add</button>
                        </div>
                      </div>
                    </label>
                  </div>
                {:else}
                  {#if item.notes}
                    <p class="muted small">Notes: {item.notes}</p>
                  {/if}
                {/if}
                {#if editingId === item.id}
                  <div class="sets">
                    <div class="set-grid-labels desktop-only">
                      <span></span>
                      <span></span>
                      <span>Duration (sec)</span>
                      <span>Reps</span>
                      <span>Weight</span>
                      <span>RPE</span>
                      <span>Actions</span>
                    </div>
                    {#each editSets as set, idx}
                      {@const isRest = set.type && set.type !== 'work'}
                      <div class="set-row edit-row" class:rest-row={isRest}>
                        <div class="row-main" class:rest-row={isRest}>
                          {#if isRest}
                            <span class="desktop-only"></span>
                            <span class="desktop-only"></span>
                            <div class="field">
                              <span class="mobile-label">Rest (sec)</span>
                              <input
                                class="duration-input narrow"
                                type="number"
                                min="0"
                                placeholder="sec"
                                value={set.duration_s ?? ''}
                                on:input={(e) => {
                                  const val = e.currentTarget.value.trim()
                                  updateSetField(idx, { duration_s: val === '' ? null : Number(val) })
                                }}
                              />
                            </div>
                            <span class="desktop-only"></span>
                            <span class="desktop-only"></span>
                            <span class="desktop-only"></span>
                          {:else}
                            <div class="field">
                              <span class="mobile-label">Round</span>
                              <input
                                class="round-input"
                                placeholder="Round"
                                value={set.round_label ?? ''}
                                on:input={(e) => updateSetField(idx, { round_label: e.currentTarget.value })}
                              />
                            </div>
                            <div class="field">
                              <span class="mobile-label">Label</span>
                              <input
                                class="label-input"
                                placeholder="Set label"
                                value={set.set_label ?? ''}
                                on:input={(e) => updateSetField(idx, { set_label: e.currentTarget.value })}
                              />
                            </div>
                            <div class="field">
                              <span class="mobile-label">Duration (sec)</span>
                              <input
                                class="duration-input narrow"
                                type="number"
                                min="0"
                                placeholder="sec"
                                value={set.duration_s ?? ''}
                                on:input={(e) => {
                                  const val = e.currentTarget.value.trim()
                                  updateSetField(idx, { duration_s: val === '' ? null : Number(val) })
                                }}
                              />
                            </div>
                            <div class="field">
                              <span class="mobile-label">Reps</span>
                              <input
                                class="narrow"
                                type="number"
                                min="0"
                                value={set.reps ?? ''}
                                on:input={(e) => {
                                  const val = e.currentTarget.value.trim()
                                  updateSet(idx, 'reps', val === '' ? null : Number(val))
                                }}
                              />
                            </div>
                            <div class="field">
                              <span class="mobile-label">Weight</span>
                              <input
                                class="narrow"
                                type="number"
                                min="0"
                                step="0.5"
                                value={set.weight ?? ''}
                                on:input={(e) => {
                                  const val = e.currentTarget.value.trim()
                                  updateSet(idx, 'weight', val === '' ? null : Number(val))
                                }}
                                placeholder="Weight"
                              />
                            </div>
                            <div class="field">
                              <span class="mobile-label">RPE</span>
                              <input
                                class="narrow"
                                type="number"
                                min="1"
                                max="10"
                                step="1"
                                value={set.rpe ?? ''}
                                placeholder="RPE"
                                on:input={(e) => {
                                  const val = e.currentTarget.value.trim()
                                  updateSetField(idx, { rpe: val === '' ? null : Number(val) })
                                }}
                              />
                            </div>
                          {/if}
                          <div class="inline-actions">
                            <select
                              value={set.type ?? 'work'}
                              on:change={(e) => updateSetField(idx, { type: e.currentTarget.value })}
                            >
                              <option value="work">Work</option>
                              <option value="rest">Rest</option>
                              <option value="transition">Transition</option>
                            </select>
                            <div class="mini-buttons">
                              <button class="ghost small icon-btn" aria-label="Copy row" on:click={() => copySet(idx)}>
                                <i class="ri-file-copy-line"></i>
                              </button>
                              <button class="ghost small icon-btn" aria-label="Move up" on:click={() => moveSet(idx, -1)} disabled={idx === 0}>
                                <i class="ri-arrow-up-line"></i>
                              </button>
                              <button class="ghost small icon-btn" aria-label="Move down" on:click={() => moveSet(idx, 1)} disabled={idx === editSets.length - 1}>
                                <i class="ri-arrow-down-line"></i>
                              </button>
                              <button class="ghost small danger icon-btn" aria-label="Delete row" on:click={() => requestDeleteSet(idx)}>
                                <i class="ri-delete-bin-6-line"></i>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    {/each}
                    <div class="add-row">
                      <button class="ghost" on:click={() => addSet('work')}>Add work set</button>
                      <button class="ghost" on:click={() => addSet('rest')}>Add rest</button>
                      <button class="ghost" on:click={() => addSet('transition')}>Add transition</button>
                    </div>
                  </div>
                  <div class="actions">
                    <button class="primary" on:click={() => saveEdit(item.id)}>Save</button>
                    <button class="ghost" on:click={cancelEdit}>Cancel</button>
                    <button
                      class="ghost"
                      on:click={() => {
                        uploadTargetId = item.id
                        if (fileInputEl) fileInputEl.click()
                      }}
                    >
                      {hrAttached[item.id] ? 'Replace HR file' : 'Attach HR file'}
                      {#if hrAttached[item.id]}<span class="hr-badge">Attached</span>{/if}
                    </button>
                    {#if hrAttached[item.id] || hrSummary[item.id]}
                      <button class="ghost danger" on:click={() => requestRemoveHrFile(item.id)}>Remove HR file</button>
                    {/if}
                    <button
                      class="danger destructive"
                      aria-label="Delete session"
                      on:click={() => (confirmDeleteId = item.id)}
                    >
                      <i class="ri-delete-bin-6-line"></i>
                    </button>
                  </div>
                {:else}
            {#if isExpanded}
              {#if item.notes}
                <p class="muted small">Notes: {item.notes}</p>
              {/if}
                    <div class="sets">
                      {#each item.sets as set, idx}
                        {@const isRest = set.type && set.type !== 'work'}
                        <div class="set-row view-row" class:rest-row={isRest}>
                          {#if isRest}
                            <span class="muted small rest-label">
                              Rest {set.duration_s ? `(${formatDuration(set.duration_s)})` : ''}
                            </span>
                          {:else}
                            <span class="muted small">{set.round_label ?? 'Round'}</span>
                            <strong>{set.set_label ?? `Set ${idx + 1}`}</strong>
                            <span class="muted small">
                              {set.duration_s ? formatDuration(set.duration_s) : ''}
                            </span>
                            <span>{set.reps ?? '-'}</span>
                            {#if set.weight}
                              <span class="muted small">@ {set.weight}</span>
                            {:else}
                              <span></span>
                            {/if}
                            {#if set.rpe}
                              <span class="muted small">RPE {set.rpe}</span>
                            {:else}
                              <span></span>
                            {/if}
                          {/if}
                        </div>
                      {/each}
                    </div>
                    <div class="actions">
                      <button class="ghost" on:click={() => startEdit(item)}>Edit</button>
                      <button
                        class="ghost"
                        on:click={() => {
                          shareItem = item
                          shareShowReps = true
                          shareShowWork = true
                          shareShowSets = true
                        }}
                      >
                        Share
                      </button>
                      <button class="ghost" on:click={() => openCompareModal(item)}>Compare</button>
                      <button class="text-button" on:click={() => duplicateLog(item)}>Log again</button>
                      <button class="ghost" on:click={() => duplicateWorkoutFromItem(item)}>Save as workout</button>
                      <button class="ghost" on:click={() => {
                        uploadTargetId = item.id
                        if (fileInputEl) fileInputEl.click()
                      }}>
                        {hrAttached[item.id] ? 'Replace HR file' : 'Attach HR file'}
                        {#if hrAttached[item.id]}<span class="hr-badge">Attached</span>{/if}
                      </button>
                      <button class="ghost" on:click={() => copySummary(item)}>Copy</button>
                      <button class="ghost" on:click={() => copyCsv(item)}>CSV</button>
                      <button class="ghost" on:click={() => loadInTimer(item)} disabled={!item.workout_id}>Timer</button>
                      <button class="ghost" on:click={() => loadInBigPicture(item)} disabled={!item.workout_id}>Big Picture</button>
                      {#if hrAttached[item.id] || hrSummary[item.id]}
                        <button class="ghost danger" on:click={() => requestRemoveHrFile(item.id)}>Remove HR file</button>
                      {/if}
                      <button
                        class="danger destructive"
                        aria-label="Delete session"
                        on:click={() => (confirmDeleteId = item.id)}
                      >
                        <i class="ri-delete-bin-6-line"></i>
                      </button>
                    </div>
                    {#if uploadStatus[item.id]}
                      <p class="muted small">{uploadStatus[item.id]}</p>
                    {:else if hrAttached[item.id]}
                      <p class="muted small">HR file attached</p>
                    {/if}
                  {/if}
                {/if}
              </article>
            {/each}
          </div>
        {/if}
      </div>
    {:else if visibleItems.length === 0}
      <p class="muted">No matching workouts.</p>
    {:else}
      <div class="list">
        {#each visibleItems as item}
        {@const totals = computeTotals(item)}
        {@const isExpanded = editingId === item.id || expanded[item.id]}
        {@const summary = buildWorkoutSummary(item.sets)}
        <article class="card">
          <div class="card-header two-col">
            <div class="header-left">
              {#if editingId === item.id}
                <input
                  class="title-input"
                  bind:value={editTitle}
                  placeholder="Workout title"
                />
              {:else}
                <h3>{item.title || 'Workout'}</h3>
              {/if}
              <div class="meta-row">
                <span class="muted small">{formatDate(item.started_at || item.created_at)}</span>
                {#if item.duration_s}
                  <span class="badge subtle">{formatDuration(item.duration_s)}</span>
                {/if}
              </div>
              {#if item.tags?.length}
                <div class="tag-row inline">
                  {#each item.tags as tag}
                    <span class="tag-chip selected">{tag}</span>
                  {/each}
                </div>
              {/if}
            </div>
            <div class="header-right">
              <div class="summary-chips">
                <span class="chip">{totals.totalSets || '-'} sets</span>
                <span class="chip">{totals.totalReps || '-'} reps</span>
                <span class="chip">{formatShort(totals.totalWorkSeconds) || '-'} work</span>
                {#if item.rpe}<span class="chip">RPE {item.rpe}</span>{/if}
                {#if hrSummary[item.id]}
                  <span class="chip hr">
                    HR {hrSummary[item.id].avgHr ?? '-'} / {hrSummary[item.id].maxHr ?? '-'}
                  </span>
                {/if}
              </div>
              {#if hrSummary[item.id]}
                <div class="hr-card">
                  <div class="hr-card-top">
                    <span class="muted small">HR</span>
                    <div class="hr-stats">
                      {#if hrSummary[item.id].avgHr}<span>Avg {hrSummary[item.id].avgHr} bpm</span>{/if}
                      {#if hrSummary[item.id].maxHr}<span>Max {hrSummary[item.id].maxHr} bpm</span>{/if}
                    </div>
                  </div>
                  {#if hrDetails[item.id]?.samples && hrDetails[item.id]?.samples?.length}
                    {#key hrDetails[item.id]?.samples}
                      {@const s = hrDetails[item.id]?.samples ?? []}
                      {@const maxT = Math.max(...s.map((p) => p.t), 1)}
                      {@const minHrRaw = Math.min(...s.map((p) => p.hr))}
                      {@const maxHrRaw = Math.max(...s.map((p) => p.hr))}
                      {@const padding = Math.max(8, Math.round((maxHrRaw - minHrRaw) * 0.15))}
                      {@const minHr = minHrRaw - padding}
                      {@const maxHr = maxHrRaw + padding}
                      {@const avgLine = hrSummary[item.id].avgHr ?? null}
                      {@const maxPoint = s.reduce((acc, p) => (p.hr > acc.hr ? p : acc), s[0] ?? { t: 0, hr: 0 })}
                      <svg
                        class="hr-spark"
                        viewBox="0 0 320 120"
                        preserveAspectRatio="none"
                        style:--hr-spark-bg={hrSparkColors.bg}
                        style:--hr-spark-border={hrSparkColors.border}
                        style:--hr-spark-line={hrSparkColors.line}
                        style:--hr-spark-avg={hrSparkColors.avg}
                        style:--hr-spark-max={hrSparkColors.max}
                      >
                        {#if avgLine}
                          <line
                            class="avg-line"
                            x1="0"
                            x2="320"
                            y1={120 - ((avgLine - minHr) / Math.max(1, maxHr - minHr)) * 120}
                            y2={120 - ((avgLine - minHr) / Math.max(1, maxHr - minHr)) * 120}
                            stroke-dasharray="4 4"
                            stroke-width="1.25"
                          />
                        {/if}
                        <polyline
                          class="hr-line"
                          fill="none"
                          stroke-width="2"
                          points={s
                            .map((p) => {
                              const x = (p.t / maxT) * 320
                              const y = 120 - ((p.hr - minHr) / Math.max(1, maxHr - minHr)) * 120
                              return `${x},${y}`
                            })
                            .join(' ')}
                        />
                        {#if s.length}
                          <circle
                            class="hr-max"
                            cx={(maxPoint.t / maxT) * 320}
                            cy={120 - ((maxPoint.hr - minHr) / Math.max(1, maxHr - minHr)) * 120}
                            r="5"
                          />
                        {/if}
                      </svg>
                  {/key}
                  {/if}
                </div>
              {:else if item.duration_s}
                <span class="badge">{formatDuration(item.duration_s)}</span>
              {/if}
            </div>
          </div>
          {#if editingId !== item.id}
            <div class="card-actions-row">
              <button
                class="ghost icon-btn toggle-btn"
                aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                on:click={() => toggleExpanded(item.id, !isExpanded)}
              >
                {#if isExpanded}▲{:else}▼{/if}
              </button>
              <button class="ghost" on:click={() => startEdit(item)}>Edit</button>
              <button
                class="ghost"
                on:click={() => {
                  shareItem = item
                  shareShowReps = true
                  shareShowWork = true
                  shareShowSets = true
                }}
              >
                Share
              </button>
              <button class="ghost" on:click={() => openCompareModal(item)}>Compare</button>
              <button class="ghost secondary-action" on:click={() => duplicateWorkoutFromItem(item)}>Save as workout</button>
              <button class="text-button" on:click={() => duplicateLog(item)}>Log again</button>
              <div class="export-group secondary-action">
                <button class="ghost small" on:click={() => copySummary(item)}>Copy</button>
                <button class="ghost small" on:click={() => copyCsv(item)}>CSV</button>
              </div>
              <button class="ghost" on:click={() => loadInTimer(item)} disabled={!item.workout_id}>Timer</button>
              <button class="ghost mobile-hidden secondary-action" on:click={() => loadInBigPicture(item)} disabled={!item.workout_id}>Big Picture</button>
              <button
                class="ghost mobile-hidden"
                on:click={() => {
                  uploadTargetId = item.id
                  if (fileInputEl) fileInputEl.click()
                }}
              >
                {hrAttached[item.id] ? 'Replace HR file' : 'Attach HR file'}
                {#if hrAttached[item.id]}<span class="hr-badge">Attached</span>{/if}
              </button>
              {#if hrAttached[item.id] || hrSummary[item.id]}
                <button class="ghost danger mobile-hidden secondary-action" on:click={() => requestRemoveHrFile(item.id)}>Remove HR file</button>
              {/if}
              <div class="sticky-end">
                <button
                  class="danger destructive"
                  aria-label="Delete session"
                  on:click={() => (confirmDeleteId = item.id)}
                >
                  <i class="ri-delete-bin-6-line"></i>
                </button>
                <div class="overflow-wrapper">
                  <button
                    class="ghost icon-btn mobile-overflow"
                    aria-label="More actions"
                    on:click={() => toggleOverflow(item.id)}
                  >
                    ⋯
                  </button>
                  {#if overflowOpen[item.id]}
                    <div class="overflow-menu">
                      <button on:click={() => duplicateWorkoutFromItem(item)}>Save as workout</button>
                      <button on:click={() => openCompareModal(item)}>Compare</button>
                      <button on:click={() => copySummary(item)}>Copy</button>
                      <button on:click={() => copyCsv(item)}>CSV</button>
                      <button on:click={() => loadInBigPicture(item)} disabled={!item.workout_id}>Big Picture</button>
                      <button
                        on:click={() => {
                          uploadTargetId = item.id
                          if (fileInputEl) fileInputEl.click()
                        }}
                      >
                        {hrAttached[item.id] ? 'Replace HR file' : 'Attach HR file'}
                      </button>
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
            {#if !isExpanded}
              {#if summary.blocks.length}
                <div class="compact-summary rich">
                  {#each summary.blocks as block}
                    <div class="summary-block">
                      <div class="summary-title">{block.title}</div>
                      {#if block.items?.length}
                        <div class="summary-items">
                          {#each block.items as it}
                            <span class="summary-chip fancy">
                              {#if it.label}<span class="chip-label">{it.label}</span>{/if}
                              {#if it.work}
                                <span class="chip-pill">
                                  {#if it.count && it.count > 1}<span class="count">{it.count} ×</span>{/if}
                                  <span>{it.work}</span>
                                </span>
                              {:else if it.count && it.count > 1}
                                <span class="chip-pill">
                                  <span class="count">{it.count} ×</span>
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
                                {#if it.count && it.count > 1}<span class="chip-pill"><span class="count">{it.count} ×</span></span>{/if}
                                <span>{it.baseRaw}</span>
                              {/if}
                            </span>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/each}
              </div>
            {:else if summary.text}
              <div class="compact-summary">
                {#each summary.text.split('\n') as line}
                  <div class="summary-line">{line}</div>
                {/each}
              </div>
            {/if}
          {/if}
          {#if editingId === item.id}
            <div class="meta-edit">
              <label>
                <span class="muted small">Started at</span>
                <input type="datetime-local" bind:value={editStartedAt} />
              </label>
              <label>
                <span class="muted small">Finished at</span>
                <input type="datetime-local" bind:value={editFinishedAt} />
              </label>
              <label>
                <span class="muted small">Duration (minutes)</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  bind:value={editDurationMinutes}
                  placeholder="auto"
                />
              </label>
              <label>
                <span class="muted small">Session RPE</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                  bind:value={editRpe}
                  placeholder="1-10"
                />
              </label>
              <label class="notes-field">
                <span class="muted small">Notes</span>
                <input
                  type="text"
                  bind:value={editNotes}
                  placeholder='e.g., "jerks felt heavy"'
                />
              </label>
              <label class="tags-field">
                <span class="muted small">Tags</span>
                <div class="tag-editor">
                  {#each editTags as tag}
                    <span class="tag-chip selected">
                      {tag}
                      <button class="ghost icon-btn" aria-label="Remove tag" on:click={() => removeTag(tag)}>
                        ×
                      </button>
                    </span>
                  {/each}
                  <div class="tag-input-wrap">
                    <input
                      type="text"
                      placeholder="Add tag"
                      bind:value={newTagInput}
                      on:keydown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addTag()
                        }
                      }}
                    />
                    <button class="ghost small" type="button" on:click={addTag}>Add</button>
                  </div>
                </div>
              </label>
            </div>
          {:else}
            {#if item.notes}
              <p class="muted small">Notes: {item.notes}</p>
            {/if}
          {/if}
          {#if editingId === item.id}
            <div class="sets">
              <div class="set-grid-labels desktop-only">
                <span></span>
                <span></span>
                <span>Duration (sec)</span>
                <span>Reps</span>
                <span>Weight</span>
                <span>RPE</span>
                <span>Actions</span>
              </div>
              {#each editSets as set, idx}
                {@const isRest = set.type && set.type !== 'work'}
                <div class="set-row edit-row" class:rest-row={isRest}>
                  <div class="row-main" class:rest-row={isRest}>
                    {#if isRest}
                      <span class="desktop-only"></span>
                      <span class="desktop-only"></span>
                      <div class="field">
                        <span class="mobile-label">Rest (sec)</span>
                        <input
                          class="duration-input narrow"
                          type="number"
                          min="0"
                          placeholder="sec"
                          value={set.duration_s ?? ''}
                          on:input={(e) => {
                            const val = e.currentTarget.value.trim()
                            updateSetField(idx, { duration_s: val === '' ? null : Number(val) })
                          }}
                        />
                      </div>
                      <span class="desktop-only"></span>
                      <span class="desktop-only"></span>
                      <span class="desktop-only"></span>
                    {:else}
                      <div class="field">
                        <span class="mobile-label">Round</span>
                        <input
                          class="round-input"
                          placeholder="Round"
                          value={set.round_label ?? ''}
                          on:input={(e) => updateSetField(idx, { round_label: e.currentTarget.value })}
                        />
                      </div>
                      <div class="field">
                        <span class="mobile-label">Label</span>
                        <input
                          class="label-input"
                          placeholder="Set label"
                          value={set.set_label ?? ''}
                          on:input={(e) => updateSetField(idx, { set_label: e.currentTarget.value })}
                        />
                      </div>
                      <div class="field">
                        <span class="mobile-label">Duration (sec)</span>
                        <input
                          class="duration-input narrow"
                          type="number"
                          min="0"
                          placeholder="sec"
                          value={set.duration_s ?? ''}
                          on:input={(e) => {
                            const val = e.currentTarget.value.trim()
                            updateSetField(idx, { duration_s: val === '' ? null : Number(val) })
                          }}
                        />
                      </div>
                      <div class="field">
                        <span class="mobile-label">Reps</span>
                        <input
                          class="narrow"
                          type="number"
                          min="0"
                          value={set.reps ?? ''}
                          on:input={(e) => {
                            const val = e.currentTarget.value.trim()
                            updateSet(idx, 'reps', val === '' ? null : Number(val))
                          }}
                        />
                      </div>
                      <div class="field">
                        <span class="mobile-label">Weight</span>
                        <input
                          class="narrow"
                          type="number"
                          min="0"
                          step="0.5"
                          value={set.weight ?? ''}
                          on:input={(e) => {
                            const val = e.currentTarget.value.trim()
                            updateSet(idx, 'weight', val === '' ? null : Number(val))
                          }}
                          placeholder="Weight"
                        />
                      </div>
                      <div class="field">
                        <span class="mobile-label">RPE</span>
                        <input
                          class="narrow"
                          type="number"
                          min="1"
                          max="10"
                          step="1"
                          value={set.rpe ?? ''}
                          placeholder="RPE"
                          on:input={(e) => {
                            const val = e.currentTarget.value.trim()
                            updateSetField(idx, { rpe: val === '' ? null : Number(val) })
                          }}
                        />
                      </div>
                    {/if}
                    <div class="inline-actions">
                      <select
                        value={set.type ?? 'work'}
                        on:change={(e) => updateSetField(idx, { type: e.currentTarget.value })}
                      >
                        <option value="work">Work</option>
                        <option value="rest">Rest</option>
                        <option value="transition">Transition</option>
                      </select>
                      <div class="mini-buttons">
                        <button class="ghost small icon-btn" aria-label="Copy row" on:click={() => copySet(idx)}>
                          <i class="ri-file-copy-line"></i>
                        </button>
                        <button class="ghost small icon-btn" aria-label="Move up" on:click={() => moveSet(idx, -1)} disabled={idx === 0}>
                          <i class="ri-arrow-up-line"></i>
                        </button>
                        <button class="ghost small icon-btn" aria-label="Move down" on:click={() => moveSet(idx, 1)} disabled={idx === editSets.length - 1}>
                          <i class="ri-arrow-down-line"></i>
                        </button>
                        <button class="ghost small danger icon-btn" aria-label="Delete row" on:click={() => requestDeleteSet(idx)}>
                          <i class="ri-delete-bin-6-line"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              {/each}
              <div class="add-row">
                <button class="ghost" on:click={() => addSet('work')}>Add work set</button>
                <button class="ghost" on:click={() => addSet('rest')}>Add rest</button>
                <button class="ghost" on:click={() => addSet('transition')}>Add transition</button>
              </div>
            </div>
            <div class="actions">
              <button class="primary" on:click={() => saveEdit(item.id)}>Save</button>
              <button class="ghost" on:click={cancelEdit}>Cancel</button>
              <button
                class="ghost"
                on:click={() => {
                  uploadTargetId = item.id
                  if (fileInputEl) fileInputEl.click()
                }}
              >
                {hrAttached[item.id] ? 'Replace HR file' : 'Attach HR file'}
                {#if hrAttached[item.id]}<span class="hr-badge">Attached</span>{/if}
              </button>
              {#if hrAttached[item.id] || hrSummary[item.id]}
                <button class="ghost danger" on:click={() => requestRemoveHrFile(item.id)}>Remove HR file</button>
              {/if}
                        <button
                          class="danger destructive"
                          aria-label="Delete session"
                          on:click={() => (confirmDeleteId = item.id)}
                        >
                          <i class="ri-delete-bin-6-line"></i>
                        </button>
            </div>
          {:else}
            {#if isExpanded}
              {#if item.notes}
                <p class="muted small">Notes: {item.notes}</p>
              {/if}
              <div class="sets">
                {#each item.sets as set, idx}
                  {@const isRest = set.type && set.type !== 'work'}
                  <div class="set-row view-row" class:rest-row={isRest}>
                    {#if isRest}
                      <span class="muted small rest-label">
                        Rest {set.duration_s ? `(${formatDuration(set.duration_s)})` : ''}
                      </span>
                    {:else}
                      <span class="muted small">{set.round_label ?? 'Round'}</span>
                      <strong>{set.set_label ?? `Set ${idx + 1}`}</strong>
                      <span class="muted small">
                        {set.duration_s ? formatDuration(set.duration_s) : ''}
                      </span>
                      <span>{set.reps ?? '-'}</span>
                      {#if set.weight}
                        <span class="muted small">@ {set.weight}</span>
                      {:else}
                        <span></span>
                      {/if}
                      {#if set.rpe}
                        <span class="muted small">RPE {set.rpe}</span>
                      {:else}
                        <span></span>
                      {/if}
                    {/if}
                  </div>
                {/each}
              </div>
                    <div class="actions">
                      <button class="ghost" on:click={() => startEdit(item)}>Edit</button>
                      <button
                        class="ghost"
                        on:click={() => {
                          shareItem = item
                          shareShowReps = true
                          shareShowWork = true
                          shareShowSets = true
                        }}
                      >
                        Share
                      </button>
                      <button class="text-button" on:click={() => duplicateLog(item)}>Log again</button>
                      <button class="ghost" on:click={() => duplicateWorkoutFromItem(item)}>Save as workout</button>
                      <button class="ghost" on:click={() => {
                        uploadTargetId = item.id
                        if (fileInputEl) fileInputEl.click()
                      }}>
                        {hrAttached[item.id] ? 'Replace HR file' : 'Attach HR file'}
                        {#if hrAttached[item.id]}<span class="hr-badge">Attached</span>{/if}
                      </button>
                      <button class="ghost" on:click={() => copySummary(item)}>Copy</button>
                      <button class="ghost" on:click={() => copyCompactSummary(item)}>Copy summary</button>
                      <button class="ghost" on:click={() => copyCsv(item)}>CSV</button>
                      <button class="ghost" on:click={() => loadInTimer(item)} disabled={!item.workout_id}>Timer</button>
                      <button class="ghost" on:click={() => loadInBigPicture(item)} disabled={!item.workout_id}>Big Picture</button>
                      {#if hrAttached[item.id] || hrSummary[item.id]}
                        <button class="ghost danger" on:click={() => requestRemoveHrFile(item.id)}>Remove HR file</button>
                      {/if}
                <button
                  class="danger destructive"
                  aria-label="Delete session"
                  on:click={() => (confirmDeleteId = item.id)}
                >
                  <i class="ri-delete-bin-6-line"></i>
                </button>
              </div>
              {#if uploadStatus[item.id]}
                <p class="muted small">{uploadStatus[item.id]}</p>
              {:else if hrAttached[item.id]}
                <p class="muted small">HR file attached</p>
              {/if}
            {/if}
          {/if}
        </article>
      {/each}
      </div>
    {/if}
  {/if}

  {#if compareModalOpen && compareSource}
    {@const srcTotals = compareSourceTotals ?? ensureCompareTotals(compareSource)}
    {@const srcSummary = buildWorkoutSummary(compareSource.sets)}
    <div class="modal-backdrop"></div>
    <div class="compare-modal">
      <header class="compare-head">
        <div>
          <p class="eyebrow">Compare workouts</p>
          <h3>{compareSource.title || 'Workout'}</h3>
          <p class="muted tiny">
            {formatDate(compareSource.started_at || compareSource.created_at)}
            {#if compareSource.duration_s} · {formatShort(compareSource.duration_s)}{/if}
            {#if compareSource.rpe} · RPE {compareSource.rpe}{/if}
            {#if hrSummary[compareSource.id]}
              · HR {hrSummary[compareSource.id].avgHr ?? '-'} / {hrSummary[compareSource.id].maxHr ?? '-'}
            {/if}
          </p>
        </div>
        <div class="compare-head__actions">
          <button class="ghost small" on:click={swapCompareSides} disabled={!compareTarget}>
            Swap sides
          </button>
          <button class="ghost small" on:click={closeCompareModal}>✕</button>
        </div>
      </header>
      <div class="compare-top">
        <div class="compare-card">
          <div class="summary-chips">
            <span class="chip">{srcTotals.totalSets || '-'} sets</span>
            <span class="chip">{srcTotals.totalReps || '-'} reps</span>
            <span class="chip">{formatShort(srcTotals.totalWorkSeconds) || '-'} work</span>
            {#if srcTotals.tonnage}<span class="chip">{formatTonnage(srcTotals.tonnage)} load</span>{/if}
            {#if compareSource.rpe}<span class="chip">RPE {compareSource.rpe}</span>{/if}
          </div>
          {#if srcSummary.blocks.length}
            <div class="compact-summary rich">
              {#each srcSummary.blocks as block}
                <div class="summary-block">
                  <div class="summary-title">{block.title}</div>
                  {#if block.items?.length}
                    <div class="summary-items">
                      {#each block.items as it}
                        <span class="summary-chip fancy">
                          {#if it.label}<span class="chip-label">{it.label}</span>{/if}
                          {#if it.work}
                            <span class="chip-pill">
                              {#if it.count && it.count > 1}<span class="count">{it.count} ×</span>{/if}
                              <span>{it.work}</span>
                            </span>
                          {:else if it.count && it.count > 1}
                            <span class="chip-pill">
                              <span class="count">{it.count} ×</span>
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
                            {#if it.count && it.count > 1}<span class="chip-pill"><span class="count">{it.count} ×</span></span>{/if}
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
        </div>
        <div class="compare-suggestions">
          <div class="compare-suggestions__head">
            <div>
              <p class="eyebrow">Similar sessions</p>
              <p class="muted tiny">Ranked by labels, tags, load, and duration.</p>
            </div>
            {#if compareError}<span class="error tiny">{compareError}</span>{/if}
          </div>
          {#if compareLoading}
            <p class="muted">Loading suggestions…</p>
          {:else if compareSuggestions.length === 0}
            <p class="muted small">No suggestions yet.</p>
          {:else}
            <div class="suggestion-list">
              {#each compareSuggestions as suggestion}
                {@const t = suggestion.totals ?? ensureCompareTotals(suggestion.workout)}
                <article class="suggestion-card">
                  <div class="suggestion-top">
                    <div>
                      <strong>{suggestion.workout.title || 'Workout'}</strong>
                      <p class="muted tiny">
                        {formatDate(suggestion.workout.started_at || suggestion.workout.created_at)}
                      </p>
                    </div>
                    <span
                      class="score-pill"
                      title={suggestion.reasons?.length ? suggestion.reasons.join(' · ') : 'Similarity score'}
                    >
                      {suggestion.score.toFixed(2)}
                    </span>
                  </div>
                  <div class="summary-chips">
                    <span class="chip">{t.totalSets || '-'} sets</span>
                    <span class="chip">{t.totalReps || '-'} reps</span>
                    <span class="chip">{formatShort(t.totalWorkSeconds) || '-'} work</span>
                    {#if t.tonnage}<span class="chip">{formatTonnage(t.tonnage)} load</span>{/if}
                    {#if suggestion.workout.rpe}<span class="chip">RPE {suggestion.workout.rpe}</span>{/if}
                  </div>
                  <div class="mini-buttons">
                    <button class="primary small" on:click={() => chooseCompareTarget(suggestion.workout, suggestion.totals)}>
                      Compare this
                    </button>
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <div class="manual-compare">
        <div class="manual-head">
          <p class="eyebrow">Pick any session</p>
          <input
            type="text"
            placeholder="Search by title, tag, or label"
            bind:value={compareSearch}
          />
        </div>
        {#if compareManualOptions.length}
          <div class="manual-list">
            {#each compareManualOptions as it}
              {@const t = ensureCompareTotals(it)}
              <button class="manual-row" on:click={() => chooseCompareTarget(it, t)}>
                <div class="manual-row__body">
                  <strong>{it.title || 'Workout'}</strong>
                  <p class="muted tiny">
                    {formatDate(it.started_at || it.created_at)}
                    {#if it.duration_s} · {formatShort(it.duration_s)}{/if}
                  </p>
                </div>
                <div class="summary-chips">
                  <span class="chip">{t.totalSets || '-'} sets</span>
                  <span class="chip">{t.totalReps || '-'} reps</span>
                  {#if t.totalWorkSeconds}<span class="chip">{formatShort(t.totalWorkSeconds)}</span>{/if}
                </div>
              </button>
            {/each}
          </div>
        {:else}
          <p class="muted small">No matching sessions.</p>
        {/if}
      </div>
      {#if compareTarget}
        {@const tgtSummary = buildWorkoutSummary(compareTarget.sets)}
        {@const tgtTotals = compareTargetTotals ?? ensureCompareTotals(compareTarget)}
        {@const deltaSets = formatDelta(srcTotals.totalSets, tgtTotals.totalSets)}
        {@const deltaReps = formatDelta(srcTotals.totalReps, tgtTotals.totalReps)}
        {@const deltaWork = formatDelta(srcTotals.totalWorkSeconds, tgtTotals.totalWorkSeconds)}
        {@const deltaLoad = formatDelta(srcTotals.tonnage, tgtTotals.tonnage)}
        {@const deltaAvgWeight = formatDelta(srcTotals.avgWeight, tgtTotals.avgWeight)}
        {@const deltaDuration = formatDelta(compareSource.duration_s, compareTarget.duration_s)}
        {@const deltaRpe = formatDelta(compareSource.rpe, compareTarget.rpe)}
        {@const srcHr = hrDetails[compareSource.id] ?? hrSummary[compareSource.id]}
        {@const tgtHr = hrDetails[compareTarget.id] ?? hrSummary[compareTarget.id]}
        {@const deltaAvgHr = formatDelta(srcHr?.avgHr, tgtHr?.avgHr)}
        {@const deltaMaxHr = formatDelta(srcHr?.maxHr, tgtHr?.maxHr)}
        {@const sharedHrRange = compareHrSharedScale
          ? computeHrSharedRange(hrDetails[compareSource.id]?.samples, hrDetails[compareTarget.id]?.samples)
          : null}
        <div class="compare-results" bind:this={compareResultsEl}>
          <div class="compare-metrics">
            <div class="metric-row">
              <div class="metric-label">Sets</div>
              <div class="metric-values">
                <span class="metric-target">{tgtTotals.totalSets ?? '-'}</span>
                <span class:up={Number(deltaSets) > 0} class:down={Number(deltaSets) < 0} class="metric-arrow">→</span>
                <span class="metric-source">{srcTotals.totalSets ?? '-'}</span>
                {#if deltaSets}
                  <span class:up={Number(deltaSets) > 0} class:down={Number(deltaSets) < 0} class="delta">
                    {deltaSets}
                  </span>
                {/if}
              </div>
            </div>
            <div class="metric-row">
              <div class="metric-label">Reps</div>
              <div class="metric-values">
                <span class="metric-target">{tgtTotals.totalReps ?? '-'}</span>
                <span class:up={Number(deltaReps) > 0} class:down={Number(deltaReps) < 0} class="metric-arrow">→</span>
                <span class="metric-source">{srcTotals.totalReps ?? '-'}</span>
                {#if deltaReps}
                  <span class:up={Number(deltaReps) > 0} class:down={Number(deltaReps) < 0} class="delta">
                    {deltaReps}
                  </span>
                {/if}
              </div>
            </div>
            <div class="metric-row">
              <div class="metric-label">Work time</div>
              <div class="metric-values">
                <span class="metric-target">{formatShort(tgtTotals.totalWorkSeconds) || '-'}</span>
                <span class:up={Number(deltaWork) > 0} class:down={Number(deltaWork) < 0} class="metric-arrow">→</span>
                <span class="metric-source">{formatShort(srcTotals.totalWorkSeconds) || '-'}</span>
                {#if deltaWork}
                  <span class:up={Number(deltaWork) > 0} class:down={Number(deltaWork) < 0} class="delta">
                    {deltaWork}
                  </span>
                {/if}
              </div>
            </div>
            <div class="metric-row">
              <div class="metric-label">Load</div>
              <div class="metric-values">
                <span class="metric-target">{formatTonnage(tgtTotals.tonnage)}</span>
                <span class:up={Number(deltaLoad) > 0} class:down={Number(deltaLoad) < 0} class="metric-arrow">→</span>
                <span class="metric-source">{formatTonnage(srcTotals.tonnage)}</span>
                {#if deltaLoad}
                  <span class:up={Number(deltaLoad) > 0} class:down={Number(deltaLoad) < 0} class="delta">
                    {deltaLoad}
                  </span>
                {/if}
              </div>
            </div>
            <div class="metric-row">
              <div class="metric-label">Avg weight</div>
              <div class="metric-values">
                <span class="metric-target">{tgtTotals.avgWeight ? tgtTotals.avgWeight.toFixed(1) : '-'}</span>
                <span class:up={Number(deltaAvgWeight) > 0} class:down={Number(deltaAvgWeight) < 0} class="metric-arrow">→</span>
                <span class="metric-source">{srcTotals.avgWeight ? srcTotals.avgWeight.toFixed(1) : '-'}</span>
                {#if deltaAvgWeight}
                  <span class:up={Number(deltaAvgWeight) > 0} class:down={Number(deltaAvgWeight) < 0} class="delta">
                    {deltaAvgWeight}
                  </span>
                {/if}
              </div>
            </div>
            <div class="metric-row">
              <div class="metric-label">Duration</div>
              <div class="metric-values">
                <span class="metric-target">{compareTarget.duration_s ? formatDuration(compareTarget.duration_s) : '-'}</span>
                <span class:up={Number(deltaDuration) > 0} class:down={Number(deltaDuration) < 0} class="metric-arrow">→</span>
                <span class="metric-source">{compareSource.duration_s ? formatDuration(compareSource.duration_s) : '-'}</span>
                {#if deltaDuration}
                  <span class:up={Number(deltaDuration) > 0} class:down={Number(deltaDuration) < 0} class="delta">
                    {deltaDuration}
                  </span>
                {/if}
              </div>
            </div>
            <div class="metric-row">
              <div class="metric-label">RPE</div>
              <div class="metric-values">
                <span class="metric-target">{compareTarget.rpe ?? '-'}</span>
                <span class:up={Number(deltaRpe) > 0} class:down={Number(deltaRpe) < 0} class="metric-arrow">→</span>
                <span class="metric-source">{compareSource.rpe ?? '-'}</span>
                {#if deltaRpe}
                  <span class:up={Number(deltaRpe) > 0} class:down={Number(deltaRpe) < 0} class="delta">
                    {deltaRpe}
                  </span>
                {/if}
              </div>
            </div>
            {#if srcHr || tgtHr}
              <div class="metric-row">
                <div class="metric-label">Avg HR</div>
                <div class="metric-values">
                  <span class="metric-target">{tgtHr?.avgHr ?? '-'}</span>
                  <span class:up={Number(deltaAvgHr) > 0} class:down={Number(deltaAvgHr) < 0} class="metric-arrow">→</span>
                  <span class="metric-source">{srcHr?.avgHr ?? '-'}</span>
                  {#if deltaAvgHr}
                    <span class:up={Number(deltaAvgHr) > 0} class:down={Number(deltaAvgHr) < 0} class="delta">
                      {deltaAvgHr}
                    </span>
                  {/if}
                </div>
              </div>
              <div class="metric-row">
                <div class="metric-label">Max HR</div>
                <div class="metric-values">
                  <span class="metric-target">{tgtHr?.maxHr ?? '-'}</span>
                  <span class:up={Number(deltaMaxHr) > 0} class:down={Number(deltaMaxHr) < 0} class="metric-arrow">→</span>
                  <span class="metric-source">{srcHr?.maxHr ?? '-'}</span>
                  {#if deltaMaxHr}
                    <span class:up={Number(deltaMaxHr) > 0} class:down={Number(deltaMaxHr) < 0} class="delta">
                      {deltaMaxHr}
                    </span>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
          <div class="exercise-diffs">
            <div class="diff-head">
              <p class="eyebrow">Per-exercise differences</p>
              <p class="muted tiny">Exact label matches only.</p>
            </div>
            {#if compareExerciseDiffs.matched.length === 0 && compareExerciseDiffs.onlySource.length === 0 && compareExerciseDiffs.onlyTarget.length === 0}
              <p class="muted small">No comparable exercises.</p>
            {/if}
            {#if compareExerciseDiffs.matched.length}
              <div class="diff-list">
                {#each compareExerciseDiffs.matched as diff}
                  <div class="diff-row">
                    <div class="diff-label">{diff.label}</div>
                    <div class="diff-deltas">
                      {#if exerciseDeltaParts(diff).length}
                        <span class:up={diff.deltaReps > 0 || diff.deltaWorkSeconds > 0 || diff.deltaTonnage > 0} class:down={diff.deltaReps < 0 || diff.deltaWorkSeconds < 0 || diff.deltaTonnage < 0} class="delta pill">
                          {exerciseDeltaParts(diff).join(' · ')}
                        </span>
                      {/if}
                    </div>
                    <div class="diff-baseline">
                      <span class="chip subtle baseline target">
                        {diff.target.totalReps || 0} reps · {formatShort(diff.target.totalWorkSeconds) || '0s'}
                      </span>
                      <span class="chip subtle baseline source">
                        {diff.source.totalReps || 0} reps · {formatShort(diff.source.totalWorkSeconds) || '0s'}
                      </span>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
            {#if compareExerciseDiffs.onlySource.length || compareExerciseDiffs.onlyTarget.length}
              <div class="diff-unmatched">
                {#if compareExerciseDiffs.onlySource.length}
                  <div>
                    <p class="eyebrow">Only in source</p>
                    <div class="pill-list">
                      {#each compareExerciseDiffs.onlySource as it}
                        <span class="chip subtle">{it.label}</span>
                      {/each}
                    </div>
                  </div>
                {/if}
                {#if compareExerciseDiffs.onlyTarget.length}
                  <div>
                    <p class="eyebrow">Only in target</p>
                    <div class="pill-list">
                      {#each compareExerciseDiffs.onlyTarget as it}
                        <span class="chip subtle">{it.label}</span>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
          {#if (hrDetails[compareSource.id]?.samples?.length || hrDetails[compareTarget.id]?.samples?.length)}
            <div class="hr-shared-toggle">
              <label>
                <input type="checkbox" bind:checked={compareHrSharedScale} />
                Shared HR scale {#if sharedHrRange}({Math.round(sharedHrRange.min)}–{Math.round(sharedHrRange.max)} bpm){/if}
              </label>
            </div>
            <div class="compare-hr">
              {#if hrDetails[compareSource.id]?.samples?.length}
                {@const s = hrDetails[compareSource.id]?.samples ?? []}
                {@const maxT = Math.max(...s.map((p) => p.t), 1)}
                {@const minHrRaw = Math.min(...s.map((p) => p.hr))}
                {@const maxHrRaw = Math.max(...s.map((p) => p.hr))}
                {@const padding = Math.max(8, Math.round((maxHrRaw - minHrRaw) * 0.15))}
                {@const minHr = sharedHrRange ? sharedHrRange.min : minHrRaw - padding}
                {@const maxHr = sharedHrRange ? sharedHrRange.max : maxHrRaw + padding}
                {@const avgLine = hrDetails[compareSource.id]?.avgHr ?? null}
                {@const maxPoint = s.reduce((acc, p) => (p.hr > acc.hr ? p : acc), s[0] ?? { t: 0, hr: 0 })}
                <div class="hr-compare-card">
                  <p class="eyebrow">Source HR</p>
                  <svg
                    class="hr-spark"
                    viewBox="0 0 320 120"
                    preserveAspectRatio="none"
                    style:--hr-spark-bg={hrSparkColors.bg}
                    style:--hr-spark-border={hrSparkColors.border}
                    style:--hr-spark-line={hrSparkColors.line}
                    style:--hr-spark-avg={hrSparkColors.avg}
                    style:--hr-spark-max={hrSparkColors.max}
                  >
                    {#if avgLine}
                      <line
                        class="avg-line"
                        x1="0"
                        x2="320"
                        y1={120 - ((avgLine - minHr) / Math.max(1, maxHr - minHr)) * 120}
                        y2={120 - ((avgLine - minHr) / Math.max(1, maxHr - minHr)) * 120}
                        stroke-dasharray="4 4"
                        stroke-width="1.25"
                      />
                    {/if}
                    <polyline
                      class="hr-line"
                      fill="none"
                      stroke-width="2"
                      points={s
                        .map((p) => {
                          const x = (p.t / maxT) * 320
                          const y = 120 - ((p.hr - minHr) / Math.max(1, maxHr - minHr)) * 120
                          return `${x},${y}`
                        })
                        .join(' ')}
                    />
                    {#if s.length}
                      <circle
                        class="hr-max"
                        cx={(maxPoint.t / maxT) * 320}
                        cy={120 - ((maxPoint.hr - minHr) / Math.max(1, maxHr - minHr)) * 120}
                        r="5"
                      />
                    {/if}
                  </svg>
                </div>
              {/if}
              {#if hrDetails[compareTarget.id]?.samples?.length}
                {@const s = hrDetails[compareTarget.id]?.samples ?? []}
                {@const maxT = Math.max(...s.map((p) => p.t), 1)}
                {@const minHrRaw = Math.min(...s.map((p) => p.hr))}
                {@const maxHrRaw = Math.max(...s.map((p) => p.hr))}
                {@const padding = Math.max(8, Math.round((maxHrRaw - minHrRaw) * 0.15))}
                {@const minHr = sharedHrRange ? sharedHrRange.min : minHrRaw - padding}
                {@const maxHr = sharedHrRange ? sharedHrRange.max : maxHrRaw + padding}
                {@const avgLine = hrDetails[compareTarget.id]?.avgHr ?? null}
                {@const maxPoint = s.reduce((acc, p) => (p.hr > acc.hr ? p : acc), s[0] ?? { t: 0, hr: 0 })}
                <div class="hr-compare-card">
                  <p class="eyebrow">Target HR</p>
                  <svg
                    class="hr-spark"
                    viewBox="0 0 320 120"
                    preserveAspectRatio="none"
                    style:--hr-spark-bg={hrSparkColors.bg}
                    style:--hr-spark-border={hrSparkColors.border}
                    style:--hr-spark-line={hrSparkColors.line}
                    style:--hr-spark-avg={hrSparkColors.avg}
                    style:--hr-spark-max={hrSparkColors.max}
                  >
                    {#if avgLine}
                      <line
                        class="avg-line"
                        x1="0"
                        x2="320"
                        y1={120 - ((avgLine - minHr) / Math.max(1, maxHr - minHr)) * 120}
                        y2={120 - ((avgLine - minHr) / Math.max(1, maxHr - minHr)) * 120}
                        stroke-dasharray="4 4"
                        stroke-width="1.25"
                      />
                    {/if}
                    <polyline
                      class="hr-line"
                      fill="none"
                      stroke-width="2"
                      points={s
                        .map((p) => {
                          const x = (p.t / maxT) * 320
                          const y = 120 - ((p.hr - minHr) / Math.max(1, maxHr - minHr)) * 120
                          return `${x},${y}`
                        })
                        .join(' ')}
                    />
                    {#if s.length}
                      <circle
                        class="hr-max"
                        cx={(maxPoint.t / maxT) * 320}
                        cy={120 - ((maxPoint.hr - minHr) / Math.max(1, maxHr - minHr)) * 120}
                        r="5"
                      />
                    {/if}
                  </svg>
                </div>
              {/if}
            </div>
          {/if}
          <div class="compare-summaries">
            <div class="summary-col">
              <header>
                <p class="eyebrow">Source</p>
                <strong>{compareSource.title || 'Workout'}</strong>
              </header>
              {#if srcSummary.blocks.length}
                <div class="compact-summary rich">
                  {#each srcSummary.blocks as block}
                    <div class="summary-block">
                      <div class="summary-title">{block.title}</div>
                      {#if block.items?.length}
                        <div class="summary-items">
                          {#each block.items as it}
                            <span class="summary-chip fancy">
                              {#if it.label}<span class="chip-label">{it.label}</span>{/if}
                              {#if it.work}
                                <span class="chip-pill">
                                  {#if it.count && it.count > 1}<span class="count">{it.count} ×</span>{/if}
                                  <span>{it.work}</span>
                                </span>
                              {:else if it.count && it.count > 1}
                                <span class="chip-pill">
                                  <span class="count">{it.count} ×</span>
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
                                {#if it.count && it.count > 1}<span class="chip-pill"><span class="count">{it.count} ×</span></span>{/if}
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
            </div>
            <div class="summary-col">
              <header>
                <p class="eyebrow">Target</p>
                <strong>{compareTarget.title || 'Workout'}</strong>
              </header>
              {#if tgtSummary.blocks.length}
                <div class="compact-summary rich">
                  {#each tgtSummary.blocks as block}
                    <div class="summary-block">
                      <div class="summary-title">{block.title}</div>
                      {#if block.items?.length}
                        <div class="summary-items">
                          {#each block.items as it}
                            <span class="summary-chip fancy">
                              {#if it.label}<span class="chip-label">{it.label}</span>{/if}
                              {#if it.work}
                                <span class="chip-pill">
                                  {#if it.count && it.count > 1}<span class="count">{it.count} ×</span>{/if}
                                  <span>{it.work}</span>
                                </span>
                              {:else if it.count && it.count > 1}
                                <span class="chip-pill">
                                  <span class="count">{it.count} ×</span>
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
                                {#if it.count && it.count > 1}<span class="chip-pill"><span class="count">{it.count} ×</span></span>{/if}
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
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if hrRemoveTarget}
    <div class="modal-backdrop"></div>
    <div class="confirm-modal">
      <p>Remove HR file from this session?</p>
      {#if hrRemoveSession}
        <p class="muted small">
          {hrRemoveSession.title || 'Workout'} · {formatDate(hrRemoveSession.started_at || hrRemoveSession.created_at)}
        </p>
      {/if}
      {#if hrRemoveError}<p class="error small">{hrRemoveError}</p>{/if}
      <div class="actions">
        <button
          class="ghost"
          on:click={() => {
            hrRemoveTarget = null
            hrRemoveError = ''
            hrRemoveStatus = ''
          }}
        >
          Cancel
        </button>
        <button
          class="danger"
          disabled={hrRemoveStatus === 'Removing…'}
          on:click={() => hrRemoveTarget && removeHrFile(hrRemoveTarget)}
        >
          {hrRemoveStatus || 'Remove'}
        </button>
      </div>
    </div>
  {/if}
  {#if confirmDeleteSetIdx !== null}
    <div class="modal-backdrop"></div>
    <div class="confirm-modal">
      <p>Delete this row?</p>
      <div class="actions">
        <button class="ghost" on:click={() => (confirmDeleteSetIdx = null)}>Cancel</button>
        <button
          class="danger"
          on:click={() => {
            if (confirmDeleteSetIdx !== null) deleteSet(confirmDeleteSetIdx)
            confirmDeleteSetIdx = null
          }}
        >
          Delete
        </button>
      </div>
    </div>
  {/if}
  {#if confirmDeleteId}
    <div class="modal-backdrop"></div>
    <div class="confirm-modal">
      <p>Delete this session?</p>
      {#if confirmDeleteSession}
        <p class="muted small">
          {confirmDeleteSession.title || 'Workout'} · {formatDate(confirmDeleteSession.started_at || confirmDeleteSession.created_at)}
        </p>
      {/if}
      <div class="actions">
        <button class="ghost" on:click={() => (confirmDeleteId = null)}>Cancel</button>
        <button
          class="danger destructive"
          on:click={() => {
            if (confirmDeleteId) deleteItem(confirmDeleteId)
            confirmDeleteId = null
          }}
        >
          Delete
        </button>
      </div>
    </div>
  {/if}

  {#if toasts.length}
    <div class="toast-stack">
      {#each toasts as toast (toast.id)}
        <div class={`toast ${toast.type}`}>
          <span>{toast.message}</span>
          <button class="ghost icon-btn" aria-label="Dismiss" on:click={() => (toasts = toasts.filter((t) => t.id !== toast.id))}>×</button>
        </div>
      {/each}
    </div>
  {/if}

  {#if shareItem}
    <div class="modal-backdrop"></div>
    <div class="share-modal two-col">
      <div class="share-config-panel">
        <header>
          <h3>Share card</h3>
          <p class="muted small">Configure what to show.</p>
        </header>
        <div class="share-config">
          <label>
            <input
              type="radio"
              name="share-mode"
              value="detailed"
              bind:group={shareRenderMode}
            />
            Detailed
          </label>
          <label>
            <input
              type="radio"
              name="share-mode"
              value="summary"
              bind:group={shareRenderMode}
            />
            Summary
          </label>
        </div>
        <div class="share-config">
          <label class:disabled={shareRenderMode === 'summary'}>
            <input type="checkbox" bind:checked={shareShowReps} disabled={shareRenderMode === 'summary'} />
            Include total reps
          </label>
          <label class:disabled={shareRenderMode === 'summary'}>
            <input type="checkbox" bind:checked={shareShowWork} disabled={shareRenderMode === 'summary'} />
            Include total work time
          </label>
          <label class:disabled={shareRenderMode === 'summary'}>
            <input type="checkbox" bind:checked={shareShowSets} disabled={shareRenderMode === 'summary'} />
            Include total sets
          </label>
          <label class:disabled={shareRenderMode === 'summary'}>
            <input type="checkbox" bind:checked={shareShowDividers} disabled={shareRenderMode === 'summary'} />
            Show round dividers
          </label>
          <label><input type="checkbox" bind:checked={shareShowTagPills} /> Tag pills</label>
          <label><input type="checkbox" bind:checked={shareShowNoise} /> Noise texture</label>
          <label class:disabled={shareRenderMode === 'summary'}>
            <input type="checkbox" bind:checked={shareColorCodeRests} disabled={shareRenderMode === 'summary'} />
            Color-code rests
          </label>
          <label><input type="checkbox" bind:checked={shareShowBadge} /> Footer badge</label>
          <label><input type="checkbox" bind:checked={shareShowHrBlock} /> HR block</label>
          <label class:disabled={shareRenderMode === 'summary'}>
            <input type="checkbox" bind:checked={shareHighlightEnabled} disabled={shareRenderMode === 'summary'} />
            Highlight rows
          </label>
        </div>
        {#if shareHighlightEnabled && shareItem && shareRenderMode === 'detailed'}
          <div class="share-config share-highlights">
            <p class="muted small">Select rows to highlight:</p>
            <div class="highlight-grid">
              {#each shareSelectableRows as row}
                <label>
                  <input
                    type="checkbox"
                    checked={shareHighlights.has(row.index)}
                    on:change={(e) => {
                      const next = new Set(shareHighlights)
                      if (e.currentTarget.checked) next.add(row.index)
                      else next.delete(row.index)
                      shareHighlights = next
                      refreshSharePreview()
                    }}
                  />
                  {row.label}
                </label>
              {/each}
            </div>
          </div>
        {/if}
        <div class="actions">
          <button
            class="primary"
            on:click={() =>
              shareItem &&
              saveShareCard(shareItem, {
                renderMode: shareRenderMode,
                showReps: shareShowReps,
                showWork: shareShowWork,
                showSets: shareShowSets,
                showDividers: shareShowDividers,
                showTagPills: shareShowTagPills,
                showNoise: shareShowNoise,
                colorCodeRests: shareColorCodeRests,
                showBadge: shareShowBadge,
                showHrBlock: shareShowHrBlock,
                hrData: hrDetails[shareItem.id] ?? hrSummary[shareItem.id],
                highlights: shareHighlights
              })
            }
          >
            Save card (PNG)
          </button>
          <button class="ghost" on:click={() => (shareItem = null)}>Close</button>
        </div>
      </div>
      <div class="share-preview-panel">
        {#if sharePreviewUrl}
          <img src={sharePreviewUrl} alt="Share card preview" />
        {:else}
          <p class="muted small">Generating preview…</p>
        {/if}
      </div>
    </div>
  {/if}

  {#if insightsModalOpen}
    <div class="modal-backdrop"></div>
    <div class="insights-modal">
      <header class="insights-head">
        <div>
          <p class="eyebrow">AI insights</p>
          <p class="muted tiny">Uses your OpenAI key. Sends up to 25 filtered sessions.</p>
        </div>
        <div class="insights-head__actions">
          <button class="ghost small" type="button" on:click={openSettingsModal}>Settings</button>
          <button class="ghost small" type="button" on:click={() => (insightsModalOpen = false)}>✕</button>
        </div>
      </header>
      <textarea
        rows="4"
        placeholder="Ask for trends or feedback (e.g., 'Spot fatigue signs and suggest deloads')"
        bind:value={insightsQuestion}
      ></textarea>
      <div class="muted tiny">Visible sessions: {Math.min(visibleItems.length, 25)}</div>
      {#if !openAiKey.trim()}
        <p class="muted tiny">Add your API key in Settings to enable insights.</p>
      {/if}
      <div class="insights-actions">
        <button
          class="primary"
          type="button"
          disabled={insightsLoading || !visibleItems.length || !openAiKey.trim()}
          on:click={generateInsights}
        >
          {#if insightsLoading}Generating…{:else}Generate insights{/if}
        </button>
        <button class="ghost" type="button" on:click={() => (insightsModalOpen = false)}>Close</button>
        {#if insightsStatus}<span class="status small">{insightsStatus}</span>{/if}
        {#if insightsError}<span class="error small">{insightsError}</span>{/if}
      </div>
      {#if insightsAnswer}
        <div class="ai-output rich">
          {@html insightsHtml || insightsAnswer}
        </div>
      {/if}
    </div>
  {/if}

  {#if templateModalOpen}
    <div class="modal-backdrop"></div>
    <div class="template-modal">
      <header>
        <h3>Select template</h3>
        <button class="ghost" on:click={() => (templateModalOpen = false)}>✕</button>
      </header>
      <div class="template-list">
        {#if templates.length === 0}
          <p class="muted small">No templates available.</p>
        {:else}
          {#each templates as tmpl}
            <button
              class="template-item"
              on:click={() => {
                createLogFromTemplate(tmpl.id, tmpl.name)
                templateModalOpen = false
              }}
            >
              <div>
                <strong>{tmpl.name}</strong>
                {#if tmpl.description}<p class="muted small">{tmpl.description}</p>{/if}
              </div>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
  <input
    type="file"
    accept=".fit,.tcx"
    class="sr-only"
    bind:this={fileInputEl}
    on:change={(e) => {
      const file = e.currentTarget.files?.[0]
      if (!file || !uploadTargetId) {
        uploadTargetId = null
        return
      }
      const form = new FormData()
      form.append('file', file)
      fetch(`/api/completed-workouts/${uploadTargetId}/hr`, {
        method: 'POST',
        body: form
      })
        .then((res) => res.json())
        .then((data) => {
          uploadStatus = { ...uploadStatus, [uploadTargetId!]: data?.ok ? 'Uploaded' : 'Failed' }
          if (data?.ok) {
            hrAttached = { ...hrAttached, [uploadTargetId!]: true }
            if (data.summary?.avgHr || data.summary?.maxHr) {
              hrSummary = {
                ...hrSummary,
                [uploadTargetId!]: {
                  avgHr: data.summary.avgHr ?? null,
                  maxHr: data.summary.maxHr ?? null
                }
              }
            }
            if (data.summary?.samples) {
              hrDetails = {
                ...hrDetails,
                [uploadTargetId!]: {
                  avgHr: data.summary.avgHr ?? null,
                  maxHr: data.summary.maxHr ?? null,
                  samples: data.summary.samples ?? []
                }
              }
            }
            if (data.summary?.durationSeconds) {
              items = items.map((it) =>
                it.id === uploadTargetId
                  ? {
                      ...it,
                      duration_s: data.summary.durationSeconds,
                      started_at: data.summary.startTime ?? it.started_at,
                      finished_at:
                        data.summary.startTime && data.summary.durationSeconds
                          ? data.summary.startTime + data.summary.durationSeconds * 1000
                          : it.finished_at
                    }
                  : it
              )
            }
            checkHrStatus(uploadTargetId!)
          }
          setTimeout(() => {
            uploadStatus = { ...uploadStatus, [uploadTargetId!]: '' }
          }, 2000)
        })
        .catch(() => {
          uploadStatus = { ...uploadStatus, [uploadTargetId!]: 'Failed' }
          setTimeout(() => {
            uploadStatus = { ...uploadStatus, [uploadTargetId!]: '' }
          }, 2000)
        })
        .finally(() => {
          uploadTargetId = null
          if (fileInputEl) fileInputEl.value = ''
        })
    }}
  />
</div>

<style>
  .history-page {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    font-size: 1.05rem;
  }
  header h1 {
    margin: 0;
  }
  .ai-output {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-surface-1) 75%, transparent);
    padding: 0.75rem;
    font-size: 0.95rem;
    white-space: pre-wrap;
    line-height: 1.35;
    max-height: 240px;
    overflow: auto;
  }
  .insights-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(620px, 95vw);
    max-height: 90vh;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    padding: 1rem;
    z-index: 505;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
  }
  .insights-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }
  .insights-head__actions {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .insights-modal textarea {
    width: 100%;
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: 0.6rem 0.7rem;
    resize: vertical;
    min-height: 120px;
  }
  .insights-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .compare-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(1100px, 96vw);
    max-height: 92vh;
    overflow-y: auto;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 1rem;
    z-index: 130;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
  }
  .compare-head {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    align-items: flex-start;
  }
  .compare-head__actions {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .compare-top {
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    gap: 0.75rem;
    align-items: start;
  }
  .compare-card,
  .compare-suggestions,
  .manual-compare,
  .compare-results {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--color-surface-1) 70%, transparent);
  }
  .compare-suggestions__head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .suggestion-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .suggestion-card {
    border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
    border-radius: 10px;
    padding: 0.6rem 0.65rem;
    background: color-mix(in srgb, var(--color-surface-2) 60%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .suggestion-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }
  .score-pill {
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
    color: var(--color-accent);
    font-weight: 700;
  }
  .manual-compare {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .manual-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .manual-head input {
    flex: 1;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    padding: 0.45rem 0.6rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }
  .manual-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .manual-row {
    width: 100%;
    border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
    border-radius: 10px;
    padding: 0.5rem 0.6rem;
    background: color-mix(in srgb, var(--color-surface-2) 50%, transparent);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    text-align: left;
  }
  .manual-row__body {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .compare-results {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .compare-metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 0.4rem;
  }
  .metric-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.35rem;
    align-items: center;
    border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
    padding: 0.35rem 0.4rem;
    border-radius: 10px;
  }
  .metric-label {
    color: var(--color-text-muted);
  }
  .metric-values {
    display: grid;
    grid-template-columns: auto auto auto auto;
    gap: 0.35rem;
    align-items: center;
    justify-content: end;
  }
  .delta {
    padding: 0.1rem 0.35rem;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    font-weight: 700;
    font-size: 0.9rem;
  }
  .delta.up {
    color: var(--color-accent);
    border-color: color-mix(in srgb, var(--color-accent) 60%, var(--color-border));
  }
  .delta.down {
    color: var(--color-danger);
    border-color: color-mix(in srgb, var(--color-danger) 70%, var(--color-border));
  }
  .compare-summaries {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 0.75rem;
  }
  .summary-col header {
    margin-bottom: 0.25rem;
  }
  .compare-hr {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 0.6rem;
  }
  .hr-shared-toggle {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    font-size: 0.9rem;
    color: var(--color-text-muted);
  }
  .hr-shared-toggle input {
    margin-right: 0.35rem;
  }
  .hr-compare-card {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .exercise-diffs {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
    padding: 0.6rem;
    border-radius: 10px;
    background: color-mix(in srgb, var(--color-surface-1) 60%, transparent);
  }
  .diff-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
  }
  .diff-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .diff-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.35rem 0.5rem;
    align-items: center;
    padding: 0.45rem 0.5rem;
    border: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--color-surface-2) 55%, transparent);
  }
  .diff-label {
    font-weight: 700;
  }
  .diff-deltas {
    display: inline-flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
  .diff-baseline {
    display: inline-flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
  .diff-unmatched {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.4rem;
  }
  .pill-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .chip.subtle {
    background: color-mix(in srgb, var(--color-surface-2) 70%, transparent);
    border-color: color-mix(in srgb, var(--color-border) 70%, transparent);
  }
  .baseline {
    position: relative;
    padding-left: 0.5rem;
    font-size: 0.9rem;
  }
  .baseline.source {
    border-color: color-mix(in srgb, var(--color-accent) 60%, var(--color-border));
  }
  .baseline.target {
    border-color: color-mix(in srgb, var(--color-border) 70%, transparent);
  }
  .delta.pill {
    background: color-mix(in srgb, var(--color-surface-2) 65%, transparent);
    border-color: color-mix(in srgb, var(--color-border) 70%, transparent);
    font-weight: 600;
  }
  .metric-arrow {
    font-weight: 700;
    color: var(--color-text-muted);
  }
  .metric-arrow.up {
    color: var(--color-accent);
  }
  .metric-arrow.down {
    color: var(--color-danger);
  }
  @media (max-width: 900px) {
    .compare-top {
      grid-template-columns: 1fr;
    }
    .compare-modal {
      max-height: 90vh;
    }
  }
  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.8rem;
    margin: 0;
    color: var(--color-text-muted);
  }
  .muted.tiny {
    font-size: 0.8rem;
  }
  .list {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(900px, 1fr));
    gap: 1.25rem;
    justify-items: stretch;
    align-items: start;
  }
  .card {
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 1.05rem;
    background: color-mix(in srgb, var(--color-surface-2) 85%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
  }

  @media (max-width: 760px) {
    .list {
      grid-template-columns: 1fr;
    }
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .card-header.two-col {
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    gap: 0.75rem;
    align-items: center;
  }
  .header-left {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .meta-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .tag-row.inline {
    display: inline-flex;
    gap: 0.35rem;
  }
  .header-right {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.5rem;
  }
  .badge {
    padding: 0.25rem 0.6rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
  }
  .badge.subtle {
    background: color-mix(in srgb, var(--color-surface-1) 50%, transparent);
  }
  .summary-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    justify-content: flex-end;
  }
  .chip {
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface-1) 70%, transparent);
    font-size: 0.9rem;
    color: var(--color-text-primary);
  }
  .chip.hr {
    border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
  }
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
  .compact-summary .summary-line {
    line-height: 1.2;
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
  @media (max-width: 520px) {
    .summary-chip {
      font-size: 0.84rem;
      gap: 0.3rem;
    }
    .summary-chip.fancy .chip-pill {
      padding: 0.12rem 0.4rem;
    }
  }
  .hr-card {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    align-items: flex-end;
    min-width: 320px;
    justify-content: center;
  }
  .hr-card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }
  .hr-stats {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: flex-end;
    color: var(--color-text-muted);
    font-size: 0.95rem;
  }
  .hr-spark {
    width: 320px;
    height: 120px;
    background: var(--hr-spark-bg, color-mix(in srgb, var(--color-surface-1) 70%, transparent));
    border: 1px solid var(--hr-spark-border, color-mix(in srgb, var(--color-border) 60%, transparent));
    border-radius: 10px;
  }
  .hr-spark .hr-line {
    stroke: var(--hr-spark-line, var(--color-text-primary));
  }
  .hr-spark .avg-line {
    stroke: var(--hr-spark-avg, color-mix(in srgb, var(--color-text-muted) 70%, transparent));
  }
  .hr-spark .hr-max {
    fill: var(--hr-spark-max, var(--color-accent));
  }
  .meta-edit {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.5rem;
    align-items: center;
  }
  .meta-edit input {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.45rem 0.6rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }
  .notes-field input {
    min-width: 240px;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    margin-bottom: 0.25rem;
  }
  .filters {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .filters input,
  .filters select {
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.4rem 0.6rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }
  .filters select.compact {
    min-width: 150px;
  }
  .inline-filter {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--color-text-muted);
    font-size: 0.95rem;
  }
  .inline-filter input {
    width: 16px;
    height: 16px;
  }
  .tag-filter {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .tag-chip {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 0.2rem 0.55rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    cursor: pointer;
    font-size: 0.9rem;
  }
  .tag-chip.selected {
    background: color-mix(in srgb, var(--color-accent) 20%, var(--color-surface-1));
    border-color: color-mix(in srgb, var(--color-accent) 60%, var(--color-border));
  }
  .tag-row {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
    margin-bottom: 0.35rem;
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
  .tag-input-wrap input {
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.4rem 0.55rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }
  .set-grid-labels {
    display: none;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .mobile-label {
    display: none;
    font-size: 0.82rem;
    color: var(--color-text-muted);
  }
  .template-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 1rem;
    min-width: 320px;
    width: min(520px, 90vw);
    max-height: 80vh;
    overflow: auto;
    z-index: 110;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: stretch;
  }
  .template-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .template-item {
    text-align: left;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    cursor: pointer;
  }
  .sets {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
  }
  .set-row {
    width: 100%;
    border: 1px solid color-mix(in srgb, var(--color-border) 65%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--color-surface-1) 60%, transparent);
    padding: 0.5rem 0.65rem;
  }
  .view-row {
    display: grid;
    grid-template-columns: 1.3fr 1.2fr 0.6fr 0.45fr 0.45fr 0.45fr;
    gap: 0.3rem;
    align-items: center;
  }
  .view-row.rest-row {
    grid-template-columns: 1fr;
    background: color-mix(in srgb, var(--color-surface-2) 50%, transparent);
  }
  .edit-row {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.6rem;
  }
  .row-main {
    display: grid;
    grid-template-columns: 1fr 1.25fr 0.55fr 0.55fr 0.55fr 0.55fr 1fr;
    gap: 0.35rem;
    align-items: center;
  }
  .row-main.rest-row {
    grid-template-columns: 1fr 1.25fr 0.55fr 0.55fr 0.55fr 0.55fr 1fr;
  }
  .inline-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    justify-content: flex-end;
    grid-column: 7 / 8;
  }
  .edit-row.rest-row {
    opacity: 0.85;
    grid-template-columns: 1fr;
    background: color-mix(in srgb, var(--color-surface-2) 50%, transparent);
  }
  .set-row input {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.4rem 0.55rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }
  .set-row input.narrow {
    max-width: 120px;
  }
  .rest-label {
    grid-column: 1 / -1;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .card-actions-row .destructive {
    margin-left: auto;
  }
  .toggle-btn {
    border-radius: 10px;
    width: 36px;
    height: 36px;
  }
  .export-group {
    display: inline-flex;
    gap: 0.25rem;
  }
  .card-actions-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    margin: 0.35rem 0 0.15rem;
    position: relative;
  }
  .card-actions-row button {
    height: 34px;
  }
  .mobile-hidden {
    display: inline-flex;
  }
  .overflow-wrapper {
    position: relative;
    display: inline-flex;
  }
  .sticky-end {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-left: auto;
  }
  .mobile-overflow {
    display: none;
  }
  .overflow-menu {
    position: absolute;
    right: 0;
    left: auto;
    top: calc(100% + 6px);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.4rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    z-index: 25;
    min-width: 160px;
    max-width: min(260px, 80vw);
    width: max-content;
  }
  .overflow-menu button {
    text-align: left;
    justify-content: flex-start;
    width: 100%;
  }
  @media (max-width: 720px) {
    .card-actions-row {
      gap: 0.25rem;
    }
    .card-actions-row .secondary-action {
      display: none;
    }
    .mobile-hidden {
      display: none;
    }
    .mobile-overflow {
      display: inline-flex;
    }
    .sticky-end {
      flex-basis: 100%;
      justify-content: flex-end;
      margin-left: 0;
    }
    .overflow-menu {
      right: 0;
      left: auto;
    }
  }
  .text-button {
    background: transparent;
    border: none;
    color: var(--color-accent);
    font-weight: 600;
    cursor: pointer;
    padding: 0.2rem 0.35rem;
  }
  .text-button:hover {
    color: var(--color-accent-hover);
    text-decoration: underline;
  }
  .actions .destructive {
    margin-left: auto;
  }
  .hr-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
    color: var(--color-accent);
    margin-left: 0.35rem;
    font-size: 0.8rem;
  }
  .toast-stack {
    position: fixed;
    top: 1rem;
    right: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    z-index: 220;
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
  :global(body.modal-open) {
    overflow: hidden;
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(-10px) translateX(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0) translateX(0);
    }
  }
  @keyframes toast-out {
    to {
      opacity: 0;
      transform: translateY(-6px) translateX(8px);
    }
  }
  @media (max-width: 720px) {
    .meta-edit {
      grid-template-columns: 1fr;
    }
    .row-main {
      grid-template-columns: 1fr;
      gap: 0.4rem;
    }
    .inline-actions {
      grid-column: 1 / -1;
      justify-content: flex-start;
    }
    .set-row input,
    .set-row input.narrow {
      max-width: 100%;
    }
    .mobile-label {
      display: block;
    }
    .row-main {
      align-items: stretch;
    }
  }

  @media (min-width: 721px) {
    .set-grid-labels {
      display: grid;
      grid-template-columns: 1fr 1.2fr 0.6fr 0.45fr 0.45fr 0.45fr 1fr;
      gap: 0.35rem;
      align-items: center;
      margin-bottom: 0.15rem;
      color: var(--color-text-muted);
      font-size: 0.85rem;
      padding: 0 0.15rem;
    }
    .row-main,
    .row-main.rest-row {
      grid-template-columns: 1fr 1.2fr 0.6fr 0.45fr 0.45fr 0.45fr 1fr;
    }
    .inline-actions {
      grid-column: 7 / 8;
    }
  }

  @media (max-width: 720px) {
    .card-header.two-col {
      grid-template-columns: 1fr;
      gap: 0.75rem;
    }
    .header-right {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      align-items: flex-start;
    }
    .hr-card {
      width: 100%;
      align-items: flex-start;
    }
    .summary-chips {
      justify-content: flex-start;
    }
    .hr-card-top {
      width: 100%;
      justify-content: flex-start;
      gap: 0.4rem;
    }
    .hr-card {
      align-items: flex-start;
    }
    .hr-spark {
      width: 100%;
    }
  }
.view-toggle {
  display: inline-flex;
  gap: 0.25rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 0.15rem;
}
.view-toggle button {
  border: none;
  background: transparent;
  padding: 0.35rem 0.65rem;
  border-radius: 8px;
  color: var(--color-text-primary);
}
.view-toggle button.active {
  background: color-mix(in srgb, var(--color-accent) 25%, var(--color-surface-1));
  color: var(--color-accent-muted);
}
.calendar-shell {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.calendar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.month-nav {
  display: inline-flex;
  gap: 0.35rem;
  align-items: center;
}
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.45rem;
  background: color-mix(in srgb, var(--color-surface-1) 60%, transparent);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 1rem;
  width: 100%;
}
.dow {
  text-align: center;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}
.day {
  min-height: 110px;
  min-width: 0;
  width: 100%;
  max-width: 100%;
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
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-accent);
  opacity: 0.6;
}
.day-list {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  width: 100%;
}
.day-row {
  display: grid;
  grid-template-columns: 10px 1fr;
  align-items: center;
  gap: 0.3rem;
  padding: 0.1rem 0.15rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-surface-1) 30%, transparent);
  min-width: 0;
  width: 100%;
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
.day-row-badge {
  font-size: 0.55rem;
}
.day-row-hr {
  font-size: 0.55rem;
  padding: 0.08rem 0.3rem;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--color-accent) 60%, var(--color-border));
  color: var(--color-accent);
}

.week-head,
.week-list {
  display: none;
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
  grid-template-columns: 10px 1fr auto;
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
.week-row__meta {
  display: flex;
  gap: 0.3rem;
  align-items: center;
  font-size: 0.8rem;
}

@media (max-width: 720px) {
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
}
.calendar-detail {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 0.9rem;
  background: color-mix(in srgb, var(--color-surface-2) 70%, transparent);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.calendar-detail h4 {
  margin: 0;
}
.compact-list .card {
  grid-template-columns: 1fr;
  min-width: 0;
}
@media (max-width: 980px) {
  .calendar-grid {
    grid-template-columns: repeat(7, minmax(38px, 1fr));
    padding: 0.75rem;
  }
}
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }
  .mini-buttons {
    display: inline-flex;
    gap: 0.25rem;
  }
  .mini-buttons button {
    padding: 0.35rem 0.55rem;
  }
  .icon-btn i {
    font-size: 1rem;
    line-height: 1;
    display: inline-block;
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 100;
  }
  .confirm-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 1rem;
    min-width: 260px;
    max-height: 80vh;
    overflow-y: auto;
    z-index: 110;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .share-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 1.1rem;
    width: min(900px, 95vw);
    max-height: 90vh;
    overflow: auto;
    z-index: 120;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .share-modal.two-col {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 1rem;
    align-items: stretch;
  }
  .share-config-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.5rem;
  }
  .share-config {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .share-config label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.95rem;
    color: var(--color-text-muted);
  }
  .share-config label.disabled {
    opacity: 0.55;
  }
  .share-config label input {
    width: 16px;
    height: 16px;
  }
  .share-preview-panel {
    background: color-mix(in srgb, var(--color-surface-1) 60%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
    border-radius: 14px;
    padding: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
  }
  .share-preview-panel img {
    max-width: 100%;
    height: auto;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
  }
  .add-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.35rem;
  }
  @media (max-width: 720px) {
    .share-modal {
      width: 95vw;
      max-height: 90vh;
      padding: 0.85rem;
      overflow-y: auto;
    }
    .share-modal.two-col {
      grid-template-columns: 1fr;
      grid-auto-rows: auto;
      gap: 0.75rem;
    }
    .share-config-panel {
      padding: 0.25rem;
      border-bottom: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
    }
    .share-preview-panel {
      max-height: 50vh;
    }
    .share-preview-panel img {
      width: 100%;
    }
  }
  button {
    padding: 0.45rem 0.8rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    cursor: pointer;
  }
  button.primary {
    background: color-mix(in srgb, var(--color-accent) 75%, var(--color-surface-1));
    color: var(--color-text-inverse);
    border-color: color-mix(in srgb, var(--color-accent) 70%, var(--color-border));
    font-weight: 700;
  }
  button.primary:hover {
    background: color-mix(in srgb, var(--color-accent) 85%, var(--color-surface-1));
  }
  .mini-buttons button.primary {
    flex: 1;
  }
  button.danger {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }
  .ghost {
    background: transparent;
  }
  .muted {
    color: var(--color-text-muted);
    margin: 0;
  }
  .muted.small {
    font-size: 0.85rem;
  }
  .error {
    color: var(--color-danger);
  }
  .status {
    color: var(--color-text-muted);
  }
  .status.small,
  .error.small {
    font-size: 0.9rem;
  }
  .title-input {
    width: 100%;
    max-width: 900px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.5rem 0.65rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }
  @media (max-width: 720px) {
    .set-row {
      grid-template-columns: 1fr;
      padding: 0.45rem 0.5rem;
    }
    .set-row.rest-row {
      grid-template-columns: 1fr;
    }
    .actions {
      justify-content: flex-start;
    }
    .row-main {
      grid-template-columns: 1fr;
    }
  }
</style>
