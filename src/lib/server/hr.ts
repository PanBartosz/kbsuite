import AdmZip from 'adm-zip'
import FitParser from 'fit-file-parser'
import fs from 'node:fs/promises'
import path from 'node:path'

const dataDir = process.env.KB_SUITE_DATA_DIR
  ? path.resolve(process.env.KB_SUITE_DATA_DIR)
  : path.join(process.cwd(), 'data')
const hrDir = path.join(dataDir, 'hr')

const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
}

const safeFilename = (filename: string) => filename.replace(/[^a-zA-Z0-9._-]/g, '_')

export const readHrAttachment = async (
  completedWorkoutId: string,
  options: { details?: boolean; full?: boolean } = {}
) => {
  const wantDetails = options.details === true
  const wantFullSamples = options.full === true
  const maxSamples = wantDetails ? (wantFullSamples ? 0 : 200) : 0
  const dir = path.join(hrDir, completedWorkoutId)

  try {
    const entries = await fs.readdir(dir)
    const files = entries.filter((file) => file.endsWith('.fit') || file.endsWith('.tcx'))
    const summaryPath = path.join(dir, 'summary.json')
    let summary = null
    let parsedFromFile = false

    try {
      summary = JSON.parse(await fs.readFile(summaryPath, 'utf-8'))
    } catch {
      if (files[0]) {
        const buffer = await fs.readFile(path.join(dir, files[0]))
        summary = await parseHrFile(buffer, files[0], wantDetails, maxSamples)
        parsedFromFile = true
        if (summary) {
          const persistable = wantFullSamples ? { ...summary, samples: undefined } : summary
          await fs.writeFile(summaryPath, JSON.stringify(persistable, null, 2))
        }
      }
    }

    if (wantDetails && wantFullSamples && files[0] && !parsedFromFile) {
      const buffer = await fs.readFile(path.join(dir, files[0]))
      const detailed = await parseHrFile(buffer, files[0], true, 0)
      if (detailed) summary = detailed
    }

    if (wantDetails && !wantFullSamples && summary && !summary.samples && files[0]) {
      const buffer = await fs.readFile(path.join(dir, files[0]))
      const detailed = await parseHrFile(buffer, files[0], true, 200)
      if (detailed) summary = detailed
    }

    return { attached: files.length > 0, files, summary }
  } catch {
    return { attached: false, files: [] as string[], summary: null }
  }
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
  const summary = await parseHrFile(buffer, chosenName)
  if (summary) {
    await fs.writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2))
  }
  return { filename: chosenName, summary }
}

export const deleteHrAttachment = async (completedWorkoutId: string) => {
  await fs.rm(path.join(hrDir, completedWorkoutId), { recursive: true, force: true })
}

const parseHrFile = (buffer: Buffer, filename: string, includeSamples = false, maxSamples = 200) =>
  new Promise<any | null>((resolve) => {
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
        const samples: { t: number; hr: number }[] = []
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

const parseTcx = (buffer: Buffer, includeSamples = false, maxSamples = 200) => {
  try {
    const xml = buffer.toString('utf-8')
    const timeMatches = [...xml.matchAll(/<Time>([^<]+)<\/Time>/g)].map((match) => match[1])
    const hrMatches = [...xml.matchAll(/<HeartRateBpm>\s*<Value>(\d+)<\/Value>/g)].map(
      (match) => Number(match[1])
    )
    if (!timeMatches.length) return null

    const startTime = Date.parse(timeMatches[0])
    const endTime = Date.parse(timeMatches[timeMatches.length - 1])
    const durationSeconds = Math.max(0, Math.round((endTime - startTime) / 1000))
    const avgHr = hrMatches.length
      ? Math.round(hrMatches.reduce((sum, value) => sum + value, 0) / hrMatches.length)
      : null
    const maxHr = hrMatches.length ? Math.max(...hrMatches) : null
    let samples: { t: number; hr: number }[] = []

    if (includeSamples) {
      samples = timeMatches
        .map((time, index) => ({ t: Date.parse(time), hr: hrMatches[index] ?? null }))
        .filter((sample) => Number.isFinite(sample.t) && sample.hr !== null) as any
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
  samples: { t: number; hr: number }[],
  target = 200,
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
