#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getEffectiveConfigHash, getIndexDir, loadUserConfig } from '../tools/dict-utils.js';
import { readJsonFile } from '../src/shared/artifact-io.js';
import { loadIndex } from '../src/retrieval/cli-index.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'filter-index-artifact');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });
await fsPromises.writeFile(path.join(srcDir, 'example.js'), 'const a = 1;\n', 'utf8');

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: path.join(tempRoot, 'cache'),
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = env.PAIROFCLEATS_CACHE_ROOT;
process.env.PAIROFCLEATS_EMBEDDINGS = env.PAIROFCLEATS_EMBEDDINGS;

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
const filterIndexPath = path.join(indexDir, 'filter_index.json');
const raw = readJsonFile(filterIndexPath);
assert.ok(Number.isFinite(raw.fileChargramN) && raw.fileChargramN > 0, 'expected fileChargramN to be set');
assert.equal(raw.schemaVersion, 1, 'expected filter_index schemaVersion=1');
assert.equal(raw.configHash, getEffectiveConfigHash(repoRoot, userConfig), 'expected filter_index configHash to match');

const idx = await loadIndex(indexDir, { modelIdDefault: 'test', fileChargramN: 1 });
assert.equal(idx.filterIndex?.fileChargramN, raw.fileChargramN, 'expected hydrated filter index to use persisted fileChargramN');

console.log('filter index artifact test passed');
