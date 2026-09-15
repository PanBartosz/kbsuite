import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('HR lists stay lightweight, cached reads do not backfill, and detail reads recover legacy samples', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kb-hr-metadata-'))
  const previous = process.env.KB_SUITE_DATA_DIR
  process.env.KB_SUITE_DATA_DIR = dir
  try {
    const { readHrMetadataBatch, readHrAttachment, rebuildHrAttachmentSummary } = await import('../src/lib/server/hr')
    const folder = join(dir, 'hr', 'metadata-test-session')
    await mkdir(folder, { recursive: true })
    const cached = { avgHr: 130, maxHr: 150, startTime: 0, durationSeconds: 60 }
    await writeFile(join(folder, 'summary.json'), JSON.stringify(cached))
    await writeFile(join(folder, 'session.tcx'), `<TrainingCenterDatabase><Activities><Activity><Lap><Track>
      <Trackpoint><Time>2026-09-01T12:00:00Z</Time><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>
      <Trackpoint><Time>2026-09-01T12:01:00Z</Time><HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint>
    </Track></Lap></Activity></Activities></TrainingCenterDatabase>`)
    const before = await readFile(join(folder, 'summary.json'), 'utf8')
    const metadata = await readHrMetadataBatch(['metadata-test-session', '../invalid', 'absent-session'])
    assert.deepEqual(metadata['metadata-test-session'], { attached: true, summary: cached })
    assert.equal(metadata['../invalid'], undefined)
    assert.deepEqual(metadata['absent-session'], { attached: false, summary: null })
    const current = await readHrAttachment('metadata-test-session', { details: true, cachedOnly: true })
    assert.equal((current.summary as any).samples, undefined)
    assert.equal(await readFile(join(folder, 'summary.json'), 'utf8'), before)
    const rebuilt = await rebuildHrAttachmentSummary('metadata-test-session')
    assert.equal(rebuilt.updated, true)
    assert.ok(rebuilt.summary?.samples?.length)
    const lightweight = await readHrAttachment('metadata-test-session')
    assert.equal((lightweight.summary as any).samples, undefined)
    const detailed = await readHrAttachment('metadata-test-session', { details: true })
    assert.ok((detailed.summary as any).samples.length)
    // A retained summary remains readable even if the original has been removed.
    await rm(join(folder, 'session.tcx'))
    assert.ok((await readHrMetadataBatch(['metadata-test-session']))['metadata-test-session'].summary)
    assert.ok(((await readHrAttachment('metadata-test-session', { details: true })).summary as any).samples.length)
  } finally {
    if (previous === undefined) delete process.env.KB_SUITE_DATA_DIR
    else process.env.KB_SUITE_DATA_DIR = previous
    await rm(dir, { recursive: true, force: true })
  }
})
