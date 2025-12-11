import { browser } from '$app/environment'
import { writable } from 'svelte/store'
import { defaultInsightsPrompt } from '$lib/ai/prompts'

export type ThemeOption = 'dark' | 'light' | 'vibrant' | 'neon' | 'midnight' | 'sand'

interface SettingsState {
  theme: ThemeOption
  openAiKey: string
  aiInsightsPrompt: string
  timer: {
    ttsEnabled: boolean
    enableMetronome: boolean
    notificationsEnabled: boolean
    audioEnabled: boolean
    openAiVoice: string
  }
  counter: {
    lowFpsMode: boolean
    voiceEnabled: boolean
    debugOverlay: boolean
    voiceSelected: string
    swingApexHeight: number
    swingResetHeight: number
    swingHingeExit: number
    swingMinRepMs: number
    lockoutLowBand: number
    lockoutHeadThresh: number
    lockoutHoldMs: number
    lockoutMinRepMs: number
  }
}

const themeKey = 'gs_ai_timer_theme'
const apiKeyKey = 'gs_ai_timer_openai_key'
const aiInsightsKey = 'gs_ai_timer_ai_insights_prompt'
const timerKey = 'gs_ai_timer_settings_timer'
const counterKey = 'gs_ai_timer_settings_counter'

const defaultTheme = (): ThemeOption => {
  if (!browser) return 'dark'
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light'
    }
  } catch {
    // ignore
  }
  return 'dark'
}

const defaultState = (): SettingsState => ({
  theme: 'dark',
  openAiKey: '',
  aiInsightsPrompt: defaultInsightsPrompt,
  timer: { ttsEnabled: false, enableMetronome: false, notificationsEnabled: false, audioEnabled: true, openAiVoice: 'alloy' },
  counter: {
    lowFpsMode: false,
    voiceEnabled: false,
    debugOverlay: false,
    voiceSelected: 'alloy',
    swingApexHeight: 1.29,
    swingResetHeight: 0.6,
    swingHingeExit: 150,
    swingMinRepMs: 400,
    lockoutLowBand: 0.28,
    lockoutHeadThresh: 0.5,
    lockoutHoldMs: 100,
    lockoutMinRepMs: 400
  }
})

const loadSettings = (): SettingsState => {
  if (!browser) return defaultState()
  try {
    const storedTheme = window.localStorage.getItem(themeKey)
    const theme =
      storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'vibrant'
        ? storedTheme
        : defaultTheme()
    const openAiKey = window.localStorage.getItem(apiKeyKey) ?? ''
    const aiInsightsPrompt =
      window.localStorage.getItem(aiInsightsKey) ??
      // backward compat with prior key, if present
      window.localStorage.getItem('gs_ai_timer_ai_prompt') ??
      defaultInsightsPrompt
    const timerRaw = window.localStorage.getItem(timerKey)
    const counterRaw = window.localStorage.getItem(counterKey)
    const timer = timerRaw
      ? { ...defaultState().timer, ...JSON.parse(timerRaw) }
      : { ...defaultState().timer }
    const counter = counterRaw
      ? { ...defaultState().counter, ...JSON.parse(counterRaw) }
      : { ...defaultState().counter }
    return { theme, openAiKey, aiInsightsPrompt, timer, counter }
  } catch {
    return defaultState()
  }
}

export const settings = writable<SettingsState>(loadSettings())

if (browser) {
  let initialized = false
  let saving = false

  const persistLocal = (value: SettingsState) => {
    try {
      window.localStorage.setItem(themeKey, value.theme)
      if (value.openAiKey) {
        window.localStorage.setItem(apiKeyKey, value.openAiKey)
      } else {
        window.localStorage.removeItem(apiKeyKey)
      }
      if (value.aiInsightsPrompt) {
        window.localStorage.setItem(aiInsightsKey, value.aiInsightsPrompt)
      } else {
        window.localStorage.removeItem(aiInsightsKey)
      }
      window.localStorage.setItem(timerKey, JSON.stringify(value.timer))
      window.localStorage.setItem(counterKey, JSON.stringify(value.counter))
      document.documentElement.setAttribute('data-theme', value.theme)
    } catch (err) {
      console.warn('Failed to persist settings', err)
    }
  }

  settings.subscribe((value) => {
    persistLocal(value)
    if (!initialized || saving) return
    const payload = { ...value, openAiKey: undefined }
    saving = true
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: payload })
    })
      .catch((err) => console.warn('Failed to persist settings to API', err))
      .finally(() => {
        saving = false
      })
  })

  // Load server settings and merge (keeping local API key)
  fetch('/api/settings')
    .then((res) => res.ok ? res.json() : null)
    .then((data) => {
      if (data?.settings) {
        settings.update((current) => {
          const server = data.settings ?? {}
          return {
            ...server,
            ...current,
            timer: { ...(server.timer ?? {}), ...(current.timer ?? {}) },
            counter: { ...(server.counter ?? {}), ...(current.counter ?? {}) },
            openAiKey: current.openAiKey // keep local only
          }
        })
      }
    })
    .catch(() => {})
    .finally(() => {
      initialized = true
    })
}

export const setSettings = (patch: Partial<SettingsState>) =>
  settings.update((current) => ({ ...current, ...patch }))

export const setTimerSettings = (patch: Partial<SettingsState['timer']>) =>
  settings.update((current) => ({ ...current, timer: { ...current.timer, ...patch } }))

export const setCounterSettings = (patch: Partial<SettingsState['counter']>) =>
  settings.update((current) => ({ ...current, counter: { ...current.counter, ...patch } }))

export const settingsModalOpen = writable(false)
export const openSettingsModal = () => settingsModalOpen.set(true)
export const closeSettingsModal = () => settingsModalOpen.set(false)

export const restoreDefaultSettings = () => settings.set(defaultState())
