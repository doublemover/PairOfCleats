#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { readJsonLinesArray } from '../../../src/shared/artifact-io.js';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'jsonl-utf8');
const jsonlPath = path.join(tempRoot, 'sample.jsonl');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const entry = { text: 'café “swift”', file: 'sample.swift' };
await writeJsonLinesFile(jsonlPath, [entry], { atomic: true });

const buffer = await fsPromises.readFile(jsonlPath);
const decoder = new TextDecoder('utf-8', { fatal: true });
try {
  decoder.decode(buffer);
} catch {
  console.error('JSONL UTF-8 test failed: invalid UTF-8 output.');
  process.exit(1);
}

const parsed = await readJsonLinesArray(jsonlPath);
if (!Array.isArray(parsed) || parsed.length !== 1) {
  console.error('JSONL UTF-8 test failed: unexpected entry count.');
  process.exit(1);
}
if (parsed[0]?.text !== entry.text) {
  console.error('JSONL UTF-8 test failed: text mismatch.');
  process.exit(1);
}

console.log('jsonl utf8 tests passed');

