#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonLinesArray } from '../../../src/shared/artifact-io.js';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import { tryRequire } from '../../../src/shared/optional-deps.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'jsonl-worker-order');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const count = 4000;
const text = 'alpha-beta-gamma-delta-epsilon'.repeat(40);
const items = Array.from({ length: count }, (_, i) => ({
  id: i,
  text,
  tag: `row-${i}`
}));

const gzipPath = path.join(outDir, 'rows.jsonl.gz');
await writeJsonLinesFile(gzipPath, items, {
  compression: 'gzip',
  gzipOptions: { level: 1 },
  atomic: true
});
const gzipParsed = await readJsonLinesArray(gzipPath);
assert.equal(gzipParsed.length, items.length);
for (let i = 0; i < gzipParsed.length; i += 1) {
  assert.equal(gzipParsed[i].id, i);
}

const zstdAvailable = tryRequire('@mongodb-js/zstd').ok;
if (zstdAvailable) {
  const zstdPath = path.join(outDir, 'rows.jsonl.zst');
  await writeJsonLinesFile(zstdPath, items, {
    compression: 'zstd',
    atomic: true
  });
  const zstdParsed = await readJsonLinesArray(zstdPath);
  assert.equal(zstdParsed.length, items.length);
  for (let i = 0; i < zstdParsed.length; i += 1) {
    assert.equal(zstdParsed[i].id, i);
  }
} else {
  console.log('jsonl worker order test skipped (zstd unavailable)');
}

console.log('jsonl worker order test passed');
