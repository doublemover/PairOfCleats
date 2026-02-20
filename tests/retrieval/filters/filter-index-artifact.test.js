#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { getEnvConfig } from '../../../src/shared/env.js';
import { buildContentConfigHash } from '../../../src/index/build/runtime/hash.js';
import { MAX_JSON_BYTES, readJsonFile, loadJsonObjectArtifact } from '../../../src/shared/artifact-io.js';
import { loadIndex } from '../../../src/retrieval/cli-index.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { rmDirRecursive } from '../../helpers/temp.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'filter-index-artifact');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');

await rmDirRecursive(tempRoot, { retries: 6, delayMs: 150 });
await fsPromises.mkdir(srcDir, { recursive: true });
await fsPromises.writeFile(path.join(srcDir, 'example.js'), 'const a = 1;\n', 'utf8');

const env = applyTestEnv({
  cacheRoot: path.join(tempRoot, 'cache'),
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' }
    }
  }
});

const buildResult = spawnSync(process.execPath, [
  path.join(root, 'build_index.js'),
  '--stub-embeddings',
  '--repo',
  repoRoot
], { encoding: 'utf8', env });
if (buildResult.status !== 0) {
  console.error(buildResult.stderr || buildResult.stdout || 'build_index failed');
  process.exit(buildResult.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const indexDir = getIndexDir(repoRoot, 'code', userConfig);
const piecesManifestRaw = readJsonFile(path.join(indexDir, 'pieces', 'manifest.json'));
const piecesManifest = piecesManifestRaw?.fields && typeof piecesManifestRaw.fields === 'object'
  ? piecesManifestRaw.fields
  : piecesManifestRaw;
const raw = await loadJsonObjectArtifact(indexDir, 'filter_index', {
  manifest: piecesManifest,
  strict: true,
  maxBytes: MAX_JSON_BYTES
});
assert.ok(Number.isFinite(raw.fileChargramN) && raw.fileChargramN > 0, 'expected fileChargramN to be set');
assert.equal(raw.schemaVersion, 2, 'expected filter_index schemaVersion=2');
assert.equal(
  raw.configHash,
  buildContentConfigHash(userConfig, (() => {
    const envConfig = getEnvConfig() || {};
    const { apiToken, ...envWithoutSecrets } = envConfig;
    return envWithoutSecrets;
  })()),
  'expected filter_index configHash to match'
);
assert.ok(raw.byLang && raw.byLang.javascript, 'expected filter_index to include byLang');

const idx = await loadIndex(indexDir, { modelIdDefault: 'test', fileChargramN: 1 });
assert.equal(idx.filterIndex?.fileChargramN, raw.fileChargramN, 'expected hydrated filter index to use persisted fileChargramN');

console.log('filter index artifact test passed');

