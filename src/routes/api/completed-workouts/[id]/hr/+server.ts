import { error, json } from '@sveltejs/kit'
import { ensureSessionUser, getDb } from '$lib/server/db'
import fs from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import FitParser from 'fit-file-parser'

const COOKIE_NAME = 'kb_session'
const hrDir = path.resolve('data', 'hr')

const ensureDir = async (dir: string) => {
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch {
    // ignore
  }
}

export const GET = async ({ params, cookies, url }) => {
  ensureSessionUser(cookies.get(COOKIE_NAME))
  const id = params.id
  if (!id) throw error(400, 'Missing id')
  const wantDetails = url.searchParams.get('details') === '1'
  const dir = path.join(hrDir, id)
  try {
    const entries = await fs.readdir(dir)
    const files = entries.filter((f) => f.endsWith('.fit') || f.endsWith('.tcx'))
    const summaryPath = path.join(dir, 'summary.json')
    let summary = null
    try {
      const raw = await fs.readFile(summaryPath, 'utf-8')
      summary = JSON.parse(raw)
    } catch {
      // attempt to derive from first file
      if (files[0]) {
        const buffer = await fs.readFile(path.join(dir, files[0]))
        summary = await parseHrFile(buffer, files[0], wantDetails)
        if (summary) {
          await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2))
        }
      }
    }
    // if details requested but summary lacks samples, rebuild from first file
    if (wantDetails && summary && !summary.samples && files[0]) {
      const buffer = await fs.readFile(path.join(dir, files[0]))
      const detailed = await parseHrFile(buffer, files[0], true)
      if (detailed) summary = detailed
    }
    return json({ attached: files.length > 0, files, summary })
  } catch {
    return json({ attached: false, files: [] })
  }
}

export const POST = async ({ request, params, cookies }) => {
  ensureSessionUser(cookies.get(COOKIE_NAME))
  const id = params.id
  if (!id) throw error(400, 'Missing id')
  const form = await request.formData()
  const file = form.get('file') as File | null
  if (!file) throw error(400, 'No file provided')
  const filename = file.name || 'garmin.fit'
  const lower = filename.toLowerCase()
  const isZip = lower.endsWith('.zip')
  const ext = lower.endsWith('.tcx') ? '.tcx' : '.fit'
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const finalName = safeName.toLowerCase().endsWith(ext) ? safeName : `${safeName}${ext}`
  const dir = path.join(hrDir, id)
  await ensureDir(dir)
  let chosenName = finalName
  let buffer: Buffer | null = null
  const buf = Buffer.from(new Uint8Array(await file.arrayBuffer()))
  if (isZip) {
    const zip = new AdmZip(buf)
    const fitEntry: any = zip
      .getEntries()
      .find((e: any) => !e.isDirectory && (e.entryName.toLowerCase().endsWith('.fit') || e.entryName.toLowerCase().endsWith('.tcx')))
    if (!fitEntry) throw error(400, 'No FIT/TCX inside zip')
    chosenName = path.basename(fitEntry.entryName)
    buffer = fitEntry.getData()
  } else {
    buffer = buf
  }
  if (!buffer) throw error(400, 'Failed to read file')
  await fs.writeFile(path.join(dir, chosenName), buffer)

  // parse summary
  const summary = await parseHrFile(buffer, chosenName)
  if (summary) {
    await fs.writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2))
    // update workout start/end
    if (summary.startTime && summary.durationSeconds) {
      const db = getDb()
      db.prepare(
        `UPDATE completed_workouts SET started_at = ?, finished_at = ?, duration_s = ? WHERE id = ?`
      ).run(
        summary.startTime,
        summary.startTime + summary.durationSeconds * 1000,
        summary.durationSeconds,
        id
      )
    }
  }

  return json({ ok: true, filename: chosenName, summary })
}

export const DELETE = async ({ params, cookies }) => {
  ensureSessionUser(cookies.get(COOKIE_NAME))
  const id = params.id
  if (!id) throw error(400, 'Missing id')
  const dir = path.join(hrDir, id)
  try {
    await fs.rm(dir, { recursive: true, force: true })
    const db = getDb()
    db.prepare(
      `UPDATE completed_workouts SET started_at = started_at, finished_at = finished_at WHERE id = ?`
    ).run(id)
    return json({ ok: true })
  } catch {
    return json({ ok: false }, { status: 500 })
  }
}

const parseHrFile = (buffer: Buffer, filename: string, includeSamples = false) =>
  new Promise<any | null>((resolve) => {
    const lower = filename.toLowerCase()
    if (lower.endsWith('.tcx')) {
      resolve(parseTcx(buffer, includeSamples))
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
        records.forEach((r: any) => {
          if (r.heart_rate !== undefined) {
            hrValues.push(Number(r.heart_rate))
          }
          if (r.timestamp instanceof Date) {
            const ts = r.timestamp.getTime()
            if (startTime === null || ts < startTime) startTime = ts
            if (endTime === null || ts > endTime) endTime = ts
            if (includeSamples && r.heart_rate !== undefined) {
              samples.push({ t: ts, hr: Number(r.heart_rate) })
            }
          }
        })
        const avgHr =
          hrValues.length > 0
            ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length)
            : null
        const maxHr = hrValues.length > 0 ? Math.max(...hrValues) : null
        const durationSeconds =
          startTime !== null && endTime !== null ? Math.max(0, Math.round((endTime - startTime) / 1000)) : null
        const downsampled =
          includeSamples && startTime !== null ? downsample(samples, 200, startTime) : undefined
        resolve({ avgHr, maxHr, startTime, durationSeconds, samples: downsampled })
      } catch {
        resolve(null)
      }
    })
  })

const parseTcx = (buffer: Buffer, includeSamples = false) => {
  try {
    const xml = buffer.toString('utf-8')
    const timeMatches = [...xml.matchAll(/<Time>([^<]+)<\/Time>/g)].map((m) => m[1])
    const hrMatches = [...xml.matchAll(/<HeartRateBpm>\s*<Value>(\d+)<\/Value>/g)].map((m) => Number(m[1]))
    if (!timeMatches.length) return null
    const startTime = Date.parse(timeMatches[0])
    const endTime = Date.parse(timeMatches[timeMatches.length - 1])
    const durationSeconds = Math.max(0, Math.round((endTime - startTime) / 1000))
    const avgHr = hrMatches.length ? Math.round(hrMatches.reduce((a, b) => a + b, 0) / hrMatches.length) : null
    const maxHr = hrMatches.length ? Math.max(...hrMatches) : null
    let samples: { t: number; hr: number }[] = []
    if (includeSamples) {
      samples = timeMatches
        .map((t, idx) => ({ t: Date.parse(t), hr: hrMatches[idx] ?? null }))
        .filter((s) => Number.isFinite(s.t) && s.hr !== null) as any
      samples = downsample(samples, 200, Number.isFinite(startTime) ? startTime : null)
    }
    return { avgHr, maxHr, startTime: Number.isFinite(startTime) ? startTime : null, durationSeconds, samples }
  } catch {
    return null
  }
}

const downsample = (samples: { t: number; hr: number }[], target = 200, start: number | null = null) => {
  if (!samples?.length) return []
  if (samples.length <= target) {
    const base = start ?? samples[0].t
    return samples.map((s) => ({ t: Math.round((s.t - base) / 1000), hr: s.hr }))
  }
  const base = start ?? samples[0].t
  const bucketSize = Math.ceil(samples.length / target)
  const res: { t: number; hr: number }[] = []
  for (let i = 0; i < samples.length; i += bucketSize) {
    const bucket = samples.slice(i, i + bucketSize)
    const hr = Math.round(bucket.reduce((sum, s) => sum + s.hr, 0) / bucket.length)
    const t = Math.round((bucket[Math.floor(bucket.length / 2)].t - base) / 1000)
    res.push({ t, hr })
  }
  return res
}
