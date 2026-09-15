/** Use the reader's locale and omit seconds in human-facing timestamps. */
export const formatDateTime = (timestamp: number | string | Date): string => {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
