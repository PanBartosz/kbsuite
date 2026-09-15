// Repeatable cold-page comparison using synthetic sessions and a disposable server.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const port = 4192
const base = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  env: { ...process.env, KB_SUITE_DATA_DIR: '/tmp/kb-suite-page-profile' }, stdio: 'ignore'
})
let browser
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error('Profile server could not start')
    try { if ((await fetch(base)).ok) break } catch {}
    await delay(250)
  }
  const installed = '/opt/brave.com/brave/brave'
  browser = await chromium.launch({ executablePath: process.env.KB_BROWSER_PATH || (existsSync(installed) ? installed : undefined) })
  const records = []
  for (const path of ['/history', '/plan']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    let hrRequests = 0, hrBytes = 0, jsBytes = 0, listBytes = 0
    const responses = []
    page.on('response', response => {
      if (new URL(response.url()).pathname.endsWith('.js')) responses.push(response.body().then(body => { jsBytes += body.length }).catch(() => {}))
    })
    const now = Date.now()
    const items = Array.from({ length: 200 }, (_, i) => ({
      id: `profile-${i}`, title: `Practice ${i}`, created_at: now - i * 86400000, started_at: now - i * 86400000, duration_s: 1200,
      hr: { attached: true, summary: { avgHr: 130, maxHr: 165 } },
      sets: [{ round_label: 'Main', set_label: 'Swings', reps: 50, weight: 24, duration_s: 1200, type: 'work' }]
    }))
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.origin !== base) return route.abort()
      if (url.pathname === '/api/completed-workouts') {
        const body = JSON.stringify({ items })
        listBytes += Buffer.byteLength(body)
        return route.fulfill({ contentType: 'application/json', body })
      }
      if (/\/api\/completed-workouts\/[^/]+\/hr$/.test(url.pathname)) {
        hrRequests++
        const body = JSON.stringify({ attached: true, summary: { avgHr: 130, maxHr: 165, samples: Array.from({ length: 200 }, (_, i) => ({ t: i * 6, hr: 120 + i % 40 })) } })
        hrBytes += Buffer.byteLength(body)
        return route.fulfill({ contentType: 'application/json', body })
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { items: [], workouts: [], settings: {} } })
      return route.continue()
    })
    const started = performance.now()
    await page.goto(base + path)
    await page.getByRole('heading', { name: path === '/history' ? 'History' : 'Planner', exact: true }).waitFor()
    if (path === '/history') await page.locator('article.card').first().waitFor()
    const firstContentMs = Math.round(performance.now() - started)
    await page.waitForTimeout(5000)
    await Promise.allSettled(responses)
    const initial = { hrRequests, hrBytes, jsBytes, listBytes }
    const actionStart = performance.now()
    if (path === '/history') {
      await page.getByRole('searchbox', { name: 'Search history' }).fill('Practice 199')
      await page.waitForFunction(() => document.querySelectorAll('article.card').length === 1)
    } else {
      await page.getByRole('button', { name: 'Add workout', exact: true }).first().click()
      await page.locator('.edit-modal').waitFor()
    }
    const actionMs = Math.round(performance.now() - actionStart)
    await page.waitForTimeout(500)
    await Promise.allSettled(responses)
    records.push({ path, firstContentMs, actionMs, initial,
      interaction: { hrRequests: hrRequests - initial.hrRequests, hrBytes: hrBytes - initial.hrBytes, jsBytes: jsBytes - initial.jsBytes },
      total: { hrRequests, hrBytes, jsBytes, listBytes }
    })
    await context.close()
  }
  const result = { conditions: '390×844, 4× CPU slowdown, 200 synthetic sessions, external requests blocked; one cold sample per route. Initial: navigation plus 5 s settling. Interaction: History search for Practice 199 or Planner Add, plus 500 ms. Bytes are decoded bodies, not compressed wire transfer; list API is mocked, so server I/O is not measured.', records }
  writeFileSync(process.argv[2] || '/tmp/kb-suite-page-profile.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser?.close()
  server.kill()
}
