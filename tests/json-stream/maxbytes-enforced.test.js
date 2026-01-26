#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesSharded } from '../../src/shared/json-stream.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'json-stream-maxbytes');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const items = [
  { id: 1, text: 'x'.repeat(5000) }
];

let threw = false;
try {
  await writeJsonLinesSharded({
    dir: outDir,
    partsDirName: 'oversize.parts',
    partPrefix: 'oversize.part-',
    items,
    maxBytes: 256,
    atomic: true
  });
} catch (err) {
  threw = true;
  assert.equal(err?.code, 'ERR_JSON_TOO_LARGE');
}

assert.ok(threw, 'expected maxBytes enforcement to throw');

console.log('json-stream maxBytes enforcement test passed');

