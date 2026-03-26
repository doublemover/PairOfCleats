#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const placeholderPath = path.join(ROOT, 'tests', 'ci-lite', 'placeholder.test.js');
const taxonomyDocPath = path.join(ROOT, 'tests', 'TEST_TAXONOMY.md');

let placeholderExists = true;
try {
  await fsPromises.access(placeholderPath);
} catch {
  placeholderExists = false;
}

assert.equal(placeholderExists, false, 'stale ci-lite placeholder test should not exist');

const taxonomyDoc = await fsPromises.readFile(taxonomyDocPath, 'utf8');
for (const required of [
  'hero',
  'matrix',
  'meta',
  'soak',
  'heavy-runtime',
  'negative-path stderr'
]) {
  assert.ok(
    taxonomyDoc.includes(required),
    `expected test taxonomy doc to include ${required}`
  );
}

console.log('test taxonomy guard test passed');
