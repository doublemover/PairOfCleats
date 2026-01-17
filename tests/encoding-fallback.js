#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readTextFile } from '../src/shared/encoding.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'encoding');
const cacheRoot = path.join(root, 'tests', '.cache', 'encoding-fallback');
const sourcePath = path.join(fixtureRoot, 'latin1.js');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const { text, usedFallback, encoding } = await readTextFile(sourcePath);
if (!text.includes('café')) {
  console.error('Encoding fallback did not decode latin1.js correctly.');
  process.exit(1);
}
if (!usedFallback) {
  console.error('Expected encoding fallback to be used for latin1.js.');
  process.exit(1);
}
const allowedEncodings = new Set(['latin1', 'iso-8859-1', 'iso-8859-2', 'windows-1252']);
if (encoding && !allowedEncodings.has(encoding)) {
  console.error(`Unexpected fallback encoding for latin1.js: ${encoding}`);
  process.exit(1);
}

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub',
  PAIROFCLEATS_WORKER_POOL: 'off'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', fixtureRoot],
  { cwd: fixtureRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('Failed: build_index');
  process.exit(buildResult.status ?? 1);
}

const searchResult = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), '--json', '--repo', fixtureRoot, 'café'],
  { cwd: fixtureRoot, env, encoding: 'utf8' }
);
if (searchResult.status !== 0) {
  console.error('Failed: search');
  process.exit(searchResult.status ?? 1);
}
let payload = null;
try {
  payload = JSON.parse(searchResult.stdout || '{}');
} catch {
  console.error('Search output is not valid JSON.');
  process.exit(1);
}
const hits = Array.isArray(payload?.code) ? payload.code : [];
const hit = hits.find((entry) => typeof entry?.file === 'string' && entry.file.endsWith('latin1.js'));
if (!hit) {
  console.error('Expected search hit for latin1.js in encoding fixture.');
  process.exit(1);
}

console.log('encoding fallback test passed');
