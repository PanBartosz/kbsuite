import { json } from '@sveltejs/kit'
import { authorizeApiRequest } from '$lib/server/api-v1'
import { getDb } from '$lib/server/db'
import { readHrAttachment, rebuildHrAttachmentSummary } from '$lib/server/hr'

type BackfillItem = {
  id: string
  status: 'missing_hr' | 'already_present' | 'updated' | 'failed'
  samples?: number
  error?: string
}

export const POST = async ({ request }) => {
  const auth = authorizeApiRequest(request)
  if ('response' in auth) return auth.response

  const rows = getDb()
    .prepare(
      `SELECT id
       FROM completed_workouts
       WHERE user_id = ?
       ORDER BY created_at DESC`
    )
    .all(auth.user.userId) as { id: string }[]

  const items: BackfillItem[] = []
  let scanned = 0
  let updated = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    scanned += 1
    try {
      const current = await readHrAttachment(row.id, { details: true, cachedOnly: true })
      if (!current.attached) {
        skipped += 1
        items.push({ id: row.id, status: 'missing_hr' })
        continue
      }

      const cachedSummary = current.summary as { samples?: unknown[] } | null
      const existingSamples = Array.isArray(cachedSummary?.samples)
        ? cachedSummary.samples.length
        : 0
      if (existingSamples > 0) {
        skipped += 1
        items.push({ id: row.id, status: 'already_present', samples: existingSamples })
        continue
      }

      const rebuilt = await rebuildHrAttachmentSummary(row.id)
      const samples = Array.isArray(rebuilt.summary?.samples) ? rebuilt.summary.samples.length : 0
      if (rebuilt.updated && samples > 0) {
        updated += 1
        items.push({ id: row.id, status: 'updated', samples })
      } else {
        failed += 1
        items.push({ id: row.id, status: 'failed' })
      }
    } catch (error) {
      failed += 1
      items.push({
        id: row.id,
        status: 'failed',
        error: (error as any)?.message ?? 'Failed to rebuild HR sparkline samples'
      })
    }
  }

  return json({ ok: failed === 0, scanned, updated, skipped, failed, items })
}
