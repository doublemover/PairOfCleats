#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesFile } from '../../src/shared/json-stream.js';

const root = process.cwd();
const outDir = path.join(root, 'tests', '.cache', 'json-stream-gzip-options');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const items = Array.from({ length: 200 }, (_, i) => ({
  id: i,
  text: 'alpha-beta-gamma-delta-epsilon'.repeat(20)
}));

const lowPath = path.join(outDir, 'level-1.jsonl.gz');
const highPath = path.join(outDir, 'level-9.jsonl.gz');

await writeJsonLinesFile(lowPath, items, {
  compression: 'gzip',
  gzipOptions: { level: 1 },
  atomic: true
});

await writeJsonLinesFile(highPath, items, {
  compression: 'gzip',
  gzipOptions: { level: 9 },
  atomic: true
});

const lowSize = (await fs.stat(lowPath)).size;
const highSize = (await fs.stat(highPath)).size;

assert.ok(
  highSize <= lowSize,
  `expected level 9 output <= level 1 output (${highSize} <= ${lowSize})`
);

console.log('json-stream gzip options forwarded test passed');
