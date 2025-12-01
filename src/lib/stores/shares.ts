import { browser } from '$app/environment'
import { writable } from 'svelte/store'

export type Invite = {
  id: string
  sender_id: string
  recipient_id: string
  source_planned_id: string
  title?: string
  yaml_source?: string
  plan_json?: any
  planned_for?: number | null
  notes?: string
  tags?: string[]
  message?: string
  status: 'pending' | 'accepted' | 'rejected' | 'canceled'
  created_at?: number
  responded_at?: number | null
  seen_at?: number | null
  sender_username?: string | null
  recipient_username?: string | null
}

type ShareState = {
  pending: Invite[]
  sent: Invite[]
  count: number
  loaded: boolean
}

const defaultState: ShareState = { pending: [], sent: [], count: 0, loaded: false }

export const shares = writable<ShareState>({ ...defaultState })

const updateState = (partial: Partial<ShareState>) => {
  shares.update((prev) => ({ ...prev, ...partial }))
}

export const loadInvites = async (
  scope: 'incoming' | 'sent' = 'incoming',
  status?: string
) => {
  if (!browser) return
  try {
    const params = new URLSearchParams({ scope })
    if (status) params.set('status', status)
    const res = await fetch(`/api/shared-workouts?${params.toString()}`)
    const data = await res.json().catch(() => ({}))
    const items: Invite[] = data?.items ?? []
    if (scope === 'sent') {
      updateState({ sent: items, count: data?.pendingCount ?? defaultState.count, loaded: true })
    } else {
      updateState({ pending: items, count: data?.pendingCount ?? items.length, loaded: true })
    }
    return items
  } catch (err) {
    console.warn('Failed to load invites', err)
  }
}

export const loadPendingCount = async () => {
  if (!browser) return
  try {
    const res = await fetch('/api/shared-workouts?scope=incoming&status=pending')
    const data = await res.json().catch(() => ({}))
    const items: Invite[] = data?.items ?? []
    updateState({ pending: items, count: data?.pendingCount ?? items.length, loaded: true })
    return items
  } catch (err) {
    console.warn('Failed to load pending invites', err)
  }
}

export const markSeen = async (id: string) => {
  if (!browser) return
  try {
    const res = await fetch(`/api/shared-workouts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'seen' })
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data?.invite) {
      shares.update((prev) => {
        const pending = prev.pending.map((inv) =>
          inv.id === id ? { ...inv, seen_at: Date.now() } : inv
        )
        return { ...prev, pending }
      })
    }
  } catch (err) {
    console.warn('Failed to mark invite seen', err)
  }
}
