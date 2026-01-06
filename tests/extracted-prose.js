#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'extracted-prose');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });

const commentText = 'extracted-prose sentinel phrase';
const source = [
  '/**',
  ` * ${commentText}`,
  ' */',
  'export function sample() { return 1; }',
  ''
].join('\n');
await fsPromises.writeFile(path.join(srcDir, 'sample.js'), source);

await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({ sqlite: { use: false } }, null, 2)
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: path.join(tempRoot, 'cache'),
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_CACHE_ROOT = env.PAIROFCLEATS_CACHE_ROOT;
process.env.PAIROFCLEATS_EMBEDDINGS = env.PAIROFCLEATS_EMBEDDINGS;

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--repo', repoRoot, '--mode', 'extracted-prose', '--stub-embeddings'],
  { env, encoding: 'utf8' }
);
if (buildResult.status !== 0) {
  console.error('Extracted-prose test failed: build_index error.');
  if (buildResult.stderr) console.error(buildResult.stderr.trim());
  process.exit(buildResult.status ?? 1);
}

const searchResult = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), '--repo', repoRoot, '--mode', 'extracted-prose', '--json', commentText],
  { env, encoding: 'utf8' }
);
if (searchResult.status !== 0) {
  console.error('Extracted-prose test failed: search error.');
  if (searchResult.stderr) console.error(searchResult.stderr.trim());
  process.exit(searchResult.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(searchResult.stdout || '{}');
} catch (err) {
  console.error('Extracted-prose test failed: invalid JSON output.');
  if (searchResult.stdout) console.error(searchResult.stdout.trim());
  process.exit(1);
}

const hits = Array.isArray(payload.extractedProse) ? payload.extractedProse : [];
const matched = hits.some((hit) => hit?.file === 'src/sample.js');
if (!matched) {
  console.error('Extracted-prose test failed: expected hit missing.');
  process.exit(1);
}

console.log('Extracted-prose test passed.');
