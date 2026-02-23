#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, getRepoCacheRoot, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { loadChunkMeta, readJsonFile } from '../../../src/shared/artifact-io.js';
import { filterChunks } from '../../../src/retrieval/output.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'structural-filters');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.writeFile(path.join(srcDir, 'example.js'), 'eval("x");\n', 'utf8');

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' }
    }
  }
});

const userConfig = loadUserConfig(repoRoot);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const structuralDir = path.join(repoCacheRoot, 'structural');
await fsPromises.mkdir(structuralDir, { recursive: true });
const match = {
  engine: 'semgrep',
  pack: 'test-pack',
  ruleId: 'no-eval',
  tags: ['security'],
  path: 'src/example.js',
  startLine: 1,
  endLine: 1,
  snippet: 'eval("x")'
};
await fsPromises.writeFile(
  path.join(structuralDir, 'structural.jsonl'),
  `${JSON.stringify(match)}\n`,
  'utf8'
);

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

const indexDir = getIndexDir(repoRoot, 'code', userConfig);
const chunkMeta = await loadChunkMeta(indexDir);
const fileMeta = readJsonFile(path.join(indexDir, 'file_meta.json'));
const fileMetaById = new Map(
  Array.isArray(fileMeta) ? fileMeta.map((entry) => [entry.id, entry]) : []
);
for (const chunk of chunkMeta) {
  if (!chunk || chunk.file || chunk.fileId == null) continue;
  const meta = fileMetaById.get(chunk.fileId);
  if (meta?.file) chunk.file = meta.file;
}
const target = chunkMeta.find((chunk) => chunk.file === 'src/example.js');
assert.ok(target, 'expected example.js chunk to exist');
assert.ok(Array.isArray(target.docmeta?.structural), 'expected structural metadata on chunk');
assert.equal(target.docmeta.structural[0]?.pack, 'test-pack');
assert.equal(target.docmeta.structural[0]?.ruleId, 'no-eval');

const packFiltered = filterChunks(chunkMeta, { structPack: 'test-pack' });
assert.ok(packFiltered.find((chunk) => chunk.file === 'src/example.js'), 'expected struct-pack filter to match');

const ruleFiltered = filterChunks(chunkMeta, { structRule: 'no-eval' });
assert.ok(ruleFiltered.find((chunk) => chunk.file === 'src/example.js'), 'expected struct-rule filter to match');

const tagFiltered = filterChunks(chunkMeta, { structTag: 'security' });
assert.ok(tagFiltered.find((chunk) => chunk.file === 'src/example.js'), 'expected struct-tag filter to match');

console.log('structural filters test passed');

