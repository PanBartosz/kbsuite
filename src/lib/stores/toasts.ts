import { browser } from '$app/environment'
import { writable } from 'svelte/store'

export type ToastType = 'info' | 'success' | 'error'

export type ToastAction = {
  label: string
  onClick: () => void
}

export type Toast = {
  id: string
  message: string
  type: ToastType
  action?: ToastAction
}

const MAX_TOASTS = 4

const createId = () => {
  const randomUuid = (globalThis as any)?.crypto?.randomUUID
  if (typeof randomUuid === 'function') return randomUuid.call((globalThis as any).crypto)
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const toastList = writable<Toast[]>([])
const timers = new Map<string, ReturnType<typeof setTimeout>>()

export const toasts = {
  subscribe: toastList.subscribe
}

export const dismissToast = (id: string) => {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  toastList.update((list) => list.filter((t) => t.id !== id))
}

export const clearToasts = () => {
  timers.forEach((timer) => clearTimeout(timer))
  timers.clear()
  toastList.set([])
}

export const pushToast = (
  message: string,
  type: ToastType = 'info',
  duration = 2400,
  action?: ToastAction
) => {
  const id = createId()
  if (!browser) return id
  const toast: Toast = { id, message, type, action }
  toastList.update((list) => [toast, ...list].slice(0, MAX_TOASTS))
  if (duration > 0) {
    const timer = setTimeout(() => dismissToast(id), duration)
    timers.set(id, timer)
  }
  return id
}

