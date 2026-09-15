import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
const installedBrowser = '/opt/brave.com/brave/brave'
const port = Number(process.env.KB_BROWSER_PORT || 4173)
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    serviceWorkers: 'block',
    launchOptions: {
      executablePath: process.env.KB_BROWSER_PATH || (existsSync(installedBrowser) ? installedBrowser : undefined),
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-dev-shm-usage']
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: {
    cwd: process.env.KB_PROFILE_SERVER_DIR,
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    env: { KB_SUITE_DATA_DIR: '/tmp/kb-suite-browser-tests' },
    port,
    reuseExistingServer: !process.env.CI
  }
})
