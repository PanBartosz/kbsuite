import { browser } from '$app/environment'

export type ModalBehaviorOptions = {
  onClose?: () => void
  closeOnEscape?: boolean
  trapFocus?: boolean
  restoreFocus?: boolean
  initialFocus?: 'first' | 'container' | string
}

type ModalEntry = {
  id: string
  onClose?: () => void
  closeOnEscape: boolean
}

let openCount = 0
let stack: ModalEntry[] = []
let escapeListenerAttached = false

const createId = () => {
  const randomUuid = (globalThis as any)?.crypto?.randomUUID
  if (typeof randomUuid === 'function') return randomUuid.call((globalThis as any).crypto)
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const syncBodyScrollLock = () => {
  if (!browser) return
  document.body.classList.toggle('modal-open', openCount > 0)
}

const getFocusable = (root: HTMLElement) => {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',')
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => {
    const style = window.getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden'
  })
}

const handleEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  const top = [...stack].reverse().find((entry) => entry.closeOnEscape && entry.onClose)
  if (!top?.onClose) return
  event.preventDefault()
  top.onClose()
}

const ensureEscapeListener = () => {
  if (!browser || escapeListenerAttached) return
  window.addEventListener('keydown', handleEscape, true)
  escapeListenerAttached = true
}

const maybeRemoveEscapeListener = () => {
  if (!browser || !escapeListenerAttached) return
  if (openCount > 0) return
  window.removeEventListener('keydown', handleEscape, true)
  escapeListenerAttached = false
}

export const modal = (node: HTMLElement, opts: ModalBehaviorOptions = {}) => {
  if (!browser) return {}

  const id = createId()
  let options = { ...opts }
  const entry: ModalEntry = {
    id,
    onClose: options.onClose,
    closeOnEscape: options.closeOnEscape !== false
  }

  openCount += 1
  stack = [...stack, entry]
  syncBodyScrollLock()
  ensureEscapeListener()

  const previousActive = document.activeElement as HTMLElement | null
  const wantsFocusTrap = options.trapFocus !== false
  const wantsRestore = options.restoreFocus !== false

  const focusContainer = () => {
    if (document.activeElement && node.contains(document.activeElement)) return
    const desired = options.initialFocus ?? 'first'
    if (desired !== 'container') {
      if (typeof desired === 'string' && desired !== 'first') {
        const target = node.querySelector<HTMLElement>(desired)
        if (target) {
          target.focus()
          return
        }
      }
      const focusables = getFocusable(node)
      if (focusables[0]) {
        focusables[0].focus()
        return
      }
    }
    if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1')
    node.focus()
  }

  const handleTabTrap = (event: KeyboardEvent) => {
    if (!wantsFocusTrap) return
    if (event.key !== 'Tab') return
    const focusables = getFocusable(node)
    if (!focusables.length) {
      event.preventDefault()
      focusContainer()
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement as HTMLElement | null
    if (!active) return
    if (event.shiftKey) {
      if (active === first || !node.contains(active)) {
        event.preventDefault()
        last.focus()
      }
      return
    }
    if (active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const handleFocusIn = (event: FocusEvent) => {
    if (!wantsFocusTrap) return
    const target = event.target as HTMLElement | null
    if (!target) return
    if (node.contains(target)) return
    focusContainer()
  }

  const raf = requestAnimationFrame(() => focusContainer())
  node.addEventListener('keydown', handleTabTrap, true)
  document.addEventListener('focusin', handleFocusIn, true)

  const destroy = () => {
    cancelAnimationFrame(raf)
    node.removeEventListener('keydown', handleTabTrap, true)
    document.removeEventListener('focusin', handleFocusIn, true)
    openCount = Math.max(openCount - 1, 0)
    stack = stack.filter((e) => e.id !== id)
    syncBodyScrollLock()
    maybeRemoveEscapeListener()
    if (wantsRestore && previousActive && typeof previousActive.focus === 'function') {
      try {
        previousActive.focus()
      } catch {
        // ignore
      }
    }
  }

  return {
    update(next: ModalBehaviorOptions) {
      options = { ...next }
      entry.onClose = options.onClose
      entry.closeOnEscape = options.closeOnEscape !== false
    },
    destroy
  }
}

