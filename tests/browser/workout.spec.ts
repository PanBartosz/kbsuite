import { test, expect } from '@playwright/test'

const fakeWorker = `
let count = 0;
onmessage = async ({data}) => {
  if (data.type === 'init') { postMessage({type:'ready', backend:'test'}); return; }
  const {id, generation, capturedAt, image} = data;
  image.close();
  setTimeout(() => postMessage({type:'poses', id, generation, capturedAt, poses:[], inferenceMs:80}), 80);
};`

const workoutYaml = `title: Counter test
preStartSeconds: 0
defaultRepCounterMode: swing
enableRepCounter: work
enableModeChanging: false
rounds:
  - id: round
    label: Test
    sets:
      - id: set
        label: Swings
        workSeconds: 120
        restSeconds: 5
        repetitions: 2
`

async function loadWorkout(page: any) {
  await page.route('**/pose.worker-*.js', (route: any) => route.fulfill({ contentType: 'application/javascript', body: fakeWorker }))
  await page.route('**/api/workouts', (route: any) => route.fulfill({ json: { workouts: [{ id: 'counter-test', name: 'Counter test', yaml_source: workoutYaml }] } }))
  await page.goto('/big-picture?workout=counter-test')
  await expect(page.locator('.mobile-workout')).toBeVisible()
}

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 360, height: 640 }]) {
  test(`numbers and controls fit ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await loadWorkout(page)
    const panel = page.locator('.timer-panel')
    await expect(panel.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
    const dimensions = await panel.evaluate((element) => ({ width: element.scrollWidth, client: element.clientWidth }))
    expect(dimensions.width).toBeLessThanOrEqual(dimensions.client + 1)
    for (const selector of ['.timer-display__time', '.mobile-stats .rep-number', '.video-panel', '.control-bar']) {
      const rect = await panel.locator(selector).boundingBox()
      expect(rect).not.toBeNull()
      expect(rect!.width).toBeGreaterThan(0)
    }
    for (const button of await panel.locator('.control-bar button').all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48)
    }
    await page.screenshot({ path: `/tmp/kb-suite-normal-${viewport.width}x${viewport.height}.png` })
    for (const selector of ['.timer-display__current', '.video-panel', '.timer-display__next', '.control-bar']) {
      const rect = await panel.locator(selector).boundingBox()
      expect(rect!.y).toBeGreaterThanOrEqual(0)
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height + 1)
    }
    await panel.getByRole('button', { name: 'Enter fullscreen' }).click()
    await expect(panel).toHaveClass(/timer-panel--fullscreen/)
    const bottom = await panel.locator('.control-bar').boundingBox()
    expect(bottom!.y + bottom!.height).toBeLessThanOrEqual(viewport.height + 1)
    const preview = await panel.locator('.video-panel').boundingBox()
    const current = await panel.locator('.timer-display__current').boundingBox()
    expect(preview!.y >= current!.y + current!.height - 1 || preview!.x >= current!.x + current!.width - 1).toBeTruthy()
    await page.screenshot({ path: `/tmp/kb-suite-${viewport.width}x${viewport.height}.png` })
  })
}

test('camera survives pause, resize and fullscreen; stop releases tracks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loadWorkout(page)
  await page.evaluate(() => {
    (window as any).__cameraStarts = 0
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = (constraints) => {
      (window as any).__cameraStarts++
      return original(constraints)
    }
  })
  const controls = page.locator('.timer-panel .control-bar')
  await controls.getByRole('button', { name: 'Start', exact: true }).click()
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => !!video.srcObject)).toBeTruthy()
  await controls.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(controls.getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 844, height: 390 })
  await page.getByRole('button', { name: 'Enter fullscreen' }).click()
  await controls.getByRole('button', { name: 'Resume', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__cameraStarts)).toBe(1)
  await page.evaluate(() => { (window as any).__track = (document.querySelector('video')!.srcObject as MediaStream).getVideoTracks()[0] })
  await controls.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.locator('.confirm-modal').getByRole('button', { name: 'Stop', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__track.readyState)).toBe('ended')
})

test('late camera permission cannot reopen a stopped session', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loadWorkout(page)
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints)
      ;(window as any).__lateTrack = stream.getVideoTracks()[0]
      await new Promise<void>((resolve) => { (window as any).__grantCamera = resolve })
      return stream
    }
  })
  const controls = page.locator('.timer-panel .control-bar')
  await controls.getByRole('button', { name: 'Start', exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!(window as any).__grantCamera)).toBeTruthy()
  await controls.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.locator('.confirm-modal').getByRole('button', { name: 'Stop', exact: true }).click()
  await page.evaluate(() => (window as any).__grantCamera())
  await expect.poll(() => page.evaluate(() => (window as any).__lateTrack.readyState)).toBe('ended')
  expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.srcObject)).toBeNull()
})

test('permission failure leaves timer controls usable and offers retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loadWorkout(page)
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Camera permission denied', 'NotAllowedError') } })
  await page.locator('.control-bar').getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry camera', exact: true })).toBeVisible()
  await expect(page.locator('.control-bar').getByRole('button', { name: 'Pause', exact: true })).toBeEnabled()
})

test('inference has one active request and suspends on pause and visibility changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    const original = Worker.prototype.postMessage
    ;(window as any).__frames = []
    ;(window as any).__inFlight = 0
    ;(window as any).__maxInFlight = 0
    const watched = new WeakSet<Worker>()
    Worker.prototype.postMessage = function (message, transfer: any) {
      if (message.type === 'frame') {
        if (!watched.has(this)) {
          watched.add(this)
          this.addEventListener('message', ({ data }) => {
            if (data.type === 'poses') (window as any).__inFlight--
          })
        }
        ;(window as any).__frames.push({ id: message.id, generation: message.generation, width: message.image.width, height: message.image.height })
        ;(window as any).__inFlight++
        ;(window as any).__maxInFlight = Math.max((window as any).__maxInFlight, (window as any).__inFlight)
      }
      return original.call(this, message, transfer)
    }
  })
  await loadWorkout(page)
  const controls = page.locator('.timer-panel .control-bar')
  await controls.getByRole('button', { name: 'Start', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__frames.length)).toBeGreaterThan(3)
  expect(await page.evaluate(() => (window as any).__maxInFlight)).toBe(1)
  expect(await page.evaluate(() => (window as any).__frames.every((frame: any) => Math.max(frame.width, frame.height) <= 640))).toBeTruthy()
  await controls.getByRole('button', { name: 'Pause', exact: true }).click()
  const count = await page.evaluate(() => (window as any).__frames.length)
  await page.waitForTimeout(350)
  expect(await page.evaluate(() => (window as any).__frames.length)).toBe(count)
  await controls.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__frames.length)).toBeGreaterThan(count)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const hiddenCount = await page.evaluate(() => (window as any).__frames.length)
  await page.waitForTimeout(350)
  expect(await page.evaluate(() => (window as any).__frames.length)).toBe(hiddenCount)
  await expect(controls.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => page.evaluate(() => (window as any).__frames.length)).toBeGreaterThan(hiddenCount)
})

for (const theme of ['dark', 'light', 'vibrant', 'neon', 'midnight', 'sand']) {
  test(`long labels and enlarged text remain reachable in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 })
    await page.addInitScript((theme) => localStorage.setItem('gs_ai_timer_theme', theme), theme)
    await loadWorkout(page)
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '24px'
      document.querySelector('.timer-display__label')!.textContent = 'Long exercise description with multiple words and instructions'
    })
    await page.getByRole('button', { name: 'Enter fullscreen' }).click()
    await page.locator('.control-bar').getByRole('button', { name: 'Start', exact: true }).scrollIntoViewIfNeeded()
    await expect(page.locator('.control-bar').getByRole('button', { name: 'Start', exact: true })).toBeInViewport()
    const sizes = await page.locator('.timer-panel').evaluate((el) => ({ scroll: el.scrollWidth, width: el.clientWidth }))
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1)
  })
}

test('natural completion releases the camera', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loadWorkout(page)
  await page.locator('.workout-editor > summary').click()
  await page.locator('.config-editor textarea').fill(workoutYaml.replace('workSeconds: 120', 'workSeconds: 2').replace('restSeconds: 5', 'restSeconds: 0').replace('repetitions: 2', 'repetitions: 1'))
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await page.locator('.control-bar').getByRole('button', { name: 'Start', exact: true }).click()
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => !!video.srcObject)).toBeTruthy()
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.srcObject === null), { timeout: 8000 }).toBeTruthy()
})

test('counted reps survive pause and are logged to the correct phase on skip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loadWorkout(page)
  await page.route('**/pose.worker-*.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    let frame = 0;
    let generation = -1;
    onmessage = ({ data }) => {
      if (data.type === 'init') { postMessage({ type:'ready', backend:'test' }); return; }
      data.image.close();
      if (data.generation !== generation) { frame = 0; generation = data.generation; }
      const wristY = frame++ % 24 < 12 ? 300 : 40;
      const keypoints = [
        ['left_shoulder',80,100], ['right_shoulder',120,100],
        ['left_hip',80,200], ['right_hip',120,200],
        ['left_knee',80,300], ['right_knee',120,300],
        ['left_elbow',80,120], ['right_elbow',120,240],
        ['left_wrist',80,wristY], ['right_wrist',120,300], ['nose',100,60]
      ].map(([name,x,y]) => ({name,x,y,score:1}));
      setTimeout(() => postMessage({type:'poses', id:data.id, generation:data.generation,
        capturedAt:data.capturedAt, inferenceMs:60, poses:[{score:1,keypoints}]}), 60);
    }
  ` }))
  const controls = page.locator('.timer-panel .control-bar')
  await controls.getByRole('button', { name: 'Start', exact: true }).click()
  const reps = page.locator('.mobile-stats .rep-number')
  await expect(reps).toHaveText('2', { timeout: 12000 })
  await controls.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(reps).toHaveText('2')
  await controls.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(page.locator('.timer-panel__status-pill')).toContainText(/paused/i)
  await page.locator('.status-actions').getByRole('button', { name: 'Summary', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Workout summary' }).locator('input[type="number"]').first()).toHaveValue('2')
})
