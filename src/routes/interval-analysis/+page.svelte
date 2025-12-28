<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { formatSeconds, safeInt } from '$lib/hr/manualIntervals'

  type AnalysisListItem = {
    id: string
    title?: string
    started_at?: number | null
    created_at?: number | null
    duration_s?: number | null
    version?: string
    analysis_updated_at?: number | null
    block?: any
    config?: any
  }

  type SavedAnalysis = {
    version?: string
    generatedAt?: string
    workoutId?: string | null
    block?: { rounds?: number; workSeconds?: number; restSeconds?: number; offsetSeconds?: number }
    config?: { peakExtensionSec?: number; endWindowSec?: number; hrrWindowSec?: number }
    trends?: any
    perRound?: any[]
  }

  let items: AnalysisListItem[] = []
  let loading = false
  let error = ''
  let search = ''

  let selected: Set<string> = new Set()
  let analyses: Record<string, SavedAnalysis | null> = {}
  let analysisErrors: Record<string, string> = {}

  let roundsLimit = 0 // 0 = auto (min across selected)

  let chartEl: HTMLDivElement | null = null
  let chart: any | null = null
  let echarts: any | null = null
  let resizeObserver: ResizeObserver | null = null

  const getTheme = () => {
    if (typeof window === 'undefined') {
      return {
        text: '#e2e8f0',
        muted: '#94a3b8',
        border: '#1f2a40',
        surface: '#0f172a',
        accent: '#22d3ee'
      }
    }
    const s = getComputedStyle(document.documentElement)
    const pick = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
    return {
      text: pick('--color-text-primary', '#e2e8f0'),
      muted: pick('--color-text-muted', '#94a3b8'),
      border: pick('--color-border', '#1f2a40'),
      surface: pick('--color-surface-2', '#0f172a'),
      accent: pick('--color-accent', '#22d3ee')
    }
  }

  const fmt = (n: number | null) => (n === null ? '–' : String(Math.round(n * 10) / 10))
  const fmtSlope = (n: number | null) => (n === null ? '–' : `${(Math.round(n * 100) / 100).toFixed(2)}`)

  const formatDate = (ts?: number | null) => {
    if (!ts) return '–'
    try {
      return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(ts))
    } catch {
      return new Date(ts).toLocaleDateString()
    }
  }

  const titleFor = (it: AnalysisListItem) => (it.title && it.title.trim() ? it.title.trim() : it.id.slice(0, 8))

  const safeJson = async (res: Response) => {
    try {
      return await res.json()
    } catch {
      return {}
    }
  }

  const loadList = async () => {
    loading = true
    error = ''
    try {
      const res = await fetch('/api/hr-interval-analysis')
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      items = Array.isArray(data?.items) ? data.items : []
    } catch (err) {
      console.warn('Failed to load interval analysis list', err)
      error = (err as any)?.message ?? 'Failed to load.'
      items = []
    } finally {
      loading = false
    }
  }

  const loadAnalysis = async (id: string) => {
    analysisErrors = { ...analysisErrors, [id]: '' }
    try {
      const res = await fetch(`/api/completed-workouts/${id}/hr-interval-analysis`)
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      const analysis = data?.analysis ?? null
      analyses = { ...analyses, [id]: analysis }
      if (!analysis) {
        analysisErrors = { ...analysisErrors, [id]: 'No saved analysis payload.' }
      }
    } catch (err) {
      console.warn('Failed to load analysis', id, err)
      analyses = { ...analyses, [id]: null }
      analysisErrors = { ...analysisErrors, [id]: (err as any)?.message ?? 'Load failed' }
    }
  }

  const ensureLoaded = async (ids: string[]) => {
    const todo = ids.filter((id) => analyses[id] === undefined)
    if (!todo.length) return
    await Promise.all(todo.map((id) => loadAnalysis(id)))
  }

  const toggle = async (id: string) => {
    if (selected.has(id)) {
      selected = new Set([...selected].filter((x) => x !== id))
      return
    }
    selected = new Set([...selected, id])
    await ensureLoaded([id])
  }

  const clearSelection = () => {
    selected = new Set()
  }

  const selectAllVisible = async () => {
    const ids = filtered.map((it) => it.id)
    selected = new Set(ids)
    await ensureLoaded(ids)
  }

  const mean = (values: Array<number | null>) => {
    let sum = 0
    let n = 0
    for (const v of values) {
      if (v === null || !Number.isFinite(v)) continue
      sum += v
      n++
    }
    return n ? sum / n : null
  }

  const slope = (values: Array<number | null>) => {
    const points: Array<{ x: number; y: number }> = []
    for (let i = 0; i < values.length; i++) {
      const y = values[i]
      if (y === null || !Number.isFinite(y)) continue
      points.push({ x: i + 1, y })
    }
    const n = points.length
    if (n < 2) return null as number | null
    let sumX = 0
    let sumY = 0
    let sumXX = 0
    let sumXY = 0
    for (const p of points) {
      sumX += p.x
      sumY += p.y
      sumXX += p.x * p.x
      sumXY += p.x * p.y
    }
    const denom = n * sumXX - sumX * sumX
    if (!denom) return null
    return (n * sumXY - sumX * sumY) / denom
  }

  const extractSeries = (analysis: SavedAnalysis | null, key: string, n: number) => {
    if (!analysis?.perRound || !Array.isArray(analysis.perRound)) return [] as Array<number | null>
    const out: Array<number | null> = []
    for (let i = 0; i < n; i++) {
      const row = analysis.perRound[i] ?? null
      const v = row && typeof row[key] === 'number' && Number.isFinite(row[key]) ? Number(row[key]) : null
      out.push(v)
    }
    return out
  }

  type NormalizationMode = 'none' | 'delta' | 'zscore'
  type HrrDisplayMode = 'delta' | 'percent'

  let showPeak = true
  let showEnd = true
  let showHrr = true
  let showTau = false

  let normalization: NormalizationMode = 'none'
  let hrrDisplay: HrrDisplayMode = 'delta'

  const deriveHrrPercent = (hrr: Array<number | null>, endHr: Array<number | null>) =>
    hrr.map((v, i) => {
      const end = endHr[i]
      if (v === null || end === null) return null
      if (!Number.isFinite(v) || !Number.isFinite(end) || end <= 0) return null
      return (100 * v) / end
    })

  const normalizeSeries = (values: Array<number | null>, mode: NormalizationMode) => {
    if (mode === 'none') return values
    const numeric = values.filter((v) => v !== null && Number.isFinite(v)) as number[]
    if (!numeric.length) return values.map(() => null)

    if (mode === 'delta') {
      const baseline = values.find((v) => v !== null && Number.isFinite(v)) as number | undefined
      if (baseline === undefined) return values.map(() => null)
      return values.map((v) => (v === null || !Number.isFinite(v) ? null : v - baseline))
    }

    const mu = numeric.reduce((acc, v) => acc + v, 0) / numeric.length
    const variance = numeric.reduce((acc, v) => acc + (v - mu) * (v - mu), 0) / numeric.length
    const sd = Math.sqrt(variance)
    if (!sd) return values.map((v) => (v === null || !Number.isFinite(v) ? null : 0))
    return values.map((v) => (v === null || !Number.isFinite(v) ? null : (v - mu) / sd))
  }

  $: filtered = items.filter((it) => {
    const term = (search ?? '').toLowerCase().trim()
    if (!term) return true
    const hay = `${it.title ?? ''} ${it.id}`.toLowerCase()
    return hay.includes(term)
  })

  $: selectedItems = items.filter((it) => selected.has(it.id))

  $: availableRoundCounts = selectedItems
    .map((it) => {
      const a = analyses[it.id]
      const n = Array.isArray(a?.perRound) ? a!.perRound!.length : safeInt((it.block as any)?.rounds)
      return n > 0 ? n : null
    })
    .filter((n) => n !== null) as number[]

  $: autoRounds = availableRoundCounts.length ? Math.min(...availableRoundCounts) : 0
  $: compareRounds = selectedItems.length ? (safeInt(roundsLimit) > 0 ? safeInt(roundsLimit) : autoRounds) : 0

  const unitFor = (kind: 'bpm' | 'hrr' | 'tau') => {
    if (normalization === 'zscore') return 'z'
    if (kind === 'bpm') return normalization === 'delta' ? 'Δbpm' : 'bpm'
    if (kind === 'tau') return normalization === 'delta' ? 'Δs' : 's'
    if (hrrDisplay === 'percent') return normalization === 'delta' ? 'Δ%' : '%'
    return normalization === 'delta' ? 'Δbpm' : 'Δbpm'
  }

  $: comparisonRows = selectedItems.map((it) => {
    const a = analyses[it.id] ?? null
    const available = Array.isArray(a?.perRound) ? a!.perRound!.length : safeInt((it.block as any)?.rounds)
    const used = compareRounds ? Math.min(compareRounds, available || 0) : 0
    const peak = extractSeries(a, 'hr_peak', used)
    const end = extractSeries(a, 'hr_end', used)
    const hrrRaw = extractSeries(a, 'hrr60', used)
    const hrr = hrrDisplay === 'percent' ? deriveHrrPercent(hrrRaw, end) : hrrRaw
    const tau = extractSeries(a, 'tau_rec', used)
    const block = (a?.block ?? it.block ?? {}) as any
    return {
      id: it.id,
      title: titleFor(it),
      date: formatDate(it.started_at ?? it.created_at ?? null),
      availableRounds: available || 0,
      usedRounds: used,
      workSeconds: safeInt(block?.workSeconds),
      restSeconds: safeInt(block?.restSeconds),
      meanPeak: mean(peak),
      meanEnd: mean(end),
      meanHrr: mean(hrr),
      meanTau: mean(tau),
      slopePeak: slope(peak),
      slopeEnd: slope(end),
      slopeHrr: slope(hrr),
      slopeTau: slope(tau)
    }
  })

  const legendLabelFor = (it: AnalysisListItem) => `${titleFor(it)} · ${it.id.slice(0, 4)}`

  const metricKeyFromSeriesId = (id: unknown) => {
    const raw = typeof id === 'string' ? id : ''
    if (raw.includes(':peak')) return 'peak'
    if (raw.includes(':end')) return 'end'
    if (raw.includes(':hrr')) return 'hrr'
    if (raw.includes(':tau')) return 'tau'
    return 'unknown'
  }

  const metricLabelFromKey = (key: string) => {
    if (key === 'peak') return 'Peak HR'
    if (key === 'end') return 'End HR'
    if (key === 'hrr') return hrrDisplay === 'percent' ? 'HRR%' : 'HRR'
    if (key === 'tau') return 'τrec'
    return 'Value'
  }

  const escapeHtml = (s: unknown) =>
    String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')

  const buildChartOption = () => {
    const theme = getTheme()
    const makePaddedExtent = ({
      minPad,
      clampNonNegative
    }: {
      minPad: number
      clampNonNegative: boolean
    }) => {
      const paddedMin = (value: any) => {
        const min = typeof value?.min === 'number' ? value.min : null
        const max = typeof value?.max === 'number' ? value.max : null
        if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max)) return null
        const range = max - min
        const pad = Math.max(minPad, range > 0 ? range * 0.1 : minPad)
        const out = min - pad
        return clampNonNegative ? Math.max(0, out) : out
      }
      const paddedMax = (value: any) => {
        const min = typeof value?.min === 'number' ? value.min : null
        const max = typeof value?.max === 'number' ? value.max : null
        if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max)) return null
        const range = max - min
        const pad = Math.max(minPad, range > 0 ? range * 0.1 : minPad)
        const out = max + pad
        return clampNonNegative ? Math.max(0, out) : out
      }
      return { min: paddedMin, max: paddedMax }
    }

    const bpmExtent = makePaddedExtent({ minPad: 1, clampNonNegative: normalization === 'none' })
    const hrrExtent = makePaddedExtent({ minPad: 1, clampNonNegative: false })
    const tauExtent = makePaddedExtent({ minPad: 2, clampNonNegative: normalization === 'none' })

    const showBpmAxis = showPeak || showEnd
    const showHrrAxis = showHrr
    const showTauAxis = showTau
    const rightSpace = showTauAxis ? 74 : 56

    const palette = [
      '#22d3ee',
      '#22c55e',
      '#f59e0b',
      '#a855f7',
      '#fb7185',
      '#60a5fa',
      '#f97316',
      '#34d399'
    ]

    const series = selectedItems.flatMap((it: AnalysisListItem, idx: number) => {
      const groupName = legendLabelFor(it)
      const a = analyses[it.id] ?? null
      const color = palette[idx % palette.length]
      const used = compareRounds || 0

      const peak = normalizeSeries(extractSeries(a, 'hr_peak', used), normalization)
      const end = normalizeSeries(extractSeries(a, 'hr_end', used), normalization)
      const hrrRaw = extractSeries(a, 'hrr60', used)
      const hrrBase = hrrDisplay === 'percent' ? deriveHrrPercent(hrrRaw, extractSeries(a, 'hr_end', used)) : hrrRaw
      const hrr = normalizeSeries(hrrBase, normalization)
      const tau = normalizeSeries(extractSeries(a, 'tau_rec', used), normalization)

      const out: any[] = []

      if (showPeak) {
        out.push({
          id: `${it.id}:peak`,
          name: groupName,
          type: 'line',
          yAxisIndex: 0,
          connectNulls: false,
          showSymbol: true,
          symbol: 'triangle',
          symbolSize: 8,
          data: peak.map((v, i) => [i + 1, v]),
          lineStyle: { width: 2, type: 'solid', color },
          itemStyle: { color }
        })
      }

      if (showEnd) {
        out.push({
          id: `${it.id}:end`,
          name: groupName,
          type: 'line',
          yAxisIndex: 0,
          connectNulls: false,
          showSymbol: true,
          symbol: 'circle',
          symbolSize: 7,
          data: end.map((v, i) => [i + 1, v]),
          lineStyle: { width: 2, type: 'dashed', color },
          itemStyle: { color }
        })
      }

      if (showHrr) {
        out.push({
          id: `${it.id}:hrr`,
          name: groupName,
          type: 'line',
          yAxisIndex: 1,
          connectNulls: false,
          showSymbol: true,
          symbol: 'diamond',
          symbolSize: 7,
          data: hrr.map((v, i) => [i + 1, v]),
          lineStyle: { width: 2, type: 'dotted', color },
          itemStyle: { color }
        })
      }

      if (showTau) {
        out.push({
          id: `${it.id}:tau`,
          name: groupName,
          type: 'line',
          yAxisIndex: 2,
          connectNulls: false,
          showSymbol: true,
          symbol: 'rect',
          symbolSize: 7,
          data: tau.map((v, i) => [i + 1, v]),
          lineStyle: { width: 2, type: 'solid', opacity: 0.55, color },
          itemStyle: { opacity: 0.55, color }
        })
      }

      return out
    })

    return {
      animation: false,
      grid: { left: 52, right: rightSpace, top: 36, bottom: 48 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: theme.surface,
        borderColor: theme.border,
        textStyle: { color: theme.text },
        formatter: (params: any) => {
          const items = Array.isArray(params) ? params : [params]
          const round = items[0]?.axisValue ?? '–'
          const byWorkout = new Map<string, any[]>()
          for (const p of items) {
            const name = typeof p?.seriesName === 'string' ? p.seriesName : 'Workout'
            if (!byWorkout.has(name)) byWorkout.set(name, [])
            byWorkout.get(name)!.push(p)
          }

          const kindUnit = (key: string) => {
            if (key === 'peak' || key === 'end') return unitFor('bpm')
            if (key === 'hrr') return unitFor('hrr')
            if (key === 'tau') return unitFor('tau')
            return ''
          }

          let html = `<strong>Round ${escapeHtml(round)}</strong>`
          for (const [workoutName, ps] of byWorkout.entries()) {
            html += `<div style="margin-top:6px"><div><strong>${escapeHtml(workoutName)}</strong></div>`
            for (const p of ps) {
              const key = metricKeyFromSeriesId(p?.seriesId)
              const label = metricLabelFromKey(key)
              const y = Array.isArray(p?.value) ? p.value[1] : p?.value
              html += `<div>${escapeHtml(label)}: ${escapeHtml(fmt(typeof y === 'number' && Number.isFinite(y) ? y : null))} ${escapeHtml(
                kindUnit(key)
              )}</div>`
            }
            html += `</div>`
          }
          return html
        }
      },
      legend: {
        top: 6,
        left: 84,
        textStyle: { color: theme.muted },
        type: 'scroll',
        data: selectedItems.map((it) => legendLabelFor(it))
      },
      xAxis: {
        type: 'value',
        name: 'round',
        min: 1,
        max: Math.max(1, compareRounds || 1),
        interval: 1,
        nameTextStyle: { color: theme.muted },
        axisLabel: { color: theme.muted },
        axisLine: { lineStyle: { color: theme.border } },
        splitLine: { lineStyle: { color: theme.border } }
      },
      yAxis: [
        {
          type: 'value',
          show: showBpmAxis,
          name: unitFor('bpm'),
          scale: true,
          min: bpmExtent.min,
          max: bpmExtent.max,
          nameTextStyle: { color: theme.muted },
          axisLabel: { color: theme.muted },
          axisLine: { lineStyle: { color: theme.border } },
          splitLine: { lineStyle: { color: theme.border } }
        },
        {
          type: 'value',
          show: showHrrAxis,
          position: 'right',
          name: unitFor('hrr'),
          scale: true,
          min: hrrExtent.min,
          max: hrrExtent.max,
          nameTextStyle: { color: theme.muted },
          axisLabel: { color: theme.muted },
          axisLine: { lineStyle: { color: theme.border } },
          splitLine: { show: false }
        },
        {
          type: 'value',
          show: showTauAxis,
          position: 'right',
          offset: 44,
          name: unitFor('tau'),
          scale: true,
          min: tauExtent.min,
          max: tauExtent.max,
          nameTextStyle: { color: theme.muted },
          axisLabel: { color: theme.muted },
          axisLine: { lineStyle: { color: theme.border } },
          splitLine: { show: false }
        }
      ],
      series
    }
  }

  const updateChart = () => {
    if (!chart) return
    if (!selectedItems.length || !compareRounds || (!showPeak && !showEnd && !showHrr && !showTau)) {
      chart.clear()
      return
    }
    chart.setOption(buildChartOption(), { notMerge: true })
  }

  $: if (chart && echarts) {
    void selectedItems
    void compareRounds
    void showPeak
    void showEnd
    void showHrr
    void showTau
    void normalization
    void hrrDisplay
    void analyses
    updateChart()
  }

  onMount(async () => {
    await loadList()

    const mod = await import('echarts')
    echarts = mod
    if (chartEl) {
      chart = echarts.init(chartEl, undefined, { renderer: 'canvas' })
      updateChart()
      resizeObserver = new ResizeObserver(() => chart?.resize())
      resizeObserver.observe(chartEl)
    }
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
    chart?.dispose()
    chart = null
    echarts = null
  })
</script>

<div class="interval-analysis">
  <header class="head">
    <div>
      <h1>Interval HR analysis</h1>
      <p class="muted small">Compare saved interval blocks across workouts (V1 metrics).</p>
    </div>
    <div class="head__actions">
      <button class="ghost" type="button" on:click={loadList} disabled={loading}>Refresh</button>
      <button class="ghost" type="button" on:click={selectAllVisible} disabled={!filtered.length}>Select visible</button>
      <button class="ghost" type="button" on:click={clearSelection} disabled={!selected.size}>Clear</button>
      <a class="ghost link" href="/history">Back to History</a>
    </div>
  </header>

  {#if loading && items.length === 0}
    <p>Loading…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if items.length === 0}
    <p class="muted">No saved interval analyses yet. Open a workout in History → Intervals → Save.</p>
  {:else}
    <section class="panel">
      <div class="panel__head">
        <strong>Workouts with saved analysis</strong>
        <input type="search" placeholder="Search…" bind:value={search} />
      </div>
      <div class="list">
        {#each filtered as it (it.id)}
          <label class="row">
            <input type="checkbox" checked={selected.has(it.id)} on:change={() => toggle(it.id)} />
            <div class="row__main">
              <div class="row__title">{titleFor(it)}</div>
              <div class="row__meta muted tiny">
                {formatDate(it.started_at ?? it.created_at ?? null)}
                {#if it.block?.rounds} · {safeInt(it.block.rounds)} rounds{/if}
                {#if it.block?.workSeconds} · work {formatSeconds(it.block.workSeconds)}{/if}
                {#if it.block?.restSeconds !== undefined} · rest {formatSeconds(it.block.restSeconds)}{/if}
                {#if it.analysis_updated_at} · saved {new Date(it.analysis_updated_at).toLocaleString()}{/if}
              </div>
              {#if analysisErrors[it.id]}
                <div class="error tiny">{analysisErrors[it.id]}</div>
              {/if}
            </div>
          </label>
        {/each}
      </div>
    </section>

    <section class="panel">
      <div class="panel__head">
        <strong>Comparison</strong>
        <div class="panel__controls">
          <div class="control">
            <span class="muted tiny">Metrics</span>
            <div class="toggles">
              <label class="toggle">
                <input type="checkbox" bind:checked={showPeak} />
                <span>Peak</span>
              </label>
              <label class="toggle">
                <input type="checkbox" bind:checked={showEnd} />
                <span>End</span>
              </label>
              <label class="toggle">
                <input type="checkbox" bind:checked={showHrr} />
                <span>HRR</span>
              </label>
              <label class="toggle">
                <input type="checkbox" bind:checked={showTau} />
                <span>τrec</span>
              </label>
            </div>
          </div>
          <label>
            <span class="muted tiny">Normalization</span>
            <select bind:value={normalization}>
              <option value="none">Absolute</option>
              <option value="delta">Δ from round 1</option>
              <option value="zscore">z-score</option>
            </select>
          </label>
          <label>
            <span class="muted tiny">HRR scale</span>
            <select bind:value={hrrDisplay} disabled={!showHrr}>
              <option value="delta">Δbpm</option>
              <option value="percent">% (HRR/End)</option>
            </select>
          </label>
          <label>
            <span class="muted tiny">Rounds (0 = auto min)</span>
            <input type="number" min="0" step="1" bind:value={roundsLimit} />
          </label>
        </div>
      </div>

      <div class="chart" bind:this={chartEl}></div>
      <p class="muted tiny">
        Styles: Peak = solid ▲ · End = dashed ● · HRR = dotted ◆ · τrec = solid ▮ (faded)
        {#if normalization === 'delta'} · Δ values are relative to the first available round in the compared window.{/if}
      </p>

      {#if selectedItems.length < 2}
        <p class="muted small">Select 2+ workouts above to compare.</p>
      {:else if compareRounds === 0}
        <p class="muted small">Set rounds to compare (or keep 0 to auto-pick the minimum).</p>
      {:else}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Workout</th>
                <th>Date</th>
                <th>Rounds</th>
                <th>Used</th>
                <th>Work</th>
                <th>Rest</th>
                <th>Peak (avg)</th>
                <th>End (avg)</th>
                <th>{hrrDisplay === 'percent' ? 'HRR% (avg)' : 'HRR (avg)'}</th>
                <th>τrec (avg)</th>
                <th>Peak slope</th>
                <th>End slope</th>
                <th>{hrrDisplay === 'percent' ? 'HRR% slope' : 'HRR slope'}</th>
              </tr>
            </thead>
            <tbody>
              {#each comparisonRows as row (row.id)}
                <tr>
                  <td><a class="link" href={`/history#cw-${encodeURIComponent(row.id)}`}>{row.title}</a></td>
                  <td>{row.date}</td>
                  <td>{row.availableRounds || '–'}</td>
                  <td>{row.usedRounds || '–'}</td>
                  <td>{row.workSeconds ? formatSeconds(row.workSeconds) : '–'}</td>
                  <td>{row.restSeconds !== null ? formatSeconds(row.restSeconds) : '–'}</td>
                  <td>{fmt(row.meanPeak)}</td>
                  <td>{fmt(row.meanEnd)}</td>
                  <td>
                    {fmt(row.meanHrr)}
                    {#if hrrDisplay === 'percent' && row.meanHrr !== null}
                      <span class="muted tiny">%</span>
                    {/if}
                  </td>
                  <td>{fmt(row.meanTau)}</td>
                  <td>{fmtSlope(row.slopePeak)}</td>
                  <td>{fmtSlope(row.slopeEnd)}</td>
                  <td>
                    {fmtSlope(row.slopeHrr)}
                    {#if hrrDisplay === 'percent' && row.slopeHrr !== null}
                      <span class="muted tiny">%/round</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .interval-analysis {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: baseline;
    flex-wrap: wrap;
  }

  .head__actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  h1 {
    margin: 0;
    font-size: 1.65rem;
  }

  .panel {
    border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
    border-radius: 14px;
    background: color-mix(in srgb, var(--color-surface-1) 70%, transparent);
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .panel__head {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .panel__head input[type='search'] {
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.45rem 0.6rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    min-width: 240px;
  }

  .panel__controls {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    align-items: end;
    justify-content: flex-end;
  }

  .control {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .toggles {
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
    align-items: center;
  }

  .toggle {
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 0.35rem 0.6rem;
    background: color-mix(in srgb, var(--color-surface-1) 85%, transparent);
    color: var(--color-text-primary);
    cursor: pointer;
    user-select: none;
    font-size: 0.9rem;
    line-height: 1;
  }

  .toggle input {
    accent-color: var(--color-accent);
  }

  .panel__controls label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  select,
  input[type='number'] {
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.45rem 0.6rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 360px;
    overflow: auto;
    padding-right: 0.25rem;
  }

  .row {
    display: flex;
    gap: 0.6rem;
    padding: 0.5rem 0.6rem;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--color-border) 65%, transparent);
    background: color-mix(in srgb, var(--color-surface-2) 70%, transparent);
  }

  .row__main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .row__title {
    font-weight: 700;
  }

  .chart {
    width: 100%;
    height: 320px;
    border: 1px solid color-mix(in srgb, var(--color-border) 65%, transparent);
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-surface-1) 70%, transparent);
  }

  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
  }

  th,
  td {
    padding: 0.45rem 0.5rem;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 65%, transparent);
    text-align: left;
    white-space: nowrap;
  }

  th {
    color: var(--color-text-muted);
    font-weight: 600;
  }

  .ghost {
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.4rem 0.7rem;
    color: var(--color-text-primary);
    cursor: pointer;
    font-weight: 600;
  }

  .ghost:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .muted {
    color: var(--color-text-muted);
  }

  .tiny {
    font-size: 0.85rem;
  }

  .small {
    font-size: 0.95rem;
  }

  .error {
    color: var(--color-danger);
  }

  .link {
    color: var(--color-text-primary);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--color-text-muted) 55%, transparent);
  }

  .link:hover {
    text-decoration-color: var(--color-text-primary);
  }

  @media (max-width: 720px) {
    .panel__head input[type='search'] {
      min-width: 0;
      width: 100%;
    }
  }
</style>
