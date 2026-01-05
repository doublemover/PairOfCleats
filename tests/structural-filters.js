#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, getRepoCacheRoot, loadUserConfig } from '../tools/dict-utils.js';
import { loadChunkMeta } from '../src/shared/artifact-io.js';
import { filterChunks } from '../src/retrieval/output.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'structural-filters');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });
await fsPromises.writeFile(path.join(srcDir, 'example.js'), 'eval("x");\n', 'utf8');

const userConfig = loadUserConfig(repoRoot);
const cacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const structuralDir = path.join(cacheRoot, 'structural');
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
], { encoding: 'utf8' });
if (buildResult.status !== 0) {
  console.error(buildResult.stderr || buildResult.stdout || 'build_index failed');
  process.exit(buildResult.status ?? 1);
}

const indexDir = getIndexDir(repoRoot, 'code', userConfig);
const chunkMeta = loadChunkMeta(indexDir);
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
