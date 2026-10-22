import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { buildSqliteReport } from '../../../src/index/validate/sqlite-report.js';
import { writeSqliteZeroStateManifest } from '../../../src/storage/sqlite/build/runner/config.js';
import { resolveSqlitePaths } from '../../../src/shared/dict-utils.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
const root = resolveTestCachePath(process.cwd(), `sqlite-zero-proof-${crypto.randomUUID()}`);
const indexDir = path.join(root, 'index-code');
const userConfig = { cache: { root: path.join(root, 'cache') }, sqlite: { scoreMode: 'bm25' } };
const outputPath = resolveSqlitePaths(root, userConfig, { indexRoot: root }).codePath;
const marker = path.join(indexDir, 'pieces', 'sqlite-zero-state.json');
const report = () => buildSqliteReport({ root, userConfig, indexRoot: root, modes: ['code'],
  sqliteEnabled: true, report: { issues: [], hints: [] } });
try {
  await fs.mkdir(path.dirname(marker), { recursive: true });
  await fs.writeFile(marker, '{"invalid":true}');
  assert.equal((await report()).ok, false, 'marker existence cannot waive DB checks');
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, mode: 'code', buildId: 'A',
    pieces: [{ name: 'chunk_meta', path: 'chunk_meta.json', format: 'json', count: 0 }] };
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]');
  await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify(manifest));
  await writeSqliteZeroStateManifest({ modeIndexDir: indexDir, mode: 'code', outputPath, chunkCount: 0, denseCount: 0 });
  assert.equal((await report()).ok, true, 'verified current empty sources waive DB checks');
  manifest.buildId = 'B';
  await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify(manifest));
  assert.equal((await report()).ok, false, 'stale source generation rejects prior marker');
  await writeSqliteZeroStateManifest({ modeIndexDir: indexDir, mode: 'code', outputPath, chunkCount: 0, denseCount: 0 });
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[{"id":0,"file":"now.js","start":0,"end":1}]');
  assert.equal((await report()).ok, false, 'independent no-data proof detects populated chunk source');
  await assert.rejects(writeSqliteZeroStateManifest({ modeIndexDir: indexDir, mode: 'code', outputPath, chunkCount: null, denseCount: 0 }));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('SQLite zero-state proof admission passed');
