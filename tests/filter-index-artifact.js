#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';
import { readJsonFile } from '../src/shared/artifact-io.js';
import { loadIndex } from '../src/retrieval/cli-index.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'filter-index-artifact');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');
const configPath = path.join(repoRoot, '.pairofcleats.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });
await fsPromises.writeFile(path.join(srcDir, 'example.js'), 'const a = 1;\n', 'utf8');
await fsPromises.writeFile(
  configPath,
  JSON.stringify({ search: { filePrefilter: { chargramN: 4 } } }, null, 2)
);

const buildResult = spawnSync(process.execPath, [
  path.join(root, 'build_index.js'),
  '--stub-embeddings',
  '--repo',
  repoRoot
], { encoding: 'utf8' });
if (buildResult.status !== 0) {
  console.error(buildResult.stderr || buildResult.stdout || 'build_index failed');
  process.exit(buildResult.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const indexDir = getIndexDir(repoRoot, 'code', userConfig);
const filterIndexPath = path.join(indexDir, 'filter_index.json');
const raw = readJsonFile(filterIndexPath);
assert.equal(raw.fileChargramN, 4, 'expected filter_index.json fileChargramN to match config');

const idx = await loadIndex(indexDir, { modelIdDefault: 'test', fileChargramN: 2 });
assert.equal(idx.filterIndex?.fileChargramN, 4, 'expected hydrated filter index to use persisted fileChargramN');

console.log('filter index artifact test passed');
