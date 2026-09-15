import { chromium } from '@playwright/test'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
const url = process.env.KB_PROFILE_URL || 'http://127.0.0.1:4173/counter'
const seconds = Number(process.env.KB_PROFILE_SECONDS || 60)
const output = process.env.KB_PROFILE_OUTPUT || '/tmp/kb-suite-counter-profile.json'
const executablePath = process.env.KB_BROWSER_PATH || (existsSync('/opt/brave.com/brave/brave') ? '/opt/brave.com/brave/brave' : undefined)
const browser = await chromium.launch({ executablePath, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.addInitScript(() => {
    const metrics = { sent: 0, completed: 0, maxInFlight: 0, inFlight: 0, widths: [], heights: [], resultAgeMs: [], inferenceMs: [], errors: [] }
    window.__kbProfile = metrics
    const original = Worker.prototype.postMessage
    const watched = new WeakSet()
    Worker.prototype.postMessage = function (message, transfer) {
      if (!watched.has(this)) {
        watched.add(this)
        const sent = new Map()
        this.__kbSent = sent
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'error') metrics.errors.push(data.message)
          if (data.type !== 'poses') return
          const id = data.id ?? sent.keys().next().value
          const at = sent.get(id)
          sent.delete(id)
          metrics.completed++
          metrics.inFlight = Math.max(0, metrics.inFlight - 1)
          if (at && metrics.resultAgeMs.length < 10000) metrics.resultAgeMs.push(performance.now() - at)
          if (data.inferenceMs !== undefined && metrics.inferenceMs.length < 10000) metrics.inferenceMs.push(data.inferenceMs)
        })
      }
      if (message.type === 'frame') {
        const id = message.id ?? metrics.sent
        this.__kbSent.set(id, performance.now())
        metrics.sent++
        metrics.inFlight++
        metrics.maxInFlight = Math.max(metrics.maxInFlight, metrics.inFlight)
        if (!metrics.widths.includes(message.image.width)) metrics.widths.push(message.image.width)
        if (!metrics.heights.includes(message.image.height)) metrics.heights.push(message.image.height)
      }
      return original.call(this, message, transfer)
    }
  })
  await page.goto(url)
  await page.locator('.controls').getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForFunction(() => window.__kbProfile.completed >= 10 || window.__kbProfile.errors.length > 0, undefined, { timeout: 90000 })
  const samples = []
  for (let i = 0; i < seconds; i++) {
    await page.waitForTimeout(1000)
    samples.push(await page.evaluate(() => ({ at: Date.now(), completed: window.__kbProfile.completed, heapBytes: performance.memory?.usedJSHeapSize, pending: window.__kbProfile.inFlight })))
    if (i % 15 === 0) console.log(`Profile: ${i + 1}/${seconds} seconds`)
  }
  const metrics = await page.evaluate(() => window.__kbProfile)
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)] ?? null
  const report = { url, browser: browser.version(), seconds, syntheticCamera: true, ...metrics,
    resultAgeP95Ms: percentile(metrics.resultAgeMs, 0.95), inferenceP95Ms: percentile(metrics.inferenceMs, 0.95), samples }
  await writeFile(output, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ output, completed: report.completed, maxInFlight: report.maxInFlight, resultAgeP95Ms: report.resultAgeP95Ms, errors: report.errors }))
  if (report.errors.length || !report.completed) process.exitCode = 1
} finally { await browser.close() }
