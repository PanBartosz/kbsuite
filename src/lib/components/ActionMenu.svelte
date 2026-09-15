<script lang="ts">
  import { onMount } from 'svelte'

  export let label = 'More'
  export let context = ''
  let disclosure: HTMLDetailsElement
  let trigger: HTMLElement
  let options: HTMLDivElement

  const positionOptions = () => {
    if (!disclosure?.open || !options) return
    const anchor = disclosure.getBoundingClientRect()
    const width = options.getBoundingClientRect().width
    const height = Math.min(options.scrollHeight, window.innerHeight * 0.55)
    const below = window.innerHeight - anchor.bottom - 12
    const above = anchor.top - 12
    const openAbove = below < height && above > below
    const available = Math.max(44, openAbove ? above : below)
    const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))
    options.style.left = `${left - anchor.left}px`
    options.style.top = `${openAbove ? -Math.min(height, available) - 6 : anchor.height + 6}px`
    options.style.maxHeight = `${Math.min(height, available)}px`
  }

  const close = (restoreFocus = false) => {
    if (!disclosure?.open) return
    disclosure.open = false
    if (restoreFocus) trigger?.focus()
  }

  onMount(() => {
    const outside = (event: PointerEvent) => {
      if (!disclosure.contains(event.target as Node)) close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && disclosure.open) {
        event.preventDefault()
        close(true)
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('scroll', positionOptions, true)
    window.addEventListener('resize', positionOptions)
    disclosure.addEventListener('toggle', positionOptions)
    disclosure.addEventListener('keydown', escape)
    disclosure.addEventListener('click', select)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('scroll', positionOptions, true)
      window.removeEventListener('resize', positionOptions)
      disclosure.removeEventListener('toggle', positionOptions)
      disclosure.removeEventListener('keydown', escape)
      disclosure.removeEventListener('click', select)
    }
  })

  const select = (event: MouseEvent) => {
    const action = (event.target as HTMLElement).closest('button, a')
    if (action && !action.hasAttribute('disabled')) close(true)
  }
</script>

<details class="action-menu" bind:this={disclosure}>
  <summary bind:this={trigger} aria-label={context ? `${label}: ${context}` : label}>
    {label}<span aria-hidden="true">⌄</span>
  </summary>
  <div class="action-options" bind:this={options} role="group" aria-label={context ? `Actions: ${context}` : 'More actions'}>
    <slot />
  </div>
</details>

<style>
  .action-menu { position: relative; flex: 0 0 auto; }
  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
    min-height: 44px;
    padding: 0.55rem 0.8rem;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: 0.9rem;
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker { display: none; }
  summary:hover, details[open] summary { border-color: var(--color-border-hover); }
  .action-options {
    position: absolute;
    left: 0;
    top: calc(100% + 0.35rem);
    z-index: 8;
    width: 220px;
    max-width: calc(100vw - 2rem);
    max-height: 55dvh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.4rem;
    border: 1px solid var(--color-border-hover);
    border-radius: 12px;
    background: var(--color-surface-1);
    box-shadow: 0 10px 30px #0004;
  }
  .action-options :global(button), .action-options :global(a) {
    display: block;
    width: 100%;
    min-height: 44px;
    padding: 0.6rem 0.75rem;
    margin: 0;
    text-align: left;
    white-space: normal;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--color-text-primary);
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
  }
  .action-options :global(.danger) { color: var(--color-danger); }
  .action-options :global(button:hover), .action-options :global(a:hover) {
    background: var(--color-surface-3);
  }
  .action-options :global(button:disabled) { opacity: 0.5; cursor: not-allowed; }
</style>
