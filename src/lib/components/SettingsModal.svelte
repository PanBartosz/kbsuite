<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import {
    closeSettingsModal,
    settings,
    setSettings,
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
  const sections = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'workout', label: 'Workout & audio' },
    { id: 'counter', label: 'Rep counter' },
    { id: 'editor', label: 'Editor' },
    { id: 'ai', label: 'AI' }
  ]
  let activeSection = 'appearance'
  let bodyEl: HTMLElement
  const selectSection = (section: string) => {
    activeSection = section
    if (bodyEl) bodyEl.scrollTop = 0
  }

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
    setSettings({
      openAiKey: localKey.trim(), aiInsightsPrompt: localPrompt.trim(), theme: localTheme,
      timer: { ...localTimer }, counter: { ...localCounter },
      editor: { vimMode: !!localEditor.vimMode, notesTemplates: cleanedTemplates }
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
  <div class="modal" role="dialog" aria-label="App settings" aria-modal="true" use:modal={{ onClose: handleClose }}>
    <header>
      <div>
        <p class="eyebrow">Preferences</p>
        <h2>App settings</h2>
      </div>
      <button class="ghost" on:click={handleClose} aria-label="Close settings">✕</button>
    </header>

    <label class="mobile-section">
      <span>Settings section</span>
      <select aria-label="Settings section" value={activeSection} on:change={(event) => selectSection(event.currentTarget.value)}>
        {#each sections as section}<option value={section.id}>{section.label}</option>{/each}
      </select>
    </label>
    <div class="settings-content">
      <nav class="section-nav" aria-label="Settings sections">
        {#each sections as section}
          <button type="button" class:active={activeSection === section.id}
            aria-pressed={activeSection === section.id} on:click={() => selectSection(section.id)}>
            {section.label}
          </button>
        {/each}
      </nav>
      <section class="body" bind:this={bodyEl} aria-label={sections.find(section => section.id === activeSection)?.label}>
        {#if activeSection === 'appearance'}
          <h3>Appearance</h3>
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

        {:else if activeSection === 'workout'}
      <div class="group">
        <h3 class="group__title">Workout & audio</h3>
        <label>
          <span>TTS voice</span>
          <select bind:value={localTimer.openAiVoice}>
            {#each timerVoiceOptions as voice}
              <option value={voice}>{voice}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Skip → Work delay (seconds)</span>
          <input type="number" min="0" step="1" bind:value={localTimer.skipDelaySeconds} />
          <small>Applies only when you press Skip and the next phase is Work. Can be overridden per-workout in YAML.</small>
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
        <label class="toggle">
          <input type="checkbox" bind:checked={localTimer.enableOverlayBigPictureFullscreen} />
          <span>Enable Big Picture overlay in fullscreen</span>
        </label>
      </div>

        {:else if activeSection === 'counter'}
      <div class="group">
        <h3 class="group__title">Rep counter</h3>
        <label class="toggle">
          <input type="checkbox" bind:checked={localCounter.lowFpsMode} />
          <span>Lower processing rate (10 frames/second)</span>
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
        <details class="advanced">
          <summary>Advanced calibration</summary>
          <p class="section-hint">Adjust how swings and lockouts are detected.</p>
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
          <button class="ghost small" type="button" on:click={handleRestoreCounter}>Restore counter defaults</button>
        </details>
      </div>
        {:else if activeSection === 'editor'}
      <div class="group">
        <h3 class="group__title">Editor</h3>
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

        {:else if activeSection === 'ai'}
          <h3>AI</h3>
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

        {/if}
      </section>
    </div>

    <footer>
      <span class="footer-hint">Changes apply when you save.</span>
      <button class="ghost" on:click={handleClose}>Cancel</button>
      <button class="primary" on:click={handleSave}>Save settings</button>
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
    width: min(860px, 94vw);
    height: min(680px, 90dvh);
    max-height: 90dvh;
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
    min-height: 0;
    min-width: 0;
    padding: 0.25rem 0.5rem 1rem;
  }
  .group {
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
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
    color: var(--color-on-accent);
    background: var(--color-accent);
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
  .settings-content { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 1.25rem; flex: 1; min-height: 0; }
  .section-nav { overflow-y: auto; min-height: 0; display: flex; flex-direction: column; gap: 0.35rem; padding-right: 0.75rem; border-right: 1px solid var(--color-border); }
  .section-nav button { text-align: left; border-color: transparent; }
  .section-nav button.active { background: var(--color-surface-1); border-color: var(--color-accent); font-weight: 700; }
  .mobile-section { display: none; }
  .advanced { border-top: 1px solid var(--color-border); padding-top: 0.65rem; }
  .advanced summary { cursor: pointer; min-height: 44px; align-content: center; font-weight: 600; }
  .advanced .grid { margin-top: 1rem; }
  .section-hint { color: var(--color-text-muted); font-size: 0.9rem; margin: 0 0 1rem; }
  .body h3, .group__title { margin: 0; font-size: 1.15rem; }
  header, footer, .mobile-section { flex-shrink: 0; }
  footer { border-top: 1px solid var(--color-border); padding-top: 0.75rem; align-items: center; }
  .footer-hint { margin-right: auto; font-size: 0.85rem; color: var(--color-text-muted); }
  button, select, input:not([type='checkbox']) { min-height: 44px; }
  .toggle { min-height: 44px; }
  .toggle input { width: 20px; height: 20px; flex-shrink: 0; accent-color: var(--color-accent); }
  label, input, select, textarea { min-width: 0; }
  @media (max-width: 720px), (max-height: 480px) and (max-width: 960px) {
    .modal { inset: 0; transform: none; width: 100%; height: 100dvh; max-height: 100dvh; border-radius: 0; border: 0; padding: max(0.85rem, env(safe-area-inset-top)) max(0.85rem, env(safe-area-inset-right)) max(0.85rem, env(safe-area-inset-bottom)) max(0.85rem, env(safe-area-inset-left)); }
    .settings-content { display: flex; flex-direction: column; gap: 0; }
    .section-nav { display: none; }
    .mobile-section { display: flex; gap: 0.25rem; }
    .mobile-section > span { color: var(--color-text-muted); font-size: 0.85rem; }
    .body { padding: 0.25rem 0 1rem; }
    .footer-hint { display: none; }
    footer .primary { flex: 1; }
    footer button { min-height: 48px; }
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-height: 480px) and (max-width: 960px) {
    .eyebrow, .mobile-section > span { display: none; }
    .modal { gap: 0.35rem; padding-block: 0.4rem; }
    footer { padding-top: 0.35rem; }
  }
</style>
