#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonLinesArray } from '../../../src/shared/artifact-io.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'jsonl-concurrency-order');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const partA = path.join(cacheRoot, 'part-a.jsonl');
const partB = path.join(cacheRoot, 'part-b.jsonl');
const padding = 'y'.repeat(150000);
await fs.writeFile(partA, `{\"id\":1,\"pad\":\"${padding}\"}\n{\"id\":2}\n`);
await fs.writeFile(partB, `{\"id\":3}\n{\"id\":4}\n`);

const rows = await readJsonLinesArray([partA, partB], {
  maxBytes: 5 * 1024 * 1024,
  concurrency: 2
});
assert.deepEqual(rows.map((row) => row.id), [1, 2, 3, 4]);
