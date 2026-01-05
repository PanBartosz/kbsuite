<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import {
    closeSettingsModal,
    settings,
    setSettings,
    setTimerSettings,
    setCounterSettings,
    setEditorSettings,
    settingsModalOpen,
    type ThemeOption
  } from '$lib/stores/settings'
  import { modal } from '$lib/actions/modal'
  import { getVoiceOptions } from '$lib/counter/audio/voicePack'
  import { defaultNotesTemplates, type NotesTemplate } from '$lib/notes/templates'

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

  const defaultCounter = {
    lowFpsMode: false,
    voiceEnabled: false,
    debugOverlay: false,
    voiceSelected: 'alloy',
    swingApexHeight: 0.4,
    swingResetHeight: -0.1,
    swingHingeExit: 150,
    swingMinRepMs: 400,
    lockoutLowBand: 0.25,
    lockoutHeadThresh: 0.5,
    lockoutHoldMs: 75,
    lockoutMinRepMs: 400
  }

  let localKey = ''
  let localPrompt = ''
  let localTheme: ThemeOption = 'dark'
  let localTimer = { ...($settings.timer ?? {}) }
  let localCounter = { ...defaultCounter, ...$settings.counter }
  let localEditor: { vimMode: boolean; notesTemplates: NotesTemplate[] } = {
    vimMode: false,
    notesTemplates: defaultNotesTemplates()
  }
  let templateSelectedId = 'kb_comp'
  let wasOpen = false

  const cloneTemplates = (templates: NotesTemplate[] = []): NotesTemplate[] =>
    templates.map((t) => ({ id: String(t.id ?? ''), label: String(t.label ?? ''), body: String(t.body ?? '') }))

  const pickValidTemplateId = (templates: NotesTemplate[], desired: string) => {
    const id = String(desired ?? '').trim()
    if (id && templates.some((t) => t.id === id)) return id
    return templates[0]?.id ?? 'kb_comp'
  }

  const createId = () => {
    try {
      const uuid = (globalThis as any)?.crypto?.randomUUID
      if (typeof uuid === 'function') return uuid.call((globalThis as any).crypto)
    } catch {
      // ignore
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  const snapshotFromStore = () => {
    localKey = ($settings.openAiKey ?? '').toString()
    localPrompt = (($settings.aiInsightsPrompt as string) ?? '').toString()
    localTheme = ($settings.theme as ThemeOption) ?? 'dark'
    localTimer = { ...($settings.timer ?? {}) }
    localCounter = { ...defaultCounter, ...($settings.counter ?? {}) }
    const storeEditor = ($settings.editor ?? {}) as any
    const templates = Array.isArray(storeEditor?.notesTemplates) && storeEditor.notesTemplates.length
      ? cloneTemplates(storeEditor.notesTemplates)
      : defaultNotesTemplates()
    localEditor = { vimMode: !!storeEditor?.vimMode, notesTemplates: templates }
    templateSelectedId = pickValidTemplateId(localEditor.notesTemplates, templateSelectedId)
  }

  $: if ($settingsModalOpen && !wasOpen) {
    snapshotFromStore()
    wasOpen = true
  } else if (!$settingsModalOpen && wasOpen) {
    wasOpen = false
  }

  const handleRestoreCounter = () => {
    localCounter = { ...defaultCounter }
  }

  let selectedTemplate: NotesTemplate | null = null
  $: selectedTemplate = localEditor.notesTemplates.find((t) => t.id === templateSelectedId) ?? null

  const updateSelectedTemplate = (patch: Partial<NotesTemplate>) => {
    const id = templateSelectedId
    localEditor = {
      ...localEditor,
      notesTemplates: localEditor.notesTemplates.map((t) => (t.id === id ? { ...t, ...patch } : t))
    }
  }

  const addNotesTemplate = () => {
    const id = `tmpl-${createId()}`
    const next: NotesTemplate = { id, label: 'New template', body: '' }
    localEditor = { ...localEditor, notesTemplates: [...localEditor.notesTemplates, next] }
    templateSelectedId = id
  }

  const deleteNotesTemplate = () => {
    if (!templateSelectedId) return
    if (localEditor.notesTemplates.length <= 1) return
    localEditor = { ...localEditor, notesTemplates: localEditor.notesTemplates.filter((t) => t.id !== templateSelectedId) }
    templateSelectedId = pickValidTemplateId(localEditor.notesTemplates, '')
  }

  const restoreDefaultTemplates = () => {
    localEditor = { ...localEditor, notesTemplates: defaultNotesTemplates() }
    templateSelectedId = pickValidTemplateId(localEditor.notesTemplates, 'kb_comp')
  }

  const handleSave = () => {
    let cleanedTemplates = cloneTemplates(localEditor.notesTemplates)
      .map((t) => ({ ...t, id: t.id.trim(), label: t.label.trim(), body: t.body ?? '' }))
      .filter((t) => t.id && t.label)
    if (!cleanedTemplates.length) cleanedTemplates = defaultNotesTemplates()
    setSettings({ openAiKey: localKey.trim(), aiInsightsPrompt: localPrompt.trim(), theme: localTheme })
    setTimerSettings({ ...localTimer })
    setCounterSettings({ ...localCounter })
    setEditorSettings({
      vimMode: !!localEditor.vimMode,
      notesTemplates: cleanedTemplates
    })
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
  <div class="modal" role="dialog" aria-label="App settings" use:modal={{ onClose: handleClose }}>
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

      <label>
        <span>AI insights prompt (stored on server)</span>
        <textarea
          rows="6"
          bind:value={localPrompt}
          placeholder="Base instructions sent when analyzing logged workouts (History)"
        ></textarea>
        <small>Used only for insights; workout generation keeps its built-in prompt.</small>
      </label>

      <div class="group">
        <p class="group__title">Editor settings</p>
        <label class="toggle">
          <input type="checkbox" bind:checked={localEditor.vimMode} />
          <span>Vim keybindings in editors (Markdown + YAML)</span>
        </label>

        <div class="templates">
          <div class="templates__head">
            <p class="templates__title">Workout Journal templates</p>
            <div class="templates__actions">
              <button class="ghost small" type="button" on:click={addNotesTemplate}>New</button>
              <button class="ghost small" type="button" on:click={restoreDefaultTemplates}>Restore defaults</button>
            </div>
          </div>
          <label>
            <span>Template</span>
            <select bind:value={templateSelectedId}>
              {#each localEditor.notesTemplates as tmpl}
                <option value={tmpl.id}>{tmpl.label}</option>
              {/each}
            </select>
          </label>
          {#if selectedTemplate}
            <label>
              <span>Name</span>
              <input
                type="text"
                value={selectedTemplate.label}
                on:input={(e) => updateSelectedTemplate({ label: e.currentTarget.value })}
              />
            </label>
            <label>
              <span>Body (Markdown)</span>
              <textarea
                rows="10"
                value={selectedTemplate.body}
                on:input={(e) => updateSelectedTemplate({ body: e.currentTarget.value })}
              ></textarea>
              <small>Used by History → Notes → “Insert template”.</small>
            </label>
            <div class="templates__actions-row">
              <button
                class="ghost small"
                type="button"
                disabled={localEditor.notesTemplates.length <= 1}
                on:click={deleteNotesTemplate}
              >
                Delete template
              </button>
            </div>
          {/if}
        </div>
      </div>

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
        <label class="toggle">
          <input type="checkbox" bind:checked={localTimer.autoOpenSummaryOnComplete} />
          <span>Auto-open summary when workout completes</span>
        </label>
      </div>

      <div class="group">
        <p class="group__title">Rep counter settings</p>
        <button class="ghost small" type="button" on:click={handleRestoreCounter}>Restore defaults</button>
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
        <div class="grid">
          <label>
            <span>Swing apex height (torso multiples)</span>
            <input type="number" step="0.01" min="0" bind:value={localCounter.swingApexHeight} />
          </label>
          <label>
            <span>Swing reset height (torso multiples)</span>
            <input type="number" step="0.01" bind:value={localCounter.swingResetHeight} />
          </label>
          <label>
            <span>Swing stand angle (degrees)</span>
            <input type="number" step="1" min="0" max="200" bind:value={localCounter.swingHingeExit} />
          </label>
          <label>
            <span>Swing min rep gap (ms)</span>
            <input type="number" step="10" min="0" bind:value={localCounter.swingMinRepMs} />
          </label>
          <label>
            <span>Lockout low band</span>
            <input type="number" step="0.01" min="0" bind:value={localCounter.lockoutLowBand} />
          </label>
          <label>
            <span>Lockout head threshold</span>
            <input type="number" step="0.01" min="0" bind:value={localCounter.lockoutHeadThresh} />
          </label>
          <label>
            <span>Lockout hold (ms)</span>
            <input type="number" step="10" min="0" bind:value={localCounter.lockoutHoldMs} />
          </label>
          <label>
            <span>Lockout min rep gap (ms)</span>
            <input type="number" step="10" min="0" bind:value={localCounter.lockoutMinRepMs} />
          </label>
        </div>
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
    max-height: 90vh;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 1rem;
    z-index: 501;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    overflow: hidden;
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
    overflow-y: auto;
    padding-right: 0.25rem;
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
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.5rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    color: var(--color-text-primary);
  }
  select,
  input,
  textarea {
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.75rem 0.9rem;
    font-size: 1rem;
  }
  textarea {
    min-height: 140px;
    resize: vertical;
    line-height: 1.4;
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
  button.small {
    padding: 0.45rem 0.7rem;
    font-size: 0.9rem;
  }
  .ghost {
    background: transparent;
  }
  .primary {
    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
    color: var(--color-text-inverse);
    border: none;
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .templates {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.35rem;
  }
  .templates__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .templates__title {
    margin: 0;
    font-weight: 700;
    color: var(--color-text-primary);
  }
  .templates__actions {
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .templates__actions-row {
    display: flex;
    justify-content: flex-end;
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
