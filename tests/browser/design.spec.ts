import { test, expect, type Page } from '@playwright/test'

const yaml = `title: Long cycle intervals
preStartSeconds: 0
rounds:
  - id: main
    label: Main set
    sets:
      - id: long-cycle
        label: Long cycle
        workSeconds: 120
        restSeconds: 30
        repetitions: 3
`

async function fixtures(page: Page) {
  const now = Date.now()
  await page.route('**/api/workouts', route => route.fulfill({ json: { workouts: [
    { id: 'design-template', name: 'Long cycle intervals', yaml_source: yaml, is_template: true },
    { id: 'design-own', name: 'My practice', yaml_source: yaml, is_template: false }
  ] } }))
  await page.route('**/api/planned-workouts*', route => route.fulfill({ json: { items: [
    { id: 'design-plan', title: 'Long cycle intervals', planned_for: now, yaml_source: yaml, notes: 'Keep a steady pace.', tags: ['kettlebell'] }
  ] } }))
  await page.route('**/api/shared-workouts?*', route => route.fulfill({ json: { items: [] } }))
  await page.route('**/api/completed-workouts', route => route.fulfill({ json: { items: [
    { id: 'design-log', workout_id: 'design-own', title: 'Long cycle intervals', started_at: now - 1800000, created_at: now, duration_s: 1800, notes: 'Steady session.', sets: [
      { round_label: 'Main set', set_label: 'Long cycle', reps: 20, weight: 32, duration_s: 120, type: 'work' }
    ] }
  ] } }))
  await page.route('**/api/program-runs', route => route.fulfill({ json: { items: [] } }))
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual((await page.viewportSize())!.width + 1)
}

for (const viewport of [{ width: 360, height: 640 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1440, height: 1000 }]) {
  test(`main screens fit ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await fixtures(page)
    for (const route of ['/', '/programs', '/plan', '/workouts', '/history', '/counter', '/timer?workout=design-template']) {
      await page.goto(route)
      await expect(page.locator('.topbar')).toBeVisible()
      await noOverflow(page)
    }
    await expect(page.locator('.config-editor textarea')).toBeHidden()
    await expect(page.locator('.timer-display__next')).toContainText('First phase')
    await expect(page.locator('.timer-display__next')).toContainText('Long cycle')
  })
}

test('Home puts today’s start above the fold and retains expandable session details', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixtures(page)
  await page.goto('/')
  const today = page.locator('.today-card')
  await expect(today.getByRole('link', { name: 'Start workout', exact: true })).toBeInViewport()
  await expect(page.locator('.invites-card')).toHaveCount(0)
  await expect(today.getByText('Keep a steady pace.')).toBeHidden()
  await today.locator('summary').click()
  await expect(today.getByText('Keep a steady pace.')).toBeVisible()
  await page.locator('.balance > summary').click()
  await expect(page.locator('.movement-chart canvas')).toBeVisible()
  await expect.poll(async () => (await page.locator('.movement-chart canvas').boundingBox())?.width ?? 0).toBeGreaterThan(100)
})

test('mobile summary keeps inputs usable, copies matching values and saves them', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixtures(page)
  await page.goto('/timer?workout=design-template')
  await page.locator('.status-actions').getByRole('button', { name: 'Summary', exact: true }).click()
  const summary = page.getByRole('dialog', { name: 'Workout summary', exact: true })
  const reps = summary.getByRole('spinbutton', { name: /^Logged reps:/ })
  const weights = summary.getByRole('spinbutton', { name: /^Weight:/ })
  await expect(reps).toHaveCount(3)
  expect((await reps.first().boundingBox())!.width).toBeGreaterThan(100)
  await reps.first().fill('24')
  await weights.first().fill('32')
  await summary.getByRole('button', { name: 'Copy to matching', exact: true }).first().click()
  const copy = page.getByRole('dialog', { name: 'Copy reps and weight', exact: true })
  await expect(copy.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(copy.getByRole('button', { name: 'Confirm copy' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(copy).toBeHidden()
  for (let i = 0; i < 3; i++) {
    await expect(reps.nth(i)).toHaveValue('24')
    await expect(weights.nth(i)).toHaveValue('32')
  }
  // A shorter visible area approximates opening the phone keyboard.
  await page.setViewportSize({ width: 390, height: 470 })
  await expect(summary.getByRole('button', { name: 'Save session', exact: true })).toBeInViewport()
  await noOverflow(page)
  const request = page.waitForRequest(req => req.url().endsWith('/api/completed-workouts') && req.method() === 'POST')
  await page.route('**/api/completed-workouts', route => route.fulfill({ json: { item: { id: 'design-saved' } } }))
  await summary.getByRole('button', { name: 'Save session', exact: true }).click()
  const payload = (await request).postDataJSON()
  expect(payload.entries.filter((entry: any) => entry.type === 'work').map((entry: any) => [entry.loggedReps, entry.weight])).toEqual([[24,32], [24,32], [24,32]])
  await expect(summary).toBeHidden()
})

test('library More closes with Escape and outside click and retains deletion confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixtures(page)
  await page.goto('/workouts')
  const template = page.locator('article.card').filter({ hasText: 'Long cycle intervals' })
  const trigger = template.locator('.action-menu > summary')
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(template.getByRole('button', { name: 'Copy YAML' })).toBeVisible()
  await expect(template.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
  await page.keyboard.press('Tab')
  await expect(template.getByRole('button', { name: 'Copy YAML' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(template.getByRole('button', { name: 'Copy YAML' })).toBeHidden()
  await trigger.click()
  await page.getByRole('heading', { name: 'Workouts', exact: true }).click()
  await expect(template.getByRole('button', { name: 'Copy YAML' })).toBeHidden()
  const own = page.locator('article.card').filter({ hasText: 'My practice' })
  await own.locator('.action-menu > summary').click()
  await own.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.locator('.confirm-modal')).toBeVisible()
  await page.locator('.confirm-modal').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(own).toBeVisible()
})

test('History has one set of actions with editable notes and confirmed deletion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixtures(page)
  await page.goto('/history')
  const card = page.locator('article.card').first()
  await expect(card.locator('.card-actions-row')).toHaveCount(1)
  await card.getByRole('button', { name: 'Details', exact: true }).click()
  await expect(card.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(1)
  await expect(card.getByRole('button', { name: 'Notes', exact: true })).toHaveCount(1)
  await card.locator('.action-menu > summary').click()
  await expect(card.getByRole('button', { name: 'Copy CSV', exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Delete session', exact: true }).click()
  await expect(page.locator('.confirm-modal')).toBeVisible()
  await page.locator('.confirm-modal').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(card).toBeVisible()
})

test('mobile navigation shows the current page and exposes training tools', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixtures(page)
  await page.goto('/plan')
  const toggle = page.getByRole('button', { name: 'Toggle navigation' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(nav.getByRole('link', { name: 'Planner', exact: true })).toHaveAttribute('aria-current', 'page')
  await nav.locator('summary').click()
  await nav.getByRole('link', { name: 'Timer', exact: true }).click()
  await expect(page).toHaveURL(/\/timer$/)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await nav.locator('summary').click()
  await expect(nav.getByRole('link', { name: 'Timer', exact: true })).toHaveAttribute('aria-current', 'page')
})

test('closing and reopening the workout editor preserves unapplied changes', async ({ page }) => {
  await fixtures(page)
  await page.goto('/timer?workout=design-template')
  const editor = page.locator('.workout-editor')
  await editor.locator(':scope > summary').click()
  const input = editor.locator('.config-editor textarea')
  const changed = yaml.replace('Long cycle intervals', 'Edited practice')
  await input.fill(changed)
  await editor.locator(':scope > summary').click()
  await expect(input).toBeHidden()
  await editor.locator(':scope > summary').click()
  await expect(input).toHaveValue(changed)
  await editor.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Edited practice', exact: true }).first()).toBeVisible()
})

test('program fields remain editable and preview uses the edited values', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await fixtures(page)
  await page.goto('/programs')
  await page.getByRole('button', { name: 'Create program', exact: true }).click()
  await page.getByRole('textbox', { name: 'Program title', exact: true }).fill('Mobile program')
  await page.getByRole('spinbutton', { name: 'Microcycles', exact: true }).fill('1')
  await page.getByRole('textbox', { name: 'Secondary exercise', exact: true }).first().fill('Practice press')
  const request = page.waitForRequest(req => req.url().endsWith('/api/program-runs/preview'))
  const response = page.waitForResponse(res => res.url().endsWith('/api/program-runs/preview'))
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  const payload = (await request).postDataJSON()
  expect(payload.spec.title).toBe('Mobile program')
  expect(payload.spec.secondary[0].exercise).toBe('Practice press')
  expect((await response).ok()).toBeTruthy()
  await expect(page.locator('.day-table .table-row').first()).toBeVisible()
  await noOverflow(page)
})

test('primary action text has readable contrast in every theme', async ({ page }) => {
  await fixtures(page)
  // No server theme merge or animation should race the computed-color measurement.
  await page.route('**/api/settings', route => route.fulfill({ json: { settings: null } }))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const path of ['/workouts', '/counter']) {
    await page.goto(path)
    const button = page.locator(path === '/workouts' ? 'article.card button.primary' : '.session-actions button.primary').first()
    await expect(button).toBeVisible()
    for (const theme of ['dark', 'light', 'vibrant', 'neon', 'midnight', 'sand']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
      const ratio = await button.evaluate(element => {
        const style = getComputedStyle(element)
        const luminance = (color: string) => {
          const rgb = color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
        }
        const fg = luminance(style.color), bg = luminance(style.backgroundColor)
        return (Math.max(fg,bg) + 0.05) / (Math.min(fg,bg) + 0.05)
      })
      expect(ratio, `${path} ${theme}`).toBeGreaterThanOrEqual(4.5)
    }
  }
})

test('planner starts with a library choice and keeps the advanced editor optional', async ({ page }) => {
  const scripts: string[] = []
  page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()) })
  await page.setViewportSize({ width: 390, height: 844 })
  await fixtures(page)
  await page.goto('/plan')
  await expect(page.getByRole('heading', { name: 'Planner', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: 'Add workout', exact: true }).first().click()
  const editor = page.locator('.edit-modal')
  await expect(editor.locator('.library-picker')).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await page.route('**/api/workouts', async route => {
    await route.fulfill({ status: 503, json: { error: 'Unavailable' } })
  }, { times: 1 })
  await editor.getByRole('button', { name: 'Choose from library', exact: true }).click()
  const library = page.getByRole('heading', { name: 'Workout library', exact: true })
  await expect(library).toBeVisible()
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search workout library' }).fill('My practice')
  await page.getByRole('button', { name: 'Use workout', exact: true }).click()
  await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('My practice')
  await expect(editor.locator('.advanced-editor')).not.toHaveAttribute('open', '')
  await expect(editor.locator('.config-editor')).toHaveCount(0)
  expect(scripts.filter(url => /YamlConfigEditor|editor\.api|monaco/i.test(url))).toEqual([])
  await editor.getByRole('textbox', { name: 'Notes', exact: true }).fill('Bring the 24 kg bell')
  let saved: any
  let attempts = 0
  await page.route('**/api/planned-workouts', route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { items: [] } })
    saved = route.request().postDataJSON()
    return route.fulfill(++attempts === 1 ? { status: 503, json: { error: 'Please retry.' } } : { json: { item: { ...saved, id: 'saved-plan', planned_for: saved.plannedFor } } })
  })
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor.getByRole('alert')).toHaveText('Please retry.')
  await expect(editor.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Bring the 24 kg bell')
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor).toBeHidden()
  expect(saved).toMatchObject({ title: 'My practice', yaml_source: yaml, notes: 'Bring the 24 kg bell' })
})

test('counter fits small phones and its styles stay out of other pages', async ({ page }) => {
  await fixtures(page)
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/counter')
  await expect(page.locator('.rep-badge')).toBeVisible()
  const reps = (await page.locator('.rep-badge').boundingBox())!
  const mode = (await page.locator('.mode-badge').boundingBox())!
  expect(reps.x + reps.width).toBeLessThan(mode.x)
  await noOverflow(page)
  await expect(page.locator('.mobile-bar').getByRole('button', { name: 'Start', exact: true })).toBeInViewport()
  await page.locator('.tips > summary').click()
  await noOverflow(page)
  await page.evaluate(() => document.documentElement.dataset.theme = 'light')
  const colors = await page.locator('.mobile-bar').evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el.querySelector('.ghost')!).color }))
  expect(colors.bg).toBe('rgb(255, 255, 255)')
  expect(colors.fg).toBe('rgb(31, 41, 55)')
  await page.getByRole('link', { name: 'KB Suite home', exact: true }).click()
  await expect(page.locator('.today-card')).toBeVisible()
  await noOverflow(page)
})

test('program draft requires preview and calendar creation requires confirmed review', async ({ page }) => {
  await fixtures(page)
  let run: any
  let generates = 0
  await page.route('**/api/program-runs', route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { items: [] } })
    const spec = route.request().postDataJSON().spec
    run = { id: 'review-test', kind: 'dep-total-work', title: spec.title, spec, status: 'draft', workouts: [], summary: {} }
    return route.fulfill({ json: { item: run } })
  })
  await page.route('**/api/program-runs/review-test/generate', route => {
    generates++
    return route.fulfill(generates === 1 ? { status: 503, json: { error: 'Please retry.' } } : { json: { item: { ...run, workouts: [{ id: 'day-1', title: 'First workout', planned_workout_id: 'day-1', status: 'planned', planned_metrics: {} }] }, planned: [{ id: 'day-1' }] } })
  })
  await page.goto('/programs')
  await page.getByRole('button', { name: 'Create program', exact: true }).click()
  const save = page.getByRole('button', { name: 'Save draft', exact: true })
  await expect(save).toBeDisabled()
  await page.getByRole('spinbutton', { name: 'Microcycles', exact: true }).fill('1')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(save).toBeEnabled()
  await page.getByRole('textbox', { name: 'Program title', exact: true }).fill('Review test')
  await expect(save).toBeDisabled()
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(save).toBeEnabled()
  await save.click()
  const add = page.getByRole('button', { name: 'Add to Planner', exact: true })
  await add.click()
  const review = page.locator('.schedule-review')
  await expect(review).toBeVisible()
  expect(generates).toBe(0)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(generates).toBe(0)
  await add.click()
  await review.getByRole('button', { name: 'Confirm and add to Planner' }).click()
  await expect(review.getByRole('alert')).toHaveText('Please retry.')
  await review.getByRole('button', { name: 'Confirm and add to Planner' }).click()
  await expect(review).toBeHidden()
  await expect(page.getByRole('button', { name: 'Added to Planner', exact: true })).toBeDisabled()
  expect(generates).toBe(2)
})


test('History fetches graphs for visible sessions and reuses them after filtering', async ({ page }) => {
  await fixtures(page)
  await page.setViewportSize({ width: 390, height: 844 })
  const calls: string[] = []
  const items = Array.from({ length: 100 }, (_, i) => ({
    id: `hr-test-${i}`, title: `HR practice ${i}`, created_at: Date.now() - i * 86400000,
    duration_s: 600, sets: [], hr: { attached: i !== 99, summary: { avgHr: 125, maxHr: 160 } }
  }))
  await page.route('**/api/completed-workouts', route => route.fulfill({ json: { items } }))
  await page.route('**/api/completed-workouts/*/hr?details=1', route => {
    calls.push(new URL(route.request().url()).pathname.split('/').at(-2)!)
    return route.fulfill({ json: { attached: true, summary: { avgHr: 125, maxHr: 160, samples: [{ t: 0, hr: 120 }, { t: 600, hr: 130 }] } } })
  })
  await page.goto('/history')
  await expect.poll(() => calls.length).toBeGreaterThan(0)
  expect(calls.length).toBeLessThan(6)
  expect(calls).not.toContain('hr-test-99')
  await page.getByRole('searchbox', { name: 'Search history' }).fill('HR practice 99')
  await expect(page.locator('article.card')).toHaveCount(1)
  await expect.poll(() => calls.includes('hr-test-99')).toBe(true)
  await page.getByRole('searchbox', { name: 'Search history' }).fill('HR practice 0')
  await expect(page.locator('#cw-hr-test-0')).toBeVisible()
  expect(calls.filter(id => id === 'hr-test-0')).toHaveLength(1)
})

test('a late program preview preserves edits made while it was loading', async ({ page }) => {
  await fixtures(page)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/program-runs/preview', async route => {
    const spec = route.request().postDataJSON().spec
    await gate
    await route.fulfill({ json: { spec, workouts: [{ title: 'Old preview', plannedMetrics: {} }] } })
  })
  await page.goto('/programs')
  await page.getByRole('button', { name: 'Create program', exact: true }).click()
  const requested = page.waitForRequest('**/api/program-runs/preview')
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await requested
  const title = page.getByRole('textbox', { name: 'Program title', exact: true })
  await title.fill('Keep my newer title')
  release()
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled()
  await expect(title).toHaveValue('Keep my newer title')
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
})

test('More remains inside a narrow viewport when its button wraps onto another line', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await fixtures(page)
  await page.goto('/workouts')
  const card = page.locator('article.card').first()
  await card.locator('.action-menu > summary').click()
  const menu = card.locator('.action-options')
  await expect(menu).toBeVisible()
  const bounds = (await menu.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(360)
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(640)
})

test('summary waits for confirmation, retains failed edits and retries without duplicate requests', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixtures(page)
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let saves = 0
  const payloads: any[] = []
  await page.route('**/api/completed-workouts', async route => {
    saves++
    payloads.push(route.request().postDataJSON())
    if (saves === 1) {
      await pending
      await route.fulfill({ status: 503, json: { error: 'Please try again.' } })
    } else {
      await route.fulfill({ json: { item: { id: 'confirmed-session' } } })
    }
  })
  await page.goto('/timer?workout=design-template')
  await page.locator('.status-actions').getByRole('button', { name: 'Summary', exact: true }).click()
  const summary = page.getByRole('dialog', { name: 'Workout summary', exact: true })
  const reps = summary.getByRole('spinbutton', { name: /^Logged reps:/ }).first()
  await reps.fill('27')
  await summary.getByRole('button', { name: 'Save session', exact: true }).click()
  await expect(summary.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled()
  await expect(reps).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(summary).toBeVisible()
  expect(saves).toBe(1)
  release()
  await expect(summary.getByRole('alert')).toContainText('Session not saved')
  await expect(reps).toHaveValue('27')
  await expect(reps).toBeEnabled()
  await page.setViewportSize({ width: 390, height: 470 })
  await expect(summary.getByRole('button', { name: 'Retry save' })).toBeInViewport()
  await summary.getByRole('button', { name: 'Retry save' }).click()
  await expect(summary).toBeHidden()
  expect(saves).toBe(2)
  expect(payloads[0].entries).toEqual(payloads[1].entries)
  expect(payloads[1].entries[0].loggedReps).toBe(27)
  await expect(page.getByText('Session saved to History.', { exact: true })).toBeVisible()
})

async function openSettings(page: Page) {
  if (await page.getByRole('button', { name: 'Toggle navigation' }).isVisible()) {
    await page.getByRole('button', { name: 'Toggle navigation' }).click()
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'App settings', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 1000 }]) {
  test(`Settings preserves section drafts and applies them together at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await fixtures(page)
    await page.addInitScript(() => localStorage.setItem('gs_ai_timer_theme', 'dark'))
    const updates: any[] = []
    await page.route('**/api/settings', route => {
      if (route.request().method() === 'PUT') updates.push(route.request().postDataJSON())
      return route.fulfill({ json: {} })
    })
    await page.goto('/workouts')
    const settings = await openSettings(page)
    const section = async (id: string, label: string) => {
      const select = settings.getByRole('combobox', { name: 'Settings section' })
      if (await select.isVisible()) await select.selectOption(id)
      else await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: label, exact: true }).click()
      await expect(settings.getByRole('button', { name: 'Save settings' })).toBeInViewport()
      await noOverflow(page)
    }
    await section('counter', 'Rep counter')
    await settings.getByRole('checkbox', { name: 'Lower processing rate' }).check()
    await expect(settings.getByRole('spinbutton', { name: 'Swing apex height (torso multiples)' })).toBeHidden()
    await settings.locator('summary', { hasText: 'Advanced calibration' }).click()
    await settings.getByRole('spinbutton', { name: 'Swing apex height (torso multiples)' }).fill('0.55')
    await section('editor', 'Editor')
    await settings.getByRole('checkbox', { name: 'Vim keybindings' }).check()
    await section('workout', 'Workout & audio')
    await settings.getByRole('checkbox', { name: 'Audio cues enabled', exact: true }).uncheck()
    await section('appearance', 'Appearance')
    await settings.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light')
    // Section changes retain drafts without applying them to the app.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await section('counter', 'Rep counter')
    await expect(settings.getByRole('checkbox', { name: 'Lower processing rate' })).toBeChecked()
    await settings.locator('summary', { hasText: 'Advanced calibration' }).click()
    await expect(settings.getByRole('spinbutton', { name: 'Swing apex height (torso multiples)' })).toHaveValue('0.55')
    await page.screenshot({ path: `test-results/refinement-settings-${viewport.width}.png` })
    await settings.getByRole('button', { name: 'Save settings' }).click()
    await expect(settings).toBeHidden()
    await expect.poll(() => updates.length).toBe(1)
    expect(updates[0].settings).toMatchObject({ theme: 'light', counter: { lowFpsMode: true, swingApexHeight: 0.55 }, timer: { audioEnabled: false }, editor: { vimMode: true } })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await openSettings(page)
    await section('counter', 'Rep counter')
    await settings.getByRole('checkbox', { name: 'Lower processing rate' }).uncheck()
    await settings.getByRole('button', { name: 'Cancel', exact: true }).click()
    await openSettings(page)
    await expect(settings.getByRole('checkbox', { name: 'Lower processing rate' })).toBeChecked()
    expect(updates).toHaveLength(1)
  })
}

for (const view of ['List', 'Calendar']) {
  test(`History ${view} editing keeps compact fields, set operations and saved values intact`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await fixtures(page)
    await page.route('**/api/completed-workouts', route => route.fulfill({ json: { items: [{
      id: 'edit-log', title: 'Practice', started_at: Date.now(), created_at: Date.now(), duration_s: 480,
      notes: 'Original notes', tags: ['practice'], rpe: 6, sets: [
        { round_label: 'Main', set_label: 'Swings', reps: 20, weight: 16, duration_s: 120, rpe: 7, type: 'work' },
        { set_label: 'Rest', duration_s: 30, type: 'rest' },
        { round_label: 'Main', set_label: 'Presses', reps: 10, weight: 12, duration_s: 60, type: 'work' }
      ]
    }] } }))
    let saved: any
    let attempts = 0
    await page.route('**/api/completed-workouts/edit-log', route => {
      saved = route.request().postDataJSON()
      attempts++
      return route.fulfill(attempts === 1 ? { status: 503, json: { error: 'Try again shortly.' } } : { json: { ok: true } })
    })
    await page.goto('/history')
    if (view === 'Calendar') {
      await page.getByRole('button', { name: 'Calendar', exact: true }).click()
      await page.locator('.week-row').filter({ hasText: 'Practice' }).click()
    }
    const card = page.locator('#cw-edit-log')
    await card.getByRole('button', { name: 'Edit', exact: true }).click()
    const rows = card.locator('.set-editor')
    await expect(rows).toHaveCount(3)
    const first = rows.first()
    const reps = first.getByRole('spinbutton', { name: 'Reps', exact: true })
    const weight = first.getByRole('spinbutton', { name: 'Weight (kg / lb)', exact: true })
    expect(Math.abs((await reps.boundingBox())!.y - (await weight.boundingBox())!.y)).toBeLessThan(2)
    await expect(first.getByRole('textbox', { name: 'Set label', exact: true })).toBeHidden()
    await first.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `test-results/refinement-history-${view}-mobile.png` })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await noOverflow(page)
    await page.screenshot({ path: `test-results/refinement-history-${view}-desktop.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    await reps.fill('25')
    await weight.fill('20')
    await first.getByRole('button', { name: 'More details' }).click()
    await first.getByRole('spinbutton', { name: 'RPE', exact: true }).fill('8')
    await first.getByRole('button', { name: 'Copy set', exact: true }).click()
    await expect(rows).toHaveCount(4)
    // The original remains editable after copying; removal still asks for confirmation.
    await first.getByRole('button', { name: 'Delete set', exact: true }).click()
    await page.locator('.confirm-modal').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(rows).toHaveCount(4)
    await card.getByRole('button', { name: 'Add work set', exact: true }).scrollIntoViewIfNeeded()
    const bar = page.getByRole('region', { name: 'Save session changes' })
    await expect(bar.getByRole('button', { name: 'Save changes' })).toBeInViewport()
    await noOverflow(page)
    await bar.getByRole('button', { name: 'Save changes' }).click()
    await expect(bar.getByRole('alert')).toContainText('Your changes are still here')
    await expect(rows).toHaveCount(4)
    await bar.getByRole('button', { name: 'Retry save' }).click()
    await expect(bar).toBeHidden()
    expect(saved).toMatchObject({ notes: 'Original notes', rpe: 6, tags: ['practice'] })
    expect(saved.entries).toHaveLength(4)
    expect(saved.entries[0]).toMatchObject({ reps: 25, weight: 20, rpe: 8, duration_s: 120, round_label: 'Main', set_label: 'Swings' })
    expect(saved.entries[1]).toEqual(saved.entries[0])
    expect(saved.entries[2]).toMatchObject({ duration_s: 30, type: 'rest' })
  })
}
