#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'json-stream-tombstone-cleanup-target-scope');
await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const targetPath = path.join(outDir, 'target.jsonl');
const unrelatedTombstone = path.join(outDir, 'pending-delete-unrelated-marker');
await fsPromises.writeFile(unrelatedTombstone, 'must-survive', 'utf8');
const controller = new AbortController();
let count = 0;
const items = {
  [Symbol.iterator]() {
    return {
      next() {
        count += 1;
        if (count === 3) controller.abort();
        if (count > 100) return { done: true };
        return { done: false, value: { id: count, payload: 'x'.repeat(2048) } };
      }
    };
  }
};

await assert.rejects(
  () => writeJsonLinesFile(targetPath, items, { atomic: true, signal: controller.signal }),
  (err) => err?.name === 'AbortError'
);

assert.equal(fs.existsSync(unrelatedTombstone), true, 'expected unrelated pending-delete marker to remain');

console.log('json-stream target-scoped tombstone cleanup test passed');
