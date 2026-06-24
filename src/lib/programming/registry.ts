import { depTotalWorkAdapter } from './adapters/dep-total-work'
import type { ProgramAdapter, ProgramKind } from './types'

export const programAdapters: Record<ProgramKind, ProgramAdapter> = {
  'dep-total-work': depTotalWorkAdapter
}

export const listProgramAdapters = () =>
  Object.values(programAdapters).map((adapter) => ({
    id: adapter.id,
    title: adapter.title,
    description: adapter.description
  }))

export const getProgramAdapter = (kind: unknown) => {
  const key = typeof kind === 'string' ? kind : ''
  return programAdapters[key as ProgramKind] ?? null
}
