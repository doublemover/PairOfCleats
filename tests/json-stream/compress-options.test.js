#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesFile } from '../../src/shared/json-stream.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'json-stream-compress-options');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const items = Array.from({ length: 10 }, (_, i) => ({ id: i, text: `item-${i}` }));
const outPath = path.join(outDir, 'items.jsonl.gz');

await writeJsonLinesFile(outPath, items, {
  compression: 'gzip',
  gzipOptions: { level: 15, bogus: true, mem: 8 }
});

const stat = await fs.stat(outPath);
assert.ok(stat.size > 0, 'expected gzip output to be written');

console.log('json-stream compress options test passed');
