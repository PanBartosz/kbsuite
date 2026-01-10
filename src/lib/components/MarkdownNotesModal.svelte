<script lang="ts">
  import { createEventDispatcher, onDestroy, tick } from 'svelte'
  import { browser } from '$app/environment'
  import { modal } from '$lib/actions/modal'
  import { renderMarkdownToHtml } from '$lib/markdown/render'
  import { settings, openSettingsModal } from '$lib/stores/settings'
  import { defaultNotesTemplates, type NotesTemplate } from '$lib/notes/templates'

  export let open = false
  export let title = 'Notes'
  export let subtitle = ''
  export let value = ''
  export let statsMarkdown = ''
  export let saveDisabled = false
  export let saving = false
  export let saveStatus = ''
  export let saveError = ''

  const dispatch = createEventDispatcher()

  let viewMode: 'split' | 'edit' | 'preview' = 'split'
  let vimEnabled = false
  let templates: NotesTemplate[] = defaultNotesTemplates()
  let templateId = 'kb_comp'

  let monacoContainer: HTMLDivElement | null = null
  let vimStatusEl: HTMLDivElement | null = null
  let editor: any = null
  let monacoModel: any = null
  let monacoReady = false
  let monacoError: string | null = null
  let disposeFns: (() => void)[] = []
  let vimMode: any = null
  let vimInitSeq = 0
  let vimInitPromise: Promise<void> | null = null
  let lastEmitted = value ?? ''
  let previewHtml = ''

  $: vimEnabled = $settings.editor?.vimMode ?? false
  $: templates =
    Array.isArray($settings.editor?.notesTemplates) && $settings.editor.notesTemplates.length
      ? $settings.editor.notesTemplates
      : defaultNotesTemplates()
  $: if (templates.length && !templates.some((t) => t.id === templateId)) {
    templateId = templates[0]?.id ?? 'kb_comp'
  }

  const close = () => dispatch('close')
  const currentValue = () => monacoModel?.getValue?.() ?? value ?? ''
  const save = () => dispatch('save', currentValue())

  const destroyMonaco = () => {
    disposeFns.forEach((fn) => {
      try {
        fn()
      } catch {
        // ignore
      }
    })
    disposeFns = []
    vimInitSeq += 1
    vimInitPromise = null
    if (vimMode?.dispose) vimMode.dispose()
    vimMode = null
    if (vimStatusEl) vimStatusEl.textContent = ''
    if (editor?.dispose) editor.dispose()
    if (monacoModel?.dispose) monacoModel.dispose()
    editor = null
    monacoModel = null
    monacoReady = false
  }

  const emitValue = () => {
    const next = monacoModel?.getValue?.() ?? value ?? ''
    if (next === lastEmitted) return
    lastEmitted = next
    dispatch('valueChange', next)
  }

  const insertText = async (text: string) => {
    if (editor?.executeEdits && monacoModel) {
      const selection = editor.getSelection?.()
      if (!selection) {
        dispatch('valueChange', `${value ?? ''}${text}`)
        await tick()
        return
      }
      editor.executeEdits('kb-notes', [
        {
          range: selection,
          text,
          forceMoveMarkers: true
        }
      ])
      editor.focus()
      emitValue()
      return
    }
    dispatch('valueChange', `${value ?? ''}${text}`)
    await tick()
  }

  const wrapSelection = async (before: string, after: string) => {
    if (editor?.executeEdits && monacoModel) {
      const selection = editor.getSelection?.()
      if (!selection) {
        dispatch('valueChange', `${value ?? ''}${before}${after}`)
        await tick()
        return
      }
      const selected = selection ? monacoModel.getValueInRange(selection) : ''
      const text = `${before}${selected || ''}${after}`
      editor.executeEdits('kb-notes', [{ range: selection, text, forceMoveMarkers: true }])
      editor.focus()
      emitValue()
      return
    }
    dispatch('valueChange', `${before}${value ?? ''}${after}`)
    await tick()
  }

  const insertTemplate = async () => {
    const tmpl = templates.find((t) => t.id === templateId)?.body ?? ''
    if (!tmpl) return
    const prefix = value?.trim() ? '\n\n' : ''
    await insertText(prefix + tmpl)
  }

  const insertSnapshot = async () => {
    const snap = (statsMarkdown || '').trim()
    if (!snap) return
    const prefix = value?.trim() ? '\n\n' : ''
    await insertText(prefix + snap + '\n')
  }

  const initVim = async () => {
    if (!vimEnabled) return
    if (!editor || !vimStatusEl || vimMode) return
    if (vimInitPromise) return
    const seq = ++vimInitSeq
    try {
      vimInitPromise = import('monaco-vim').then((mod: any) => {
        if (seq !== vimInitSeq) return
        if (!vimEnabled) return
        if (!editor || !vimStatusEl || vimMode) return
        if (typeof mod?.initVimMode !== 'function') return
        vimStatusEl.textContent = ''
        vimMode = mod.initVimMode(editor, vimStatusEl)
      })
      await vimInitPromise
    } catch {
      // ignore
    } finally {
      if (seq === vimInitSeq) vimInitPromise = null
    }
  }

  const syncVim = () => {
    if (vimEnabled) {
      initVim()
      return
    }
    vimInitSeq += 1
    vimInitPromise = null
    if (vimMode?.dispose) vimMode.dispose()
    vimMode = null
    if (vimStatusEl) vimStatusEl.textContent = ''
  }

  const initMonaco = async () => {
    if (!browser) return
    try {
      monacoError = null
      await tick()
      if (!monacoContainer) throw new Error('Editor container not ready')
      // @ts-ignore
      const monacoModule = await import('monaco-editor/esm/vs/editor/editor.api')
      // @ts-ignore
      await import('monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution')
      const monacoEditor: any = (monacoModule as any).editor
      // Provide a noop worker resolver to silence Monaco's worker warning (we run without workers)
      if (typeof self !== 'undefined' && !(self as any).MonacoEnvironment) {
        ;(self as any).MonacoEnvironment = {
          getWorkerUrl: () =>
            'data:text/javascript;charset=utf-8,' + encodeURIComponent('self.onmessage = () => self.close();')
        }
      }
      const Uri: any = (monacoModule as any).Uri
      const modelUri = Uri.parse('file:///notes.md')
      monacoModel = monacoEditor.createModel(value ?? '', 'markdown', modelUri)
      monacoEditor.setModelLanguage(monacoModel, 'markdown')

      const prefersLight = document.documentElement.getAttribute('data-theme') === 'light'
      monacoEditor.defineTheme('kb-theme', {
        base: prefersLight ? 'vs' : 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': prefersLight ? '#f8fafc' : '#0d1628',
          'editor.foreground': prefersLight ? '#0f172a' : '#e2e8f0',
          'editorLineNumber.foreground': prefersLight ? '#94a3b8' : '#475569',
          'editorCursor.foreground': prefersLight ? '#0f172a' : '#e2e8f0',
          'editor.selectionBackground': prefersLight ? '#cbd5e1' : '#1f2937'
        }
      })

      editor = monacoEditor.create(monacoContainer!, {
        model: monacoModel,
        language: 'markdown',
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: 'on',
        wordWrap: 'on',
        automaticLayout: true,
        scrollBeyondLastLine: false,
        theme: 'kb-theme',
        quickSuggestions: false
      })

      lastEmitted = value ?? ''
      const d1 = monacoModel.onDidChangeContent(() => emitValue())
      disposeFns = [d1.dispose.bind(d1)].filter(Boolean)
      monacoReady = true
      monacoError = null
      setTimeout(() => editor?.focus?.(), 0)
      syncVim()
    } catch (error) {
      const err: any = error
      console.warn('Failed to init Monaco markdown editor', err)
      monacoError = err?.message ?? 'Failed to load editor'
      monacoReady = false
      destroyMonaco()
    }
  }

  const ensureOpen = () => {
    if (!open) return
    if (browser) {
      viewMode = window.innerWidth <= 860 ? 'edit' : 'split'
    }
    initMonaco()
  }

  $: if (open) {
    ensureOpen()
  } else {
    destroyMonaco()
  }

  $: if (monacoReady && monacoModel) {
    const current = monacoModel.getValue()
    if (value !== current) {
      monacoModel.setValue(value ?? '')
      lastEmitted = value ?? ''
    }
  }

  $: if (open) {
    vimEnabled && vimEnabled
    syncVim()
  }

  $: previewHtml = (value ?? '').trim() ? renderMarkdownToHtml(value) : ''

  onDestroy(() => {
    destroyMonaco()
  })
</script>

{#if open}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="0"
    aria-label="Close modal"
    on:click={close}
    on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && close()}
  ></div>
  <div
    class="notes-modal"
    use:modal={{ onClose: close, closeOnEscape: !vimEnabled, initialFocus: '.notes-modal__close' }}
  >
    <header class="notes-head">
      <div>
        <p class="eyebrow">Workout Journal</p>
        <h3>{title}</h3>
        {#if subtitle}<p class="muted tiny">{subtitle}</p>{/if}
      </div>
      <div class="notes-head__actions">
        {#if vimEnabled}
          <span class="vim-pill muted tiny" title="Vim keybindings enabled in Settings">Vim</span>
        {/if}
        <button class="ghost small" type="button" on:click={openSettingsModal}>Settings</button>
        <button class="ghost small notes-modal__close" type="button" on:click={close} aria-label="Close">✕</button>
      </div>
    </header>

    <div class="toolbar">
      <div class="toolbar-group">
        <button class="ghost small" type="button" title="Bold" on:click={() => wrapSelection('**', '**')}>
          <strong>B</strong>
        </button>
        <button class="ghost small" type="button" title="Italic" on:click={() => wrapSelection('*', '*')}>
          <em>I</em>
        </button>
        <button class="ghost small" type="button" title="Code" on:click={() => wrapSelection('`', '`')}>Code</button>
        <button class="ghost small" type="button" title="Quote" on:click={() => insertText('\n> ')}>Quote</button>
        <button class="ghost small" type="button" title="Task" on:click={() => insertText('\n- [ ] ')}>Task</button>
      </div>
      <div class="toolbar-group">
        <select class="compact" bind:value={templateId}>
          {#each templates as tmpl}
            <option value={tmpl.id}>{tmpl.label}</option>
          {/each}
        </select>
        <button
          class="ghost small"
          type="button"
          on:click={insertTemplate}
          disabled={!templates.find((t) => t.id === templateId)?.body?.trim()}
        >
          Insert template
        </button>
        <button class="ghost small" type="button" on:click={insertSnapshot} disabled={!statsMarkdown.trim()}>
          Insert snapshot
        </button>
      </div>
      <div class="toolbar-group view-modes">
        <button class:active={viewMode === 'edit'} class="ghost small" type="button" on:click={() => (viewMode = 'edit')}>
          Edit
        </button>
        <button
          class:active={viewMode === 'split'}
          class="ghost small"
          type="button"
          on:click={() => (viewMode = 'split')}
        >
          Split
        </button>
        <button
          class:active={viewMode === 'preview'}
          class="ghost small"
          type="button"
          on:click={() => (viewMode = 'preview')}
        >
          Preview
        </button>
      </div>
    </div>

    <div class="panes" class:panes--split={viewMode === 'split'}>
      <div class="pane pane--editor" class:hidden={viewMode === 'preview'}>
        <div class="editor-shell">
          <div class="monaco" hidden={!monacoReady} bind:this={monacoContainer}></div>
          {#if !monacoReady}
            <div class="editor-fallback">
              {#if monacoError}
                <p class="error small">Editor fallback: {monacoError}</p>
              {:else}
                <p class="muted small">Loading editor…</p>
              {/if}
              <textarea
                rows="12"
                value={value}
                placeholder="Write your session notes in Markdown…"
                on:input={(e) => dispatch('valueChange', e.currentTarget.value)}
              ></textarea>
            </div>
          {/if}
        </div>
        <div class="vim-status" bind:this={vimStatusEl}></div>
      </div>

      <div class="pane pane--preview" class:hidden={viewMode === 'edit'}>
        <div class="preview markdown">
          {#if previewHtml}
            {@html previewHtml}
          {:else}
            <p class="muted small">No notes yet.</p>
          {/if}
        </div>
      </div>
    </div>

    <footer class="notes-foot">
      <p class="muted tiny">{value.length} chars · Markdown</p>
      <div class="notes-foot__actions">
        <button class="primary" type="button" on:click={save} disabled={saving || saveDisabled}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button class="ghost" type="button" on:click={close}>Close</button>
        {#if saveStatus}<span class="muted tiny">{saveStatus}</span>{/if}
        {#if saveError}<span class="error tiny">{saveError}</span>{/if}
      </div>
    </footer>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--color-surface-1) 60%, transparent);
    backdrop-filter: blur(6px);
    z-index: 500;
  }

  .notes-modal {
    position: fixed;
    z-index: 505;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(1100px, 96vw);
    height: min(92vh, 900px);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
  }

  @media (max-width: 640px) {
    .notes-modal {
      width: 100vw;
      height: 100vh;
      border-radius: 0;
      top: 0;
      left: 0;
      transform: none;
    }
  }

  .notes-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
  }

	  .notes-head__actions {
	    display: flex;
	    align-items: center;
	    gap: 0.4rem;
	  }

	  button {
	    padding: 0.55rem 0.8rem;
	    border-radius: 10px;
	    border: 1px solid var(--color-border);
	    background: var(--color-surface-1);
	    color: var(--color-text-primary);
	    cursor: pointer;
	  }

	  button.ghost {
	    background: transparent;
	  }

	  button.primary {
	    background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover));
	    color: var(--color-text-inverse);
	    border: none;
	  }

	  button.small {
	    padding: 0.4rem 0.55rem;
	    font-size: 0.9rem;
	  }

	  button:disabled {
	    opacity: 0.55;
	    cursor: not-allowed;
	  }

	  .vim-pill {
	    display: inline-flex;
	    align-items: center;
	    padding: 0.25rem 0.45rem;
	    border-radius: 999px;
	    border: 1px solid var(--color-border);
	    background: color-mix(in srgb, var(--color-surface-1) 70%, transparent);
	    user-select: none;
	  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    justify-content: space-between;
  }

  .toolbar-group {
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .view-modes button.active {
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
  }

  select.compact {
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.4rem 0.55rem;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }

  .panes {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
    min-height: 0;
  }

  .panes.panes--split {
    grid-template-columns: 1fr 1fr;
  }

  @media (max-width: 860px) {
    .panes.panes--split {
      grid-template-columns: 1fr;
    }
  }

  .pane {
    border: 1px solid var(--color-border);
    border-radius: 14px;
    background: var(--color-surface-1);
    overflow: hidden;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .pane.hidden {
    display: none;
  }

  .editor-shell {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .monaco {
    position: absolute;
    inset: 0;
  }

  .editor-fallback {
    position: absolute;
    inset: 0;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .editor-fallback textarea {
    flex: 1;
    width: 100%;
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: 0.6rem 0.7rem;
    resize: none;
  }

  .vim-status {
    padding: 0.35rem 0.55rem;
    border-top: 1px solid var(--color-border);
    font-size: 0.85rem;
    color: var(--color-text-muted);
    min-height: 1.6rem;
  }

  .preview {
    padding: 0.85rem 0.95rem;
    overflow: auto;
    line-height: 1.4;
  }

  .preview.markdown :global(h1),
  .preview.markdown :global(h2),
  .preview.markdown :global(h3) {
    margin: 0.8rem 0 0.4rem;
  }

  .preview.markdown :global(p) {
    margin: 0.4rem 0;
  }

  .preview.markdown :global(ul),
  .preview.markdown :global(ol) {
    margin: 0.4rem 0 0.6rem;
    padding-left: 1.25rem;
  }

  .preview.markdown :global(li) {
    margin: 0.2rem 0;
  }

  .preview.markdown :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 0.92em;
    background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
    padding: 0.1rem 0.35rem;
    border-radius: 8px;
  }

  .preview.markdown :global(pre) {
    background: color-mix(in srgb, var(--color-surface-2) 85%, transparent);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 0.65rem 0.75rem;
    overflow: auto;
  }

  .preview.markdown :global(pre code) {
    background: transparent;
    border: none;
    padding: 0;
  }

  .preview.markdown :global(blockquote) {
    margin: 0.6rem 0;
    border-left: 3px solid color-mix(in srgb, var(--color-accent) 55%, var(--color-border));
    padding-left: 0.7rem;
    opacity: 0.95;
  }

  .preview.markdown :global(a) {
    color: var(--color-accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .preview.markdown :global(table) {
    border-collapse: collapse;
    margin: 0.6rem 0;
    width: 100%;
    font-size: 0.95rem;
  }

  .preview.markdown :global(th),
  .preview.markdown :global(td) {
    border: 1px solid var(--color-border);
    padding: 0.35rem 0.5rem;
  }

	  .notes-foot {
	    display: flex;
	    align-items: center;
	    justify-content: space-between;
	    gap: 0.75rem;
	  }

	  .notes-foot__actions {
	    display: inline-flex;
	    align-items: center;
	    gap: 0.5rem;
	    flex-wrap: wrap;
	    justify-content: flex-end;
	  }

	  .error {
	    color: var(--color-danger);
	  }
	</style>
