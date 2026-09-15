import { test } from '@playwright/test'
test('sustained synthetic camera profile', async () => {
  test.skip(process.env.KB_PROFILE !== '1', 'Run npm run profile:counter for a sustained profile')
  test.setTimeout((Number(process.env.KB_PROFILE_SECONDS || 60) + 120) * 1000)
  await import('../../scripts/profile-counter.mjs')
})
