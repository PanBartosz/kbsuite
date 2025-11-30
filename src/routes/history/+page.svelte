<script lang="ts">
  import { onMount } from 'svelte'
  import YAML from 'yaml'
  import { buildTimeline } from '$lib/timer/lib/timeline'
  import { browser } from '$app/environment'

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

  let items: CompletedWorkout[] = []
  let loading = false
  let error = ''
  let status = ''
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
  let newWorkoutStatus = ''
  let searchTerm = ''
  let dateFilter: 'all' | '7' | '30' = 'all'
  let visibleItems: CompletedWorkout[] = []
  let selectedTags: string[] = []
  let availableTags: string[] = []
  let templates: { id: string; name: string; description?: string; yaml_source?: string; plan_json?: any }[] = []
  let templateModalOpen = false
  let confirmDeleteId: string | null = null
  let shareItem: CompletedWorkout | null = null
  let shareRoundCol = 120
  let shareShowReps = true
  let shareShowWork = true
  let shareShowSets = true
  let sharePreviewUrl = ''

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
    } catch (err) {
      const message = (err as any)?.message ?? 'Failed to load history'
      error = message
    } finally {
      loading = false
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
    const hasTerm = haystack.some((v) => normalize(v).includes(term))
    if (!hasTerm) return false
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

  $: visibleItems = items.filter((item) => matchesFilters(item, searchTerm, dateFilter))
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
      status = 'Copied summary'
      setTimeout(() => (status = ''), 2000)
    } catch (err) {
      status = 'Copy failed'
      setTimeout(() => (status = ''), 2000)
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
      status = 'Duplicated'
    } catch (err) {
      status = (err as any)?.message ?? 'Duplicate failed'
    } finally {
      setTimeout(() => (status = ''), 2000)
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
      newWorkoutStatus = 'Created empty session log.'
    } catch (err) {
      newWorkoutStatus = (err as any)?.message ?? 'Create failed'
    } finally {
      setTimeout(() => (newWorkoutStatus = ''), 2500)
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
      newWorkoutStatus = 'Logged from template.'
    } catch (err) {
      newWorkoutStatus = (err as any)?.message ?? 'Copy failed'
    } finally {
      setTimeout(() => (newWorkoutStatus = ''), 2500)
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
    const totalReps = (item.sets ?? []).reduce((sum, s) => sum + (Number(s.reps) || 0), 0)
    const totalWorkSeconds = (item.sets ?? []).reduce(
      (sum, s) => sum + ((s.type && s.type !== 'work') ? 0 : Number(s.duration_s) || 0),
      0
    )
    const totalSets = (item.sets ?? []).filter((s) => !s.type || s.type === 'work').length
    return { totalReps, totalWorkSeconds, totalSets }
  }

  const formatShort = (seconds?: number | null) => {
    if (!seconds || seconds <= 0) return ''
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return `${mins}m ${secs}s`
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
      status = 'Copied CSV'
    } catch {
      status = 'Copy failed'
    } finally {
      setTimeout(() => (status = ''), 2000)
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
    opts?: { showReps?: boolean; showWork?: boolean; showSets?: boolean; previewEl?: HTMLImageElement }
  ) => {
    if (!browser) return
    const { totalReps, totalWorkSeconds, totalSets } = computeTotals(item)
    const filtered = (item.sets ?? []).filter((s) => (s.type ?? '').toLowerCase() !== 'prep')
    const sets = mergeRests(filtered)
    const rowHeight = 58
    const maxRows = 28
    const rowsForHeight = Math.min(sets.length || 1, maxRows)
    const width = 1200
    const pad = 60
    const headerBlock = 360 // title + stats + spacing before rows
    const contentHeight = headerBlock + rowsForHeight * rowHeight + 80
    const height = Math.max(750, pad + contentHeight + pad)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const getCssColor = (name: string, fallback: string) => {
      if (typeof window === 'undefined') return fallback
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      return v || fallback
    }

    const surface1 = getCssColor('--color-surface-1', '#0c1220')
    const surface2 = getCssColor('--color-surface-2', '#0d2038')
    const border = getCssColor('--color-border', 'rgba(255,255,255,0.12)')
    const textPrimary = getCssColor('--color-text-primary', '#f8fbff')
    const textMuted = getCssColor('--color-text-muted', 'rgba(255,255,255,0.7)')
    const accent = getCssColor('--color-accent', '#4dabf7')

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
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      ctx.fillText('Tags:', pad + 36, pillY + 70)
      let tagX = pad + 110
      tags.forEach((t) => {
        const txt = `#${t}`
        const w = ctx.measureText(txt).width + 26
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.beginPath()
      ctx.roundRect(tagX, pillY + 44, w, 34, 12)
      ctx.fill()
      ctx.fillStyle = textPrimary
      ctx.fillText(txt, tagX + 12, pillY + 68)
      tagX += w + 10
    })
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
    ctx.font = '30px "Inter", system-ui, -apple-system, sans-serif'
    ctx.fillStyle = textPrimary
    ctx.fillText('Session', startX, listY)
    const rows = sets.slice(0, maxRows)
    ctx.font = '21px "Inter", system-ui, -apple-system, sans-serif'
    ctx.textBaseline = 'middle'
    rows.forEach((s, i) => {
      const rowTop = listY + 38 + i * rowHeight
      const rowCenter = rowTop + rowHeight / 2
      const isRest = s.type && s.type !== 'work'
      const label = isRest ? 'Rest' : s.set_label ?? s.round_label ?? `Set ${i + 1}`
      const roundLabel = !isRest ? s.round_label ?? '' : ''
      const duration = s.duration_s ? formatShort(s.duration_s) : ''
      const reps =
        !isRest && s.reps !== null && s.reps !== undefined ? `${s.reps} reps` : ''
      const weight =
        !isRest && s.weight !== null && s.weight !== undefined ? `@ ${s.weight}` : ''
      const rpe = !isRest && s.rpe !== null && s.rpe !== undefined ? `RPE ${s.rpe}` : ''

      // row background
      const inset = 20
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.07)'
      ctx.fillRect(startX - inset, rowTop + 4 , endX - startX + inset * 2, rowHeight - 10)

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
    })
    ctx.textBaseline = 'alphabetic'

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
      status = 'Saved'
      setTimeout(() => (status = ''), 2000)
      cancelEdit()
    } catch (err) {
      status = (err as any)?.message ?? 'Save failed'
      setTimeout(() => (status = ''), 2000)
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

  $: if (shareItem) {
    const longest =
      shareItem.sets?.reduce((max, s) => Math.max(max, (s.round_label ?? '').length), 0) ?? 0
    shareRoundCol = Math.max(80, Math.min(180, longest * 8 + 16))
    // Refresh preview when share modal opens or toggles change
    if (browser) {
      setTimeout(async () => {
        if (shareItem) {
          // Generate a temporary image element
          const img = new Image()
          await saveShareCard(shareItem, {
            showReps: shareShowReps,
            showWork: shareShowWork,
            showSets: shareShowSets,
            previewEl: img
          })
          sharePreviewUrl = img.src
        }
      }, 0)
    }
  }
</script>

<main class="page">
  <header>
    <h1>History</h1>
    <p>Completed workouts saved from the summary modal.</p>
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
      </div>
      {#if newWorkoutStatus}
        <span class="status">{newWorkoutStatus}</span>
      {/if}
    </div>

    {#if visibleItems.length === 0}
      <p class="muted">No matching workouts.</p>
    {:else}
      <div class="list">
        {#each visibleItems as item}
        <article class="card">
          <div class="card-header">
            <div>
              {#if editingId === item.id}
                <input
                  class="title-input"
                  bind:value={editTitle}
                  placeholder="Workout title"
                />
              {:else}
                <h3>{item.title || 'Workout'}</h3>
                <p class="muted small">{formatDate(item.started_at || item.created_at)}</p>
              {/if}
            </div>
            {#if item.duration_s}
              <span class="badge">{formatDuration(item.duration_s)}</span>
            {/if}
          </div>
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
            </div>
          {:else}
            {#if item.tags?.length}
              <div class="tag-row">
                {#each item.tags as tag}
                  <span class="tag-chip selected">{tag}</span>
                {/each}
              </div>
            {/if}
            {#if item.notes}
              <p class="muted small">Notes: {item.notes}</p>
            {/if}
          {/if}
          {#if editingId === item.id}
            <div class="sets">
              {#each editSets as set, idx}
                {@const isRest = set.type && set.type !== 'work'}
                <div class="set-row edit-row" class:rest-row={isRest}>
                  <div class="row-main" class:rest-row={isRest}>
                    {#if isRest}
                      <span class="muted small">Rest</span>
                      <span></span>
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
                      <span></span>
                      <span></span>
                      <span></span>
                    {:else}
                      <input
                        class="round-input"
                        placeholder="Round"
                        value={set.round_label ?? ''}
                        on:input={(e) => updateSetField(idx, { round_label: e.currentTarget.value })}
                      />
                      <input
                        class="label-input"
                        placeholder="Set label"
                        value={set.set_label ?? ''}
                        on:input={(e) => updateSetField(idx, { set_label: e.currentTarget.value })}
                      />
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
                        <button class="ghost small danger icon-btn" aria-label="Delete row" on:click={() => deleteSet(idx)}>
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
            </div>
          {:else}
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
              <button class="ghost" on:click={() => copySummary(item)}>Copy summary</button>
              <button class="ghost" on:click={() => copyCsv(item)}>Copy CSV</button>
              <button
                class="ghost"
                on:click={() => {
                  shareItem = item
                  shareShowReps = true
                  shareShowWork = true
                  shareShowSets = true
                }}
              >
                Share card
              </button>
              <button class="ghost" on:click={() => loadInTimer(item)} disabled={!item.workout_id}>Load in timer</button>
              <button class="ghost" on:click={() => loadInBigPicture(item)} disabled={!item.workout_id}>Load in Big Picture</button>
              <button class="ghost" on:click={() => startEdit(item)}>Edit</button>
              <button class="ghost" on:click={() => duplicateLog(item)}>Log again</button>
              <button class="ghost" on:click={() => duplicateWorkoutFromItem(item)}>Save as workout</button>
              <button class="danger" on:click={() => (confirmDeleteId = item.id)}>Delete</button>
            </div>
          {/if}
        </article>
      {/each}
      </div>
    {/if}
  {/if}

  {#if status}
    <p class="status">{status}</p>
  {/if}
  {#if confirmDeleteId}
    <div class="modal-backdrop"></div>
    <div class="confirm-modal">
      <p>Delete this session?</p>
      <div class="actions">
        <button class="ghost" on:click={() => (confirmDeleteId = null)}>Cancel</button>
        <button
          class="danger"
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

  {#if shareItem}
    <div class="modal-backdrop"></div>
    <div class="share-modal two-col">
      <div class="share-config-panel">
        <header>
          <h3>Share card</h3>
          <p class="muted small">Configure what to show.</p>
        </header>
        <div class="share-config">
          <label><input type="checkbox" bind:checked={shareShowReps} /> Include total reps</label>
          <label><input type="checkbox" bind:checked={shareShowWork} /> Include total work time</label>
          <label><input type="checkbox" bind:checked={shareShowSets} /> Include total sets</label>
        </div>
        <div class="actions">
          <button
            class="primary"
            on:click={() =>
              shareItem &&
              saveShareCard(shareItem, {
                showReps: shareShowReps,
                showWork: shareShowWork,
                showSets: shareShowSets
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
</main>

<style>
  .page {
    max-width: 1500px;
    margin: 0 auto;
    padding: 2rem 1.5rem 3rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    font-size: 1.05rem;
  }
  header h1 {
    margin: 0;
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
  .badge {
    padding: 0.25rem 0.6rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
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
    max-height: 80vh;
    overflow: auto;
    z-index: 110;
    display: grid;
    grid-template-columns: 320px 1fr;
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
    max-width: 80px;
  }
  .rest-label {
    grid-column: 1 / -1;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
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
    min-width: min(820px, 95vw);
    max-height: 90vh;
    overflow: hidden;
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
  button {
    padding: 0.45rem 0.8rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    cursor: pointer;
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
