import { test, expect } from '@playwright/test'
// Opt-in: needs network access to download the existing MoveNet/WASM assets.
test('real detector initializes and consumes fake camera frames', async ({ page }) => {
  test.skip(process.env.KB_REAL_POSE !== '1', 'Set KB_REAL_POSE=1 for the real model smoke test')
  test.setTimeout(90000)
  await page.goto('/counter')
  await page.locator('.diagnostics > summary').click()
  await page.locator('.controls').getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.locator('.camera-status').filter({ hasText: 'Preparing counter' })).toBeHidden({ timeout: 65000 })
  await expect(page.getByRole('button', { name: 'Retry camera', exact: true })).toHaveCount(0)
  await expect.poll(() => page.locator('.stats').first().innerText(), { timeout: 15000 }).toMatch(/webgpu|webgl|wasm/)
  await page.waitForTimeout(2000)
  await expect(page.getByRole('button', { name: 'Retry camera', exact: true })).toHaveCount(0)
})
