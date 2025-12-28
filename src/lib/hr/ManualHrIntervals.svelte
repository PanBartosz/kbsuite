<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import {
    buildWorkIntervals,
    clamp,
    computeHrIntervalMetrics,
    formatSeconds,
    safeInt,
    type HrSample
  } from './manualIntervals'

  export let samples: HrSample[] = []
  export let completedWorkoutId: string | null = null

  let rounds = 8
  let workSeconds = 30
  let restSeconds = 30
  let offsetSeconds = 0

  let peakExtensionSec = 15
  let endWindowSec = 5
  let hrrWindowSec = 5

  let chartEl: HTMLDivElement | null = null
  let chart: any | null = null
  let echarts: any | null = null
  let resizeObserver: ResizeObserver | null = null
  let zoomStartPct = 0
  let zoomEndPct = 100
  let zoomSpanSec = 0
  let zoomedIn = false
  let offsetSliderHalfSpanSec: number | null = null
  let offsetSliderMin = 0
  let offsetSliderMax = 0

  let offsetSliderCenter = offsetSeconds
  let offsetSliderDragging = false
  let dataZoomHandler: (() => void) | null = null

  const getTheme = () => {
    if (typeof window === 'undefined') {
      return {
        text: '#e2e8f0',
        muted: '#94a3b8',
        border: '#1f2a40',
        surface: '#0f172a',
        accent: '#22d3ee',
        warning: '#f59e0b',
        success: '#22c55e'
      }
    }
    const s = getComputedStyle(document.documentElement)
    const pick = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
    return {
      text: pick('--color-text-primary', '#e2e8f0'),
      muted: pick('--color-text-muted', '#94a3b8'),
      border: pick('--color-border', '#1f2a40'),
      surface: pick('--color-surface-2', '#0f172a'),
      accent: pick('--color-accent', '#22d3ee'),
      warning: pick('--color-warning-strong', '#f59e0b'),
      success: pick('--color-success', '#22c55e')
    }
  }

  const metricsConfigKey = 'kb_hr_manual_intervals_metrics_v1'

  const loadStoredMetricsConfig = () => {
    if (typeof window === 'undefined') return null
    try {
      const raw = window.localStorage.getItem(metricsConfigKey)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      const parseIntOrNull = (value: unknown) => {
        const n = typeof value === 'number' ? value : Number(value)
        return Number.isFinite(n) ? Math.round(n) : null
      }
      return {
        peakExtensionSec: parseIntOrNull(parsed?.peakExtensionSec),
        endWindowSec: parseIntOrNull(parsed?.endWindowSec),
        hrrWindowSec: parseIntOrNull(parsed?.hrrWindowSec)
      }
    } catch {
      return null
    }
  }

  let maxT = 0
  let minHrRaw = 0
  let maxHrRaw = 0

  $: {
    if (!samples.length) {
      maxT = 0
      minHrRaw = 0
      maxHrRaw = 0
    } else {
      let tMax = 0
      let hrMin = samples[0].hr
      let hrMax = samples[0].hr
      for (const p of samples) {
        const t = safeInt(p.t)
        if (t > tMax) tMax = t
        if (p.hr < hrMin) hrMin = p.hr
        if (p.hr > hrMax) hrMax = p.hr
      }
      maxT = tMax
      minHrRaw = hrMin
      maxHrRaw = hrMax
    }
  }
  $: hrPadding = Math.max(8, Math.round((maxHrRaw - minHrRaw) * 0.15))
  $: minHr = minHrRaw - hrPadding
  $: maxHr = maxHrRaw + hrPadding

  $: offsetMin = -Math.min(600, Math.max(0, maxT))
  $: offsetMax = Math.max(0, maxT)

  const syncZoomFromChart = () => {
    if (!chart) {
      zoomStartPct = 0
      zoomEndPct = 100
      return
    }
    try {
      const opt = chart.getOption()
      const dz = Array.isArray(opt?.dataZoom) ? opt.dataZoom : []
      const z =
        dz.find((d: any) => {
          const idx = d?.xAxisIndex
          if (idx === 0) return true
          if (Array.isArray(idx) && idx.includes(0)) return true
          return false
        }) ?? dz[0]

      const start = typeof z?.start === 'number' ? z.start : Number(z?.start)
      const end = typeof z?.end === 'number' ? z.end : Number(z?.end)
      if (Number.isFinite(start) && Number.isFinite(end)) {
        zoomStartPct = clamp(start, 0, 100)
        zoomEndPct = clamp(end, 0, 100)
        return
      }
    } catch {
      // ignore
    }
    zoomStartPct = 0
    zoomEndPct = 100
  }

  $: zoomSpanSec = Math.max(
    0,
    (Math.abs(zoomEndPct - zoomStartPct) / 100) * Math.max(0, safeInt(maxT))
  )
  $: zoomedIn = Math.max(0, safeInt(maxT)) > 0 && Math.abs(zoomEndPct - zoomStartPct) < 99.9
  $: offsetSliderHalfSpanSec = zoomedIn ? Math.max(5, Math.round(zoomSpanSec / 2)) : null
  $: offsetSliderMin = zoomedIn
    ? clamp(offsetSliderCenter - (offsetSliderHalfSpanSec ?? 0), offsetMin, offsetMax)
    : offsetMin
  $: offsetSliderMax = zoomedIn
    ? clamp(offsetSliderCenter + (offsetSliderHalfSpanSec ?? 0), offsetMin, offsetMax)
    : offsetMax

  $: if (!offsetSliderDragging && offsetSliderCenter !== offsetSeconds) {
    offsetSliderCenter = offsetSeconds
  }

  const clampInputs = () => {
    const nextRounds = clamp(safeInt(rounds), 0, 1000)
    const nextWorkSeconds = clamp(safeInt(workSeconds), 0, 24 * 60 * 60)
    const nextRestSeconds = clamp(safeInt(restSeconds), 0, 24 * 60 * 60)
    const nextOffsetSeconds = clamp(safeInt(offsetSeconds), offsetMin, offsetMax)
    const nextPeakExtensionSec = clamp(safeInt(peakExtensionSec), 0, 120)
    const nextEndWindowSec = clamp(safeInt(endWindowSec), 0, 30)
    const nextHrrWindowSec = clamp(safeInt(hrrWindowSec), 0, 30)
    if (nextRounds !== rounds) rounds = nextRounds
    if (nextWorkSeconds !== workSeconds) workSeconds = nextWorkSeconds
    if (nextRestSeconds !== restSeconds) restSeconds = nextRestSeconds
    if (nextOffsetSeconds !== offsetSeconds) offsetSeconds = nextOffsetSeconds
    if (nextPeakExtensionSec !== peakExtensionSec) peakExtensionSec = nextPeakExtensionSec
    if (nextEndWindowSec !== endWindowSec) endWindowSec = nextEndWindowSec
    if (nextHrrWindowSec !== hrrWindowSec) hrrWindowSec = nextHrrWindowSec
  }

  $: clampInputs()

  $: workIntervals = buildWorkIntervals({
    rounds,
    workSeconds,
    restSeconds,
    offsetSeconds
  })

  $: metricsResult = computeHrIntervalMetrics({
    samples,
    workIntervals,
    restSeconds,
    config: { peakExtensionSec, endWindowSec, hrrWindowSec }
  })
  $: intervalRows = metricsResult.perRound
  $: trends = metricsResult.trends
  $: hrrLabel = safeInt(restSeconds) < 60 ? `HRR@${Math.max(0, safeInt(restSeconds))}s` : 'HRR60'

  const peakHrLabel = 'Peak HR'
  const endHrLabel = 'End HR'

  const buildOverlaySeriesData = () => {
    const peak: any[] = []
    const end: any[] = []
    const hrr: any[] = []
    for (const row of intervalRows) {
      if (row.t_peak !== null && row.hr_peak !== null) {
        peak.push({ value: [row.t_peak, row.hr_peak], round: row.round })
      }
      if (row.hr_end !== null) {
        end.push({ value: [row.workEnd, row.hr_end], round: row.round })
      }
      if (row.hrr60 !== null && row.hrrTimeUsedSec !== null) {
        hrr.push({
          value: [row.restStart + row.hrrTimeUsedSec, row.hrr60],
          round: row.round,
          hrrTimeUsedSec: row.hrrTimeUsedSec
        })
      }
    }
    return { peak, end, hrr }
  }

  const buildBaseOption = () => {
    const theme = getTheme()
    const overlay = buildOverlaySeriesData()
    return {
      animation: false,
      grid: { left: 52, right: 52, top: 44, bottom: 62 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: theme.surface,
        borderColor: theme.border,
        textStyle: { color: theme.text }
      },
      legend: {
        top: 8,
        left: 84,
        textStyle: { color: theme.muted },
        data: ['HR', peakHrLabel, endHrLabel, hrrLabel]
      },
      xAxis: {
        type: 'value',
        name: 'time (s)',
        nameTextStyle: { color: theme.muted },
        axisLabel: { color: theme.muted },
        axisLine: { lineStyle: { color: theme.border } },
        splitLine: { lineStyle: { color: theme.border } },
        min: 0,
        max: Math.max(1, maxT)
      },
      yAxis: [
        {
          type: 'value',
          name: 'bpm',
          nameTextStyle: { color: theme.muted },
          axisLabel: { color: theme.muted },
          axisLine: { lineStyle: { color: theme.border } },
          splitLine: { lineStyle: { color: theme.border } },
          min: minHr,
          max: maxHr
        },
        {
          type: 'value',
          name: 'Δbpm',
          nameTextStyle: { color: theme.muted },
          axisLabel: { color: theme.muted },
          axisLine: { lineStyle: { color: theme.border } },
          splitLine: { show: false }
        }
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
        {
          type: 'slider',
          xAxisIndex: 0,
          height: 22,
          bottom: 12,
          borderColor: theme.border,
          backgroundColor: 'transparent',
          fillerColor: 'rgba(34, 211, 238, 0.16)',
          handleStyle: { color: theme.accent, borderColor: theme.border },
          textStyle: { color: theme.muted }
        }
      ],
      series: [
        {
          id: 'hr',
          name: 'HR',
          type: 'line',
          showSymbol: false,
          data: samples.map((p) => [safeInt(p.t), p.hr]),
          lineStyle: { width: 2, color: theme.text },
          areaStyle: { opacity: 0 },
          markArea: {
            silent: true,
            itemStyle: { color: 'rgba(34, 211, 238, 0.12)' },
            data: []
          }
        },
        {
          id: 'hr_peak',
          name: peakHrLabel,
          type: 'line',
          showSymbol: true,
          symbol: 'triangle',
          symbolSize: 9,
          connectNulls: false,
          yAxisIndex: 0,
          data: overlay.peak,
          lineStyle: { width: 2, type: 'dashed', color: theme.accent },
          itemStyle: { color: theme.accent },
          tooltip: {
            trigger: 'item',
            formatter: (p: any) => {
              const round = p?.data?.round ?? '–'
              const t = Array.isArray(p?.value) ? p.value[0] : null
              const hr = Array.isArray(p?.value) ? p.value[1] : null
              return `Round ${round}<br/>${peakHrLabel}: ${fmt(hr)} bpm<br/>t: ${formatSeconds(t)}`
            }
          },
          z: 4
        },
        {
          id: 'hr_end',
          name: endHrLabel,
          type: 'line',
          showSymbol: true,
          symbol: 'circle',
          symbolSize: 8,
          connectNulls: false,
          yAxisIndex: 0,
          data: overlay.end,
          lineStyle: { width: 2, type: 'dashed', color: theme.success },
          itemStyle: { color: theme.success },
          tooltip: {
            trigger: 'item',
            formatter: (p: any) => {
              const round = p?.data?.round ?? '–'
              const t = Array.isArray(p?.value) ? p.value[0] : null
              const hr = Array.isArray(p?.value) ? p.value[1] : null
              return `Round ${round}<br/>${endHrLabel}: ${fmt(hr)} bpm<br/>t: ${formatSeconds(t)}`
            }
          },
          z: 4
        },
        {
          id: 'hrr',
          name: hrrLabel,
          type: 'line',
          showSymbol: true,
          symbol: 'diamond',
          symbolSize: 8,
          connectNulls: false,
          yAxisIndex: 1,
          data: overlay.hrr,
          lineStyle: { width: 2, type: 'dashed', color: theme.warning },
          itemStyle: { color: theme.warning },
          tooltip: {
            trigger: 'item',
            formatter: (p: any) => {
              const round = p?.data?.round ?? '–'
              const t = Array.isArray(p?.value) ? p.value[0] : null
              const hrr = Array.isArray(p?.value) ? p.value[1] : null
              const timeUsed = p?.data?.hrrTimeUsedSec
              const at = Number.isFinite(timeUsed ?? NaN) ? `at ${safeInt(timeUsed)}s` : ''
              return `Round ${round}<br/>${hrrLabel}: ${fmt(hrr)} bpm<br/>${at}<br/>t: ${formatSeconds(t)}`
            }
          },
          z: 4
        }
      ]
    }
  }

  const updateChartData = () => {
    if (!chart) return
    chart.setOption(buildBaseOption(), { notMerge: true })
    updateWorkOverlay()
    updateMetricsOverlay()
  }

  const updateMetricsOverlay = () => {
    if (!chart) return
    const theme = getTheme()
    const overlay = buildOverlaySeriesData()
    chart.setOption(
      {
        legend: { top: 8, left: 84, data: ['HR', peakHrLabel, endHrLabel, hrrLabel], textStyle: { color: theme.muted } },
        series: [
          {
            id: 'hr_peak',
            name: peakHrLabel,
            data: overlay.peak,
            lineStyle: { color: theme.accent },
            itemStyle: { color: theme.accent }
          },
          { id: 'hr_end', name: endHrLabel, data: overlay.end, lineStyle: { color: theme.success }, itemStyle: { color: theme.success } },
          { id: 'hrr', name: hrrLabel, data: overlay.hrr, lineStyle: { color: theme.warning }, itemStyle: { color: theme.warning } }
        ]
      },
      { notMerge: false, lazyUpdate: true }
    )
  }

  const buildWorkMarkAreas = () => {
    if (!workIntervals.length || !maxT) return []
    const areas: any[] = []
    for (const w of workIntervals) {
      const x0 = clamp(w.start, 0, maxT)
      const x1 = clamp(w.end, 0, maxT)
      if (x1 <= x0) continue
      areas.push([{ xAxis: x0 }, { xAxis: x1 }])
    }
    return areas
  }

  const updateWorkOverlay = () => {
    if (!chart) return
    chart.setOption(
      {
        series: [
          {
            id: 'hr',
            markArea: { data: buildWorkMarkAreas() }
          }
        ]
      },
      { notMerge: false, lazyUpdate: true }
    )
  }

  $: if (chart && echarts) {
    void samples
    void maxT
    void minHr
    void maxHr
    updateChartData()
  }

  $: if (chart) {
    void workIntervals
    void maxT
    updateWorkOverlay()
  }

  $: if (chart) {
    void intervalRows
    void hrrLabel
    updateMetricsOverlay()
  }

  onMount(async () => {
    const stored = loadStoredMetricsConfig()
    if (stored) {
      if (stored.peakExtensionSec !== null) peakExtensionSec = stored.peakExtensionSec
      if (stored.endWindowSec !== null) endWindowSec = stored.endWindowSec
      if (stored.hrrWindowSec !== null) hrrWindowSec = stored.hrrWindowSec
    }

    if (completedWorkoutId) {
      void loadPersistedAnalysis()
    }

    const mod = await import('echarts')
    echarts = mod
    if (!chartEl) return

    chart = echarts.init(chartEl, undefined, { renderer: 'canvas' })
    updateChartData()
    updateWorkOverlay()
    updateMetricsOverlay()

    dataZoomHandler = () => {
      syncZoomFromChart()
      if (!offsetSliderDragging) offsetSliderCenter = offsetSeconds
    }
    chart.on('datazoom', dataZoomHandler)
    syncZoomFromChart()

    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(chartEl)
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
    if (chart && dataZoomHandler) {
      chart.off('datazoom', dataZoomHandler)
    }
    chart?.dispose()
    chart = null
    echarts = null
  })

  $: if (typeof window !== 'undefined') {
    window.localStorage.setItem(
      metricsConfigKey,
      JSON.stringify({
        peakExtensionSec: safeInt(peakExtensionSec),
        endWindowSec: safeInt(endWindowSec),
        hrrWindowSec: safeInt(hrrWindowSec)
      })
    )
  }

  const fmt = (n: number | null) => (n === null ? '–' : String(Math.round(n * 10) / 10))
  const fmtSlope = (n: number | null) => (n === null ? '–' : `${(Math.round(n * 100) / 100).toFixed(2)}`)

  let persistedLoaded = false
  let persistedLoading = false
  let persistedSaving = false
  let persistedStatus = ''
  let persistedError = ''
  let persistedUpdatedAt: number | null = null

  const download = (filename: string, content: string, mime: string) => {
    if (typeof window === 'undefined') return
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const buildAnalysisPayload = () => ({
    version: 'v1',
    generatedAt: new Date().toISOString(),
    workoutId: completedWorkoutId,
    block: {
      rounds: safeInt(rounds),
      workSeconds: safeInt(workSeconds),
      restSeconds: safeInt(restSeconds),
      offsetSeconds: safeInt(offsetSeconds)
    },
    config: {
      peakExtensionSec: safeInt(peakExtensionSec),
      endWindowSec: safeInt(endWindowSec),
      hrrWindowSec: safeInt(hrrWindowSec)
    },
    trends,
    perRound: intervalRows
  })

  const loadPersistedAnalysis = async () => {
    if (!completedWorkoutId) return
    persistedLoading = true
    persistedError = ''
    persistedStatus = ''
    persistedLoaded = false
    try {
      const res = await fetch(`/api/completed-workouts/${completedWorkoutId}/hr-interval-analysis`)
      const data = await res.json().catch(() => ({}))
      const payload = data?.analysis ?? null
      const settings = data?.settings ?? null
      const block = settings?.block ?? payload?.block ?? null
      const config = settings?.config ?? payload?.config ?? null
      if (!block && !config) return

      const parseIntOrNull = (value: unknown) => {
        const n = typeof value === 'number' ? value : Number(value)
        return Number.isFinite(n) ? Math.round(n) : null
      }

      const r = parseIntOrNull(block?.rounds)
      const w = parseIntOrNull(block?.workSeconds)
      const rest = parseIntOrNull(block?.restSeconds)
      const off = parseIntOrNull(block?.offsetSeconds)
      if (r !== null) rounds = r
      if (w !== null) workSeconds = w
      if (rest !== null) restSeconds = rest
      if (off !== null) offsetSeconds = off

      const peakExt = parseIntOrNull(config?.peakExtensionSec)
      const endW = parseIntOrNull(config?.endWindowSec)
      const hrrW = parseIntOrNull(config?.hrrWindowSec)
      if (peakExt !== null) peakExtensionSec = peakExt
      if (endW !== null) endWindowSec = endW
      if (hrrW !== null) hrrWindowSec = hrrW

      persistedLoaded = true
      persistedUpdatedAt = typeof data?.meta?.updatedAt === 'number' ? data.meta.updatedAt : null
      persistedStatus = 'Loaded saved settings'
    } catch (err) {
      console.warn('Failed to load saved HR interval analysis', err)
      persistedError = 'Failed to load saved settings'
    } finally {
      persistedLoading = false
    }
  }

  const savePersistedAnalysis = async () => {
    if (!completedWorkoutId) return
    persistedSaving = true
    persistedError = ''
    persistedStatus = ''
    try {
      const payload = buildAnalysisPayload()
      const res = await fetch(`/api/completed-workouts/${completedWorkoutId}/hr-interval-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      persistedUpdatedAt = typeof data?.updatedAt === 'number' ? data.updatedAt : Date.now()
      persistedStatus = 'Saved'
      persistedLoaded = true
    } catch (err) {
      console.warn('Failed to save HR interval analysis', err)
      persistedError = 'Save failed'
    } finally {
      persistedSaving = false
    }
  }

  const exportJson = () => {
    const payload = buildAnalysisPayload()
    download(`hr_interval_metrics_${Date.now()}.json`, JSON.stringify(payload, null, 2), 'application/json')
  }

  const exportCsv = () => {
    const header = [
      'round',
      'workStart',
      'workEnd',
      'restStart',
      'restEnd',
      'maxHr',
      'hr_peak',
      't_peak',
      'hr_end',
      'hrr',
      'hrrTimeUsedSec',
      'hr_at_hrr',
      'tau_rec',
      'tau_fit_r2',
      'tau_reliable',
      'cfg_peakExtensionSec',
      'cfg_endWindowSec',
      'cfg_hrrWindowSec',
      'trend_HRR60_slope_per_round',
      'trend_HR_peak_slope_per_round',
      'trend_HR_end_slope_per_round',
      'trend_recoveryDegrading'
    ]
    const cfg = {
      peakExtensionSec: safeInt(peakExtensionSec),
      endWindowSec: safeInt(endWindowSec),
      hrrWindowSec: safeInt(hrrWindowSec)
    }
    const rows = intervalRows.map((r) => [
      r.round,
      r.workStart,
      r.workEnd,
      r.restStart,
      r.restEnd,
      r.maxHr ?? '',
      r.hr_peak ?? '',
      r.t_peak ?? '',
      r.hr_end ?? '',
      r.hrr60 ?? '',
      r.hrrTimeUsedSec ?? '',
      r.hr_at_hrr ?? '',
      r.tau_rec ?? '',
      r.tau_fit_r2 ?? '',
      r.tau_reliable ?? '',
      cfg.peakExtensionSec,
      cfg.endWindowSec,
      cfg.hrrWindowSec,
      trends.HRR60_slope_per_round ?? '',
      trends.HR_peak_slope_per_round ?? '',
      trends.HR_end_slope_per_round ?? '',
      trends.recoveryDegrading
    ])

    const esc = (v: unknown) => {
      const s = String(v ?? '')
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replaceAll('"', '""')}"` : s
    }
    const csv = [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
    download(`hr_interval_metrics_${Date.now()}.csv`, csv, 'text/csv')
  }
</script>

<div class="manual-intervals">
  <div class="manual-controls">
    <label>
      <span>Rounds</span>
      <input
        type="number"
        min="1"
        step="1"
        value={rounds}
        on:input={(e) => (rounds = (e.currentTarget as HTMLInputElement).valueAsNumber)}
      />
    </label>
    <label>
      <span>Work (s)</span>
      <input
        type="number"
        min="1"
        step="1"
        value={workSeconds}
        on:input={(e) => (workSeconds = (e.currentTarget as HTMLInputElement).valueAsNumber)}
      />
    </label>
    <label>
      <span>Rest (s)</span>
      <input
        type="number"
        min="0"
        step="1"
        value={restSeconds}
        on:input={(e) => (restSeconds = (e.currentTarget as HTMLInputElement).valueAsNumber)}
      />
    </label>
    <label class="offset">
      <span>
        Start offset ({formatSeconds(offsetSeconds)})
        {#if zoomedIn && offsetSliderHalfSpanSec !== null}
          <span class="muted tiny"> · zoom: ±{formatSeconds(offsetSliderHalfSpanSec)}</span>
        {/if}
      </span>
      <input
        type="range"
        min={offsetSliderMin}
        max={offsetSliderMax}
        step="1"
        value={offsetSeconds}
        on:input={(e) => {
          offsetSliderDragging = true
          offsetSeconds = Number((e.currentTarget as HTMLInputElement).value)
        }}
        on:change={() => {
          offsetSliderDragging = false
          offsetSliderCenter = offsetSeconds
        }}
      />
    </label>

    <label>
      <span>Peak extension (s)</span>
      <input
        type="number"
        min="0"
        step="1"
        value={peakExtensionSec}
        on:input={(e) => (peakExtensionSec = (e.currentTarget as HTMLInputElement).valueAsNumber)}
      />
    </label>
    <label>
      <span>End window (s)</span>
      <input
        type="number"
        min="0"
        step="1"
        value={endWindowSec}
        on:input={(e) => (endWindowSec = (e.currentTarget as HTMLInputElement).valueAsNumber)}
      />
    </label>
    <label>
      <span>HRR window (s)</span>
      <input
        type="number"
        min="0"
        step="1"
        value={hrrWindowSec}
        on:input={(e) => (hrrWindowSec = (e.currentTarget as HTMLInputElement).valueAsNumber)}
      />
    </label>
  </div>

  <div class="chart-shell">
    <div class="chart" bind:this={chartEl}></div>
  </div>

  <div class="results">
    <div class="results__head">
      <strong>Interval HR metrics</strong>
      <div class="results__actions">
        <span class="muted tiny">{samples.length ? `${samples.length} samples` : 'No samples'}</span>
        {#if persistedLoading}
          <span class="muted tiny">Loading…</span>
        {:else if persistedSaving}
          <span class="muted tiny">Saving…</span>
        {:else if persistedError}
          <span class="warn-text tiny">{persistedError}</span>
        {:else if persistedStatus}
          <span class="muted tiny" title={persistedUpdatedAt ? new Date(persistedUpdatedAt).toLocaleString() : ''}>
            {persistedStatus}
          </span>
        {/if}
        <button
          type="button"
          class="btn"
          on:click={savePersistedAnalysis}
          disabled={!samples.length || !completedWorkoutId || persistedSaving}
          title={!completedWorkoutId ? 'Open via workout history to enable DB save' : ''}
        >
          Save
        </button>
        <button type="button" class="btn" on:click={exportJson} disabled={!samples.length}>Export JSON</button>
        <button type="button" class="btn" on:click={exportCsv} disabled={!samples.length}>Export CSV</button>
      </div>
    </div>
    <div class="results__table">
      <table>
        <thead>
          <tr>
            <th>Round</th>
            <th>Start</th>
            <th>End</th>
            <th>Max HR</th>
            <th>{peakHrLabel}</th>
            <th>{endHrLabel}</th>
            <th>{hrrLabel}</th>
            <th>τrec (s)</th>
          </tr>
        </thead>
        <tbody>
          {#each intervalRows as row (row.round)}
            <tr>
              <td>{row.round}</td>
              <td>{formatSeconds(row.workStart)}</td>
              <td>{formatSeconds(row.workEnd)}</td>
              <td>{fmt(row.maxHr)}</td>
              <td>
                {#if row.hr_peak === null}
                  –
                {:else}
                  <span title={row.t_peak !== null ? `Peak at ${formatSeconds(row.t_peak)}` : ''}>{fmt(row.hr_peak)}</span>
                {/if}
              </td>
              <td>{fmt(row.hr_end)}</td>
              <td>
                {#if row.hrr60 === null}
                  –
                {:else}
                  {fmt(row.hrr60)}
                  {#if (row.hrrTimeUsedSec ?? 60) !== 60}
                    <span class="muted tiny">@{safeInt(row.hrrTimeUsedSec)}s</span>
                  {/if}
                {/if}
              </td>
              <td>
                {#if row.tau_rec !== null}
                  {fmt(row.tau_rec)}
                {:else}
                  –
                {/if}
                {#if row.tau_fit_attempted && row.tau_reliable === false}
                  <span
                    class="warn"
                    title={`τ fit unreliable${row.tau_fit_r2 !== null ? ` (r²=${fmt(row.tau_fit_r2)})` : ''}`}
                    aria-label="Tau fit unreliable"
                    >!</span
                  >
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr class="summary-row">
            <td><strong>Slope</strong></td>
            <td class="muted tiny">bpm/round</td>
            <td></td>
            <td></td>
            <td>{fmtSlope(trends.HR_peak_slope_per_round)}</td>
            <td>{fmtSlope(trends.HR_end_slope_per_round)}</td>
            <td>
              {fmtSlope(trends.HRR60_slope_per_round)}
              {#if trends.recoveryDegrading}
                <span class="warn-text" title="Recovery degrading">(degrading)</span>
              {/if}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</div>

<style>
  .manual-intervals {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .manual-controls {
    display: grid;
    grid-template-columns: repeat(3, minmax(140px, 1fr));
    gap: 0.65rem;
    align-items: end;
  }

  .manual-controls label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    color: var(--color-text-muted);
    font-size: 0.95rem;
  }

  .manual-controls label span {
    font-size: 0.85rem;
    letter-spacing: 0.02em;
  }

  .manual-controls input[type='number'] {
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.5rem 0.6rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }

  .manual-controls label.offset {
    grid-column: 1 / -1;
  }

  .manual-controls input[type='range'] {
    width: 100%;
  }

  .chart-shell {
    border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
    border-radius: 14px;
    background: color-mix(in srgb, var(--color-surface-1) 70%, transparent);
    overflow: hidden;
  }

  .chart {
    width: 100%;
    height: 340px;
  }

  .results {
    border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
    border-radius: 14px;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--color-surface-1) 70%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .results__head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
  }

  .results__actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .btn {
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface-1) 85%, transparent);
    color: var(--color-text-primary);
    border-radius: 10px;
    padding: 0.35rem 0.6rem;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .results__table {
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

  .summary-row td {
    border-top: 1px solid color-mix(in srgb, var(--color-border) 65%, transparent);
    border-bottom: none;
    padding-top: 0.55rem;
    padding-bottom: 0.55rem;
    color: var(--color-text-muted);
    font-size: 0.9rem;
  }

  .summary-row td strong {
    color: var(--color-text-primary);
  }

  .warn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.05rem;
    height: 1.05rem;
    margin-left: 0.25rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-warning-strong) 55%, var(--color-border));
    color: var(--color-warning-strong);
    font-size: 0.85rem;
    line-height: 1;
    vertical-align: middle;
  }

  .warn-text {
    color: var(--color-warning-strong);
    margin-left: 0.25rem;
  }

  .muted {
    color: var(--color-text-muted);
  }

  .tiny {
    font-size: 0.85rem;
  }

  @media (max-width: 620px) {
    .manual-controls {
      grid-template-columns: 1fr;
    }
  }
</style>
