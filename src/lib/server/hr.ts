import AdmZip from 'adm-zip'
import FitParser from 'fit-file-parser'
import fs from 'node:fs/promises'
import path from 'node:path'

const dataDir = process.env.KB_SUITE_DATA_DIR
  ? path.resolve(process.env.KB_SUITE_DATA_DIR)
  : path.join(process.cwd(), 'data')
const hrDir = path.join(dataDir, 'hr')
const legacyHrDir = path.join(process.cwd(), 'data', 'hr')
const hrDirs = Array.from(new Set([hrDir, legacyHrDir]))
const HR_SAMPLE_PREVIEW_LIMIT = 200

type HrSample = { t: number; hr: number }
type HrSummary = {
  avgHr: number | null
  maxHr: number | null
  startTime: number | null
  durationSeconds: number | null
  samples?: HrSample[]
}

const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
}

const safeFilename = (filename: string) => filename.replace(/[^a-zA-Z0-9._-]/g, '_')
const isHrFile = (filename: string) => {
  const lower = filename.toLowerCase()
  return lower.endsWith('.fit') || lower.endsWith('.tcx')
}

const listHrFiles = async (dir: string) => {
  const entries = await fs.readdir(dir)
  return entries.filter(isHrFile)
}

const summaryExists = async (dir: string) => {
  try {
    await fs.access(path.join(dir, 'summary.json'))
    return true
  } catch {
    return false
  }
}

const candidateDirs = (completedWorkoutId: string) =>
  hrDirs.map((baseDir) => path.join(baseDir, completedWorkoutId))

const resolveAttachmentDir = async (completedWorkoutId: string) => {
  for (const dir of candidateDirs(completedWorkoutId)) {
    const files = await listHrFiles(dir).catch(() => [] as string[])
    if (files.length || (await summaryExists(dir))) return { dir, files }
  }
  return { dir: path.join(hrDir, completedWorkoutId), files: [] as string[] }
}

const writeSummary = async (dir: string, summary: HrSummary) => {
  await fs.writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2))
}

const withSamplePreview = (summary: HrSummary): HrSummary => {
  if (!summary.samples?.length) {
    const { samples: _samples, ...rest } = summary
    return rest
  }
  return { ...summary, samples: downsampleSeconds(summary.samples, HR_SAMPLE_PREVIEW_LIMIT) }
}

// Lists never parse an original FIT/TCX file or send graph samples. Older
// attachments without a summary are still discoverable and parsed on demand.
export const readHrMetadataBatch = async (ids: string[]) => {
  const results: Record<string, { attached: boolean; summary: Omit<HrSummary, 'samples'> | null }> = {}
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (next < ids.length) {
      const id = ids[next++]
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) continue
      const { dir, files } = await resolveAttachmentDir(id)
      let summary = null
      try {
        const cached = JSON.parse(await fs.readFile(path.join(dir, 'summary.json'), 'utf-8'))
        summary = { avgHr: cached.avgHr ?? null, maxHr: cached.maxHr ?? null,
          startTime: cached.startTime ?? null, durationSeconds: cached.durationSeconds ?? null }
      } catch { /* A visible card can recover an absent or invalid summary. */ }
      results[id] = { attached: files.length > 0, summary }
    }
  }))
  return results
}

export const readHrAttachment = async (
  completedWorkoutId: string,
  options: { details?: boolean; full?: boolean; cachedOnly?: boolean } = {}
) => {
  const wantDetails = options.details === true
  const wantFullSamples = options.full === true
  const maxSamples = wantDetails ? (wantFullSamples ? 0 : HR_SAMPLE_PREVIEW_LIMIT) : 0

  try {
    const { dir, files } = await resolveAttachmentDir(completedWorkoutId)
    const summaryPath = path.join(dir, 'summary.json')
    let summary: HrSummary | null = null
    let parsedFromFile = false

    try {
      summary = JSON.parse(await fs.readFile(summaryPath, 'utf-8'))
    } catch {
      if (files[0] && !options.cachedOnly) {
        const buffer = await fs.readFile(path.join(dir, files[0]))
        summary = await parseHrFile(buffer, files[0], wantDetails, maxSamples)
        parsedFromFile = true
        if (summary) {
          const persistable = wantFullSamples ? withSamplePreview(summary) : summary
          await writeSummary(dir, persistable)
        }
      }
    }

    if (!options.cachedOnly && wantDetails && wantFullSamples && files[0] && !parsedFromFile) {
      const buffer = await fs.readFile(path.join(dir, files[0]))
      const detailed = await parseHrFile(buffer, files[0], true, 0)
      if (detailed) {
        summary = detailed
        await writeSummary(dir, withSamplePreview(detailed))
      }
    }

    if (!options.cachedOnly && wantDetails && !wantFullSamples && summary && !summary.samples?.length && files[0]) {
      const buffer = await fs.readFile(path.join(dir, files[0]))
      const detailed = await parseHrFile(buffer, files[0], true, HR_SAMPLE_PREVIEW_LIMIT)
      if (detailed) {
        summary = detailed
        await writeSummary(dir, detailed)
      }
    }

    if (!wantDetails && summary) {
      const { samples: _samples, ...metadata } = summary
      return { attached: files.length > 0, files, summary: metadata }
    }
    return { attached: files.length > 0, files, summary }
  } catch {
    return { attached: false, files: [] as string[], summary: null }
  }
}

export const rebuildHrAttachmentSummary = async (completedWorkoutId: string) => {
  const { dir, files } = await resolveAttachmentDir(completedWorkoutId)
  if (!files[0]) {
    return { attached: false, files, filename: null, summary: null, updated: false }
  }

  const buffer = await fs.readFile(path.join(dir, files[0]))
  const summary = await parseHrFile(buffer, files[0], true, HR_SAMPLE_PREVIEW_LIMIT)
  if (!summary) {
    return { attached: true, files, filename: files[0], summary: null, updated: false }
  }

  await writeSummary(dir, summary)
  return { attached: true, files, filename: files[0], summary, updated: true }
}

export const saveHrAttachment = async (completedWorkoutId: string, file: File) => {
  const filename = file.name || 'garmin.fit'
  const lower = filename.toLowerCase()
  const isZip = lower.endsWith('.zip')
  const ext = lower.endsWith('.tcx') ? '.tcx' : '.fit'
  const dir = path.join(hrDir, completedWorkoutId)
  await ensureDir(dir)

  let chosenName = safeFilename(filename).toLowerCase().endsWith(ext)
    ? safeFilename(filename)
    : `${safeFilename(filename)}${ext}`
  let buffer: Buffer | null = Buffer.from(new Uint8Array(await file.arrayBuffer()))

  if (isZip) {
    const zip = new AdmZip(buffer)
    const fitEntry: any = zip
      .getEntries()
      .find(
        (entry: any) =>
          !entry.isDirectory &&
          (entry.entryName.toLowerCase().endsWith('.fit') ||
            entry.entryName.toLowerCase().endsWith('.tcx'))
      )
    if (!fitEntry) throw new Error('No FIT/TCX inside zip')
    chosenName = safeFilename(path.basename(fitEntry.entryName))
    buffer = fitEntry.getData()
  }

  if (!buffer) throw new Error('Failed to read file')
  await fs.writeFile(path.join(dir, chosenName), buffer)
  const summary = await parseHrFile(buffer, chosenName, true, HR_SAMPLE_PREVIEW_LIMIT)
  if (summary) {
    await writeSummary(dir, summary)
  }
  return { filename: chosenName, summary }
}

export const deleteHrAttachment = async (completedWorkoutId: string) => {
  await Promise.all(
    candidateDirs(completedWorkoutId).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  )
}

const parseHrFile = (
  buffer: Buffer,
  filename: string,
  includeSamples = false,
  maxSamples = HR_SAMPLE_PREVIEW_LIMIT
) =>
  new Promise<HrSummary | null>((resolve) => {
    const lower = filename.toLowerCase()
    if (lower.endsWith('.tcx')) {
      resolve(parseTcx(buffer, includeSamples, maxSamples))
      return
    }

    const parser = new FitParser({ force: true })
    parser.parse(buffer as any, (err: any, data: any) => {
      if (err || !data) {
        resolve(null)
        return
      }

      try {
        const records = data.records ?? []
        const hrValues: number[] = []
        const samples: HrSample[] = []
        let startTime: number | null = null
        let endTime: number | null = null

        records.forEach((record: any) => {
          if (record.heart_rate !== undefined) {
            hrValues.push(Number(record.heart_rate))
          }
          if (record.timestamp instanceof Date) {
            const ts = record.timestamp.getTime()
            if (startTime === null || ts < startTime) startTime = ts
            if (endTime === null || ts > endTime) endTime = ts
            if (includeSamples && record.heart_rate !== undefined) {
              samples.push({ t: ts, hr: Number(record.heart_rate) })
            }
          }
        })

        const avgHr = hrValues.length
          ? Math.round(hrValues.reduce((sum, value) => sum + value, 0) / hrValues.length)
          : null
        const maxHr = hrValues.length ? Math.max(...hrValues) : null
        const durationSeconds =
          startTime !== null && endTime !== null
            ? Math.max(0, Math.round((endTime - startTime) / 1000))
            : null
        const downsampled = includeSamples ? downsample(samples, maxSamples, startTime) : undefined
        resolve({ avgHr, maxHr, startTime, durationSeconds, samples: downsampled })
      } catch {
        resolve(null)
      }
    })
  })

const parseTcx = (
  buffer: Buffer,
  includeSamples = false,
  maxSamples = HR_SAMPLE_PREVIEW_LIMIT
): HrSummary | null => {
  try {
    const xml = buffer.toString('utf-8')
    const trackpoints = [...xml.matchAll(/<Trackpoint\b[\s\S]*?<\/Trackpoint>/g)]
    const parsedTrackpoints = trackpoints
      .map((match) => {
        const block = match[0]
        const time = block.match(/<Time>([^<]+)<\/Time>/)?.[1] ?? null
        const hr = block.match(/<HeartRateBpm>\s*<Value>(\d+)<\/Value>/)?.[1] ?? null
        return {
          t: time ? Date.parse(time) : NaN,
          hr: hr !== null ? Number(hr) : null
        }
      })
      .filter((sample) => Number.isFinite(sample.t))
    const timeMatches =
      parsedTrackpoints.length > 0
        ? parsedTrackpoints.map((sample) => sample.t)
        : [...xml.matchAll(/<Time>([^<]+)<\/Time>/g)]
            .map((match) => Date.parse(match[1]))
            .filter(Number.isFinite)
    const hrMatches = parsedTrackpoints
      .map((sample) => sample.hr)
      .filter((hr): hr is number => hr !== null && Number.isFinite(hr))
    if (!timeMatches.length) return null

    const startTime = timeMatches[0]
    const endTime = timeMatches[timeMatches.length - 1]
    const durationSeconds = Math.max(0, Math.round((endTime - startTime) / 1000))
    const avgHr = hrMatches.length
      ? Math.round(hrMatches.reduce((sum, value) => sum + value, 0) / hrMatches.length)
      : null
    const maxHr = hrMatches.length ? Math.max(...hrMatches) : null
    let samples: { t: number; hr: number }[] = []

    if (includeSamples) {
      samples = parsedTrackpoints.filter(
        (sample): sample is HrSample => sample.hr !== null && Number.isFinite(sample.hr)
      )
      samples = downsample(samples, maxSamples, Number.isFinite(startTime) ? startTime : null)
    }

    return {
      avgHr,
      maxHr,
      startTime: Number.isFinite(startTime) ? startTime : null,
      durationSeconds,
      samples
    }
  } catch {
    return null
  }
}

const downsample = (
  samples: HrSample[],
  target = HR_SAMPLE_PREVIEW_LIMIT,
  start: number | null = null
) => {
  if (!samples.length) return []
  const base = start ?? samples[0].t
  const maxSamples = Number(target)
  if (!Number.isFinite(maxSamples) || maxSamples <= 0 || samples.length <= maxSamples) {
    return samples.map((sample) => ({ t: Math.round((sample.t - base) / 1000), hr: sample.hr }))
  }

  const bucketSize = Math.ceil(samples.length / maxSamples)
  const result: { t: number; hr: number }[] = []
  for (let index = 0; index < samples.length; index += bucketSize) {
    const bucket = samples.slice(index, index + bucketSize)
    const hr = Math.round(bucket.reduce((sum, sample) => sum + sample.hr, 0) / bucket.length)
    const t = Math.round((bucket[Math.floor(bucket.length / 2)].t - base) / 1000)
    result.push({ t, hr })
  }
  return result
}

const downsampleSeconds = (samples: HrSample[], target = HR_SAMPLE_PREVIEW_LIMIT) => {
  if (!samples.length) return []
  const maxSamples = Number(target)
  if (!Number.isFinite(maxSamples) || maxSamples <= 0 || samples.length <= maxSamples) {
    return samples
  }

  const bucketSize = Math.ceil(samples.length / maxSamples)
  const result: HrSample[] = []
  for (let index = 0; index < samples.length; index += bucketSize) {
    const bucket = samples.slice(index, index + bucketSize)
    const midpoint = bucket[Math.floor(bucket.length / 2)]
    result.push({
      t: midpoint.t,
      hr: Math.round(bucket.reduce((sum, sample) => sum + sample.hr, 0) / bucket.length)
    })
  }
  return result
}
