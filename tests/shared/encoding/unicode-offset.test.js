#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { loadChunkMeta, MAX_JSON_BYTES } from '../../../src/shared/artifact-io.js';
import { getIndexDir, loadUserConfig, toRealPathSync } from '../../../tools/shared/dict-utils.js';
import { createStage1CodeBuildEnv, runStage1CodeBuildOrExit } from '../../helpers/build-index-fixture.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'unicode-offset');
const repoRootRaw = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRootRaw, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
const repoRoot = toRealPathSync(repoRootRaw);

const content = [
  'const note = "café café café café café café café café café café";',
  '',
  'function first() {',
  '  return note;',
  '}',
  '',
  'function second() {',
  '  return "second";',
  '}',
  ''
].join('\n');

const sourcePath = path.join(repoRoot, 'unicode.js');
await fsPromises.writeFile(sourcePath, content);

const env = createStage1CodeBuildEnv({ cacheRoot });

await runStage1CodeBuildOrExit({ root, repoRoot, env, printCrashLog: true });

const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
let chunks = null;
try {
  chunks = await loadChunkMeta(codeDir, { maxBytes: MAX_JSON_BYTES, strict: true });
} catch (err) {
  console.error(`Failed to load chunk_meta for unicode test (${codeDir}):`, err?.message || err);
  process.exit(1);
}
if (!Array.isArray(chunks) || !chunks.length) {
  console.error('No chunks found for unicode test');
  process.exit(1);
}

const targetChunk = chunks.find((chunk) => typeof chunk?.name === 'string' && chunk.name.includes('second'));
if (!targetChunk) {
  console.error('Unable to find chunk for function second');
  process.exit(1);
}

const raw = await fsPromises.readFile(sourcePath, 'utf8');
const expectedIndex = raw.indexOf('function second');
if (expectedIndex < 0) {
  console.error('Expected to find "function second" in source');
  process.exit(1);
}

const delta = Math.abs(targetChunk.start - expectedIndex);
if (delta > 5) {
  console.error(`Unicode offset drift detected (delta=${delta}).`);
  process.exit(1);
}

const snippet = raw.slice(targetChunk.start, targetChunk.start + 40);
if (!/^\s*function second/.test(snippet)) {
  console.error('Unicode snippet does not start with expected function signature.');
  process.exit(1);
}

const startLine = raw.slice(0, targetChunk.start).split('\n').length;
if (targetChunk.startLine !== startLine) {
  console.error(`Unicode startLine mismatch (${targetChunk.startLine} !== ${startLine}).`);
  process.exit(1);
}
if (targetChunk.endLine < targetChunk.startLine) {
  console.error('Unicode endLine should not precede startLine.');
  process.exit(1);
}

console.log('Unicode offset test passed');

