#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadChunkMeta, MAX_JSON_BYTES } from '../../../src/shared/artifact-io.js';
import { getIndexDir, loadUserConfig, toRealPathSync } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'unicode-offset');
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

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' }
    }
  }
});

const buildResult = spawnSync(
  process.execPath,
  [
    path.join(root, 'build_index.js'),
    '--stub-embeddings',
    '--stage',
    'stage2',
    '--repo',
    repoRoot
  ],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  if (buildResult.error) {
    console.error('build_index spawn error:', buildResult.error);
  }
  const crashLogPath = path.join(repoRoot, 'logs', 'index-crash.log');
  if (fs.existsSync(crashLogPath)) {
    const crashLog = await fsPromises.readFile(crashLogPath, 'utf8');
    const tail = crashLog.length > 2000 ? crashLog.slice(-2000) : crashLog;
    console.error('build_index crash log (tail):\n' + tail);
  }
  console.error('Failed: build_index');
  process.exit(buildResult.status ?? 1);
}

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

