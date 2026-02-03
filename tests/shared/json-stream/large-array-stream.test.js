#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile } from '../../../src/shared/artifact-io.js';
import { writeJsonArrayFile } from '../../../src/shared/json-stream.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'json-stream-large');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const items = Array.from({ length: 5000 }, (_value, index) => ({
  id: index,
  label: `item-${index}`,
  payload: { bucket: index % 17 }
}));

const arrayPath = path.join(outDir, 'large-array.json');
await writeJsonArrayFile(arrayPath, items, { highWaterMark: 64 * 1024 });

const parsed = readJsonFile(arrayPath);
if (!Array.isArray(parsed) || parsed.length !== items.length) {
  console.error('json-stream large array test failed: length mismatch.');
  process.exit(1);
}
if (parsed[0]?.id !== 0 || parsed[parsed.length - 1]?.id !== items.length - 1) {
  console.error('json-stream large array test failed: boundary entries mismatch.');
  process.exit(1);
}

console.log('json-stream large array test passed');
