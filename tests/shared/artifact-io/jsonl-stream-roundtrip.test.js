#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonLinesArray } from '../../../src/shared/artifact-io.js';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'artifact-io-jsonl');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const items = Array.from({ length: 256 }, (_value, index) => ({
  id: index,
  name: `entry-${index}`,
  tag: index % 5
}));

const filePath = path.join(outDir, 'entries.jsonl');
await writeJsonLinesFile(filePath, items);
const parsed = await readJsonLinesArray(filePath);

if (!Array.isArray(parsed) || parsed.length !== items.length) {
  console.error('artifact-io jsonl roundtrip failed: length mismatch.');
  process.exit(1);
}
if (parsed[0]?.id !== 0 || parsed[parsed.length - 1]?.id !== items.length - 1) {
  console.error('artifact-io jsonl roundtrip failed: boundary entries mismatch.');
  process.exit(1);
}

console.log('artifact-io jsonl roundtrip test passed');
