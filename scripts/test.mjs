import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const dir = await mkdtemp(join(tmpdir(), 'kb-suite-tests-'))
try {
  const outfile = join(dir, 'tests.mjs')
  await build({
    entryPoints: ['tests/index.ts'], bundle: true, platform: 'node', format: 'esm', outfile,
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
    plugins: [{ name: 'worker-stub', setup(build) {
      build.onResolve({ filter: /\?worker$/ }, () => ({ path: 'worker', namespace: 'test' }))
      build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export default class Worker {}' }))
    } }]
  })
  const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
} finally { await rm(dir, { recursive: true, force: true }) }
