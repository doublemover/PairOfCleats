#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseProgressEventLine } from '../src/shared/cli/progress-events.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'shard-progress-determinism');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });

await fs.writeFile(path.join(repoRoot, 'src', 'alpha.js'), 'const alpha = 1;\n');
await fs.writeFile(path.join(repoRoot, 'src', 'beta.js'), 'const beta = 2;\n');
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  indexing: {
    treeSitter: { enabled: false },
    embeddings: { mode: 'off' }
  },
  sqlite: { use: false }
}, null, 2));

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'build_index.js'),
    '--repo',
    repoRoot,
    '--mode',
    'code',
    '--stage',
    'stage1',
    '--no-sqlite',
    '--stub-embeddings',
    '--progress',
    'jsonl',
    '--verbose'
  ],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      PAIROFCLEATS_CACHE_ROOT: cacheRoot
    }
  }
);

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || 'build_index failed');
  process.exit(result.status ?? 1);
}

const fileIndexByPath = new Map();
let lastIndex = 0;
let progressCount = 0;

for (const line of String(result.stderr || '').split(/\r?\n/)) {
  const event = parseProgressEventLine(line);
  if (!event || event.event !== 'log') continue;
  const meta = event.meta || null;
  if (!meta || meta.kind !== 'file-progress') continue;
  const fileIndex = Number(meta.fileIndex);
  if (!Number.isFinite(fileIndex)) {
    throw new Error('file-progress missing fileIndex');
  }
  progressCount += 1;
  if (fileIndex <= lastIndex) {
    throw new Error(`fileIndex not monotonic: ${fileIndex} after ${lastIndex}`);
  }
  lastIndex = fileIndex;
  const prevPath = fileIndexByPath.get(fileIndex);
  if (prevPath && prevPath !== meta.file) {
    throw new Error(`fileIndex reused for different files: ${fileIndex}`);
  }
  fileIndexByPath.set(fileIndex, meta.file);
}

assert.ok(progressCount >= 2, 'expected file-progress events');
console.log('shard progress determinism test passed.');
