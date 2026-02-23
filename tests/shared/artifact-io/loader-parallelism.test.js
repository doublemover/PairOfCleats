import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import { readJsonLinesArray } from '../../../src/shared/artifact-io/json.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'loader-parallelism');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const partA = path.join(tempRoot, 'part-a.jsonl');
const partB = path.join(tempRoot, 'part-b.jsonl');
const rowsA = [{ id: 1, value: 'a1' }, { id: 2, value: 'a2' }];
const rowsB = [{ id: 3, value: 'b1' }, { id: 4, value: 'b2' }];

await writeJsonLinesFile(partA, rowsA, { atomic: true });
await writeJsonLinesFile(partB, rowsB, { atomic: true });

const paths = [partA, partB];
const sequential = await readJsonLinesArray(paths, { concurrency: 1 });
const parallel = await readJsonLinesArray(paths, { concurrency: 2 });
const parallelRepeat = await readJsonLinesArray(paths, { concurrency: 2 });

assert.deepEqual(parallel, sequential, 'parallel load should match sequential');
assert.deepEqual(parallelRepeat, sequential, 'parallel load should be deterministic');
console.log('loader parallelism test passed');
