<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import {
    closeSettingsModal,
    settings,
    setSettings,
    setTimerSettings,
    setCounterSettings,
    settingsModalOpen,
    type ThemeOption
  } from '$lib/stores/settings'
  import { getVoiceOptions } from '$lib/counter/audio/voicePack'

  const dispatch = createEventDispatcher()

  const timerVoiceOptions = [
    'alloy',
    'echo',
    'fable',
    'onyx',
    'nova',
    'shimmer',
    'coral',
    'verse',
    'ballad',
    'ash',
    'sage',
    'marin',
    'cedar'
  ]
  const counterVoiceOptions = getVoiceOptions()

  let localKey = ''
  let localTheme: ThemeOption = 'dark'
  let localTimer = $settings.timer
  let localCounter = $settings.counter

  $: localKey = $settings.openAiKey ?? ''
  $: localTheme = ($settings.theme as ThemeOption) ?? 'dark'
  $: localTimer = $settings.timer
  $: localCounter = $settings.counter

  const handleSave = () => {
    setSettings({ openAiKey: localKey.trim(), theme: localTheme })
    setTimerSettings(localTimer)
    setCounterSettings(localCounter)
    closeSettingsModal()
    dispatch('saved')
  }

  const handleClose = () => {
    closeSettingsModal()
    dispatch('close')
  }
</script>

{#if $settingsModalOpen}
  <div
    class="backdrop"
    role="button"
    tabindex="0"
    on:click={handleClose}
    on:keydown={(event) => (event.key === 'Enter' || event.key === ' ') && handleClose()}
    aria-label="Close settings"
  ></div>
  <div class="modal" role="dialog" aria-label="App settings">
    <header>
      <div>
        <p class="eyebrow">Settings</p>
        <h2>Theme & API</h2>
      </div>
      <button class="ghost" on:click={handleClose} aria-label="Close settings">✕</button>
    </header>

    <section class="body">
      <label>
        <span>Theme</span>
        <select bind:value={localTheme}>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="vibrant">Vibrant green</option>
          <option value="neon">Neon Pulse</option>
          <option value="midnight">Midnight Blue</option>
          <option value="sand">Sundown Sand</option>
        </select>
      </label>

      <label>
        <span>OpenAI API key</span>
        <input
          type="password"
          placeholder="sk-..."
          bind:value={localKey}
          autocomplete="off"
        />
        <small>Stored locally in your browser only. Required for AI generation and TTS.</small>
      </label>

      <div class="group">
        <p class="group__title">Timer settings</p>
        <label>
          <span>TTS voice</span>
          <select bind:value={localTimer.openAiVoice}>
            {#each timerVoiceOptions as voice}
              <option value={voice}>{voice}</option>
            {/each}
          </select>
        </label>
        <label class="toggle">
          <input type="checkbox" bind:checked={localTimer.audioEnabled} />
          <span>Audio cues enabled</span>
        </label>
        <label class="toggle">
          <input type="checkbox" bind:checked={localTimer.notificationsEnabled} />
          <span>Notifications enabled</span>
        </label>
        <label class="toggle">
          <input type="checkbox" bind:checked={localTimer.enableMetronome} />
          <span>Metronome on work phases</span>
        </label>
        <label class="toggle">
          <input type="checkbox" bind:checked={localTimer.ttsEnabled} />
          <span>Text-to-speech announcements</span>
        </label>
      </div>

      <div class="group">
        <p class="group__title">Rep counter settings</p>
        <label class="toggle">
          <input type="checkbox" bind:checked={localCounter.lowFpsMode} />
          <span>Low-FPS mode (~10 FPS)</span>
        </label>
        <label class="toggle">
          <input type="checkbox" bind:checked={localCounter.voiceEnabled} />
          <span>Voice count</span>
        </label>
        <label>
          <span>Voice pack</span>
          <select bind:value={localCounter.voiceSelected} disabled={!localCounter.voiceEnabled}>
            {#each counterVoiceOptions as opt}
              <option value={opt.id}>{opt.label}</option>
            {/each}
          </select>
        </label>
        <label class="toggle">
          <input type="checkbox" bind:checked={localCounter.debugOverlay} />
          <span>Debug overlay</span>
        </label>
      </div>
    </section>

    <footer>
      <button class="ghost" on:click={handleClose}>Cancel</button>
      <button class="primary" on:click={handleSave}>Save</button>
    </footer>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(5, 9, 20, 0.55);
    backdrop-filter: blur(6px);
    z-index: 500;
  }
  .modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    min-width: min(520px, 94vw);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 1rem;
    z-index: 501;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  h2 {
    margin: 0;
    color: var(--color-text-primary);
  }
  .eyebrow {
    margin: 0;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 0.75rem;
    color: var(--color-accent-soft);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .group {
    margin-top: 0.5rem;
    padding: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-surface-2) 92%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .group__title {
    margin: 0;
    font-weight: 700;
    color: var(--color-text-primary);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    color: var(--color-text-primary);
  }
  select,
  input {
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.75rem 0.9rem;
    font-size: 1rem;
  }
  small {
    color: var(--color-text-muted);
  }
  .toggle {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  button {
    padding: 0.75rem 1rem;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    cursor: pointer;
  }
  .ghost {
    background: transparent;
  }
  .primary {
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
    color: var(--color-text-inverse);
    border: none;
  }
  @media (max-width: 720px) {
    .modal {
      width: 95vw;
      max-height: 90vh;
      padding: 0.85rem;
      overflow-y: auto;
    }
  }
</style>
