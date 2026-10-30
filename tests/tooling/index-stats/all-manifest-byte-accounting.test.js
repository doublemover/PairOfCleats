import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { accumulateManifestBytes, summarizeManifestBytes } from '../../../tools/index/stats-artifacts.js';
const pieces = [{ name: 'chunk_meta', path: 'chunks.json', bytes: 100 },
  { name: 'file_meta', path: 'files.json', bytes: 17 }, { name: 'uncategorized', path: 'other.bin', bytes: 33 },
  { name: 'alias', path: './other.bin', bytes: 33 }];
const physical = accumulateManifestBytes(new Map(), process.cwd(), pieces);
assert.deepEqual(summarizeManifestBytes(physical), { pieces: 3, unknownPieces: 0, bytes: 150 });
accumulateManifestBytes(physical, process.cwd(), [{ path: 'unknown.bin' }]);
assert.deepEqual(summarizeManifestBytes(physical), { pieces: 4, unknownPieces: 1, bytes: null });
const { dir } = await prepareIsolatedTestCacheDir('all-manifest-byte-accounting');
try {
  const indexDir = path.join(dir, 'index-code');
  await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces };
  const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
  const run = async () => {
    const result = await spawnSubprocess(process.execPath,
      [path.resolve('tools/index/stats.js'), '--index-dir', indexDir, '--json'],
      { env, timeoutMs: 5000, stdio: ['ignore', 'pipe', 'pipe'], maxOutputBytes: 256 * 1024 });
    assert.equal(result.exitCode, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const report = await run();
  assert.equal(report.totals.totalBytes, 150);
  assert.equal(report.totals.manifestPieces, 3);
  assert.equal(report.totals.fileCount, null, 'an absent file count is unknown, independently of known physical bytes');
  assert.equal(report.modes.code.fileMeta.bytes, 17);
  manifest.pieces.push({ name: 'unknown', path: 'unknown.bin', format: 'bin' });
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const unknown = await run();
  assert.equal(unknown.totals.totalBytes, null);
  assert.equal(unknown.totals.unknownPieceBytes, 1);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Index byte totals include each physical manifested payload exactly once.');
