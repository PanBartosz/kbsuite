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

for (const viewport of [{ width: 360, height: 640 }, { width: 844, height: 390 }, { width: 1440, height: 1000 }]) {
  test(`main screens fit ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await fixtures(page)
    for (const route of ['/', '/programs', '/plan', '/workouts', '/history', '/timer?workout=design-template']) {
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
  await expect(summary.getByRole('button', { name: 'Save', exact: true })).toBeInViewport()
  await noOverflow(page)
  const request = page.waitForRequest(req => req.url().endsWith('/api/completed-workouts') && req.method() === 'POST')
  await page.route('**/api/completed-workouts', route => route.fulfill({ json: { item: { id: 'design-saved' } } }))
  await summary.getByRole('button', { name: 'Save', exact: true }).click()
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
  await page.goto('/workouts')
  const button = page.locator('article.card button.primary').first()
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
    expect(ratio, theme).toBeGreaterThanOrEqual(4.5)
  }
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
