#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesFile } from '../../src/shared/json-stream.js';

const root = process.cwd();
const outDir = path.join(root, 'tests', '.cache', 'json-stream-abort');
await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const outPath = path.join(outDir, 'abort.jsonl');
const controller = new AbortController();
let count = 0;

const items = {
  [Symbol.iterator]() {
    return {
      next() {
        count += 1;
        if (count === 3) controller.abort();
        if (count > 100) return { done: true };
        return { done: false, value: { id: count, text: 'y'.repeat(2048) } };
      }
    };
  }
};

await assert.rejects(
  () => writeJsonLinesFile(outPath, items, { atomic: true, signal: controller.signal }),
  (err) => err?.name === 'AbortError'
);

assert.ok(!fs.existsSync(outPath), 'expected aborted output file to be cleaned up');
const leftover = (await fsPromises.readdir(outDir)).filter((entry) => entry.includes('.tmp-'));
assert.equal(leftover.length, 0, 'expected temp files to be removed after abort');

console.log('json-stream abort closes stream test passed');
