import { test, expect } from '@playwright/test'
test.use({ serviceWorkers: 'allow' })
test('optional audio is cached on use and remains available offline', async ({ page, context }) => {
  await page.goto('/timer')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBeTruthy()
  const voiceCount = await page.evaluate(async () => {
    const names = await caches.keys()
    const requests = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()))
    return requests.flat().filter((request) => /\/voices\/.*\.mp3$/.test(request.url)).length
  })
  expect(voiceCount).toBe(0)
  expect(await page.evaluate(async () => (await fetch('/voices/alloy/001.mp3')).ok)).toBeTruthy()
  await expect.poll(() => page.evaluate(async () => !!await caches.match('/voices/alloy/001.mp3'))).toBeTruthy()
  await context.setOffline(true)
  expect(await page.evaluate(async () => (await fetch('/voices/alloy/001.mp3', { cache: 'reload' })).ok)).toBeTruthy()
})
