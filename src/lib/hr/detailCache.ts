/** Page-scoped cache: shares requests, bounds work and rejects invalidated results. */
export function createDetailCache<T>(load: (id: string, signal: AbortSignal) => Promise<T>, receive: (id: string, value: T) => void, concurrency = 3) {
  const values = new Map<string, T>()
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('Concurrency must be a positive integer')
  type Request = { result: Promise<T | undefined>; cancel: () => void }
  const pending = new Map<string, Request>()
  const queue: Array<() => void> = []
  let active = 0
  let stopped = false
  const drain = () => {
    while (active < concurrency && queue.length) queue.shift()!()
  }
  return {
    get(id: string): Promise<T | undefined> {
      if (stopped) return Promise.resolve(undefined)
      if (values.has(id)) return Promise.resolve(values.get(id))
      if (pending.has(id)) return pending.get(id)!.result
      let resolve!: (value: T | undefined) => void
      const result = new Promise<T | undefined>(done => { resolve = done })
      let cancelled = false
      const controller = new AbortController()
      const request: Request = { result, cancel() {
        cancelled = true
        controller.abort()
        resolve(undefined)
      } }
      pending.set(id, request)
      queue.push(() => {
        if (stopped || cancelled) return
        active++
        Promise.resolve().then(() => load(id, controller.signal)).then(value => {
          if (!stopped && !cancelled) {
            values.set(id, value)
            receive(id, value)
            pending.delete(id)
            resolve(value)
          } else resolve(undefined)
        }).catch(() => {
          if (pending.get(id) === request) pending.delete(id)
          resolve(undefined)
        }).finally(() => {
          if (pending.get(id) === request) pending.delete(id)
          active--
          drain()
        })
      })
      drain()
      return result
    },
    invalidate(id: string) {
      pending.get(id)?.cancel()
      pending.delete(id)
      values.delete(id)
    },
    destroy() {
      stopped = true
      pending.forEach(request => request.cancel())
      values.clear()
      pending.clear()
      queue.length = 0
    }
  }
}
