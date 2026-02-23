import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesShardedAsync } from '../../../src/shared/json-stream.js';
import { readJsonlRowAt } from '../../../src/shared/artifact-io/offsets.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'offsets-unified-roundtrip');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const items = Array.from({ length: 25 }, (_, id) => ({ id, value: `row-${id}` }));
const result = await writeJsonLinesShardedAsync({
  dir: tempRoot,
  partsDirName: 'parts',
  partPrefix: 'part-',
  items,
  maxBytes: 200,
  atomic: true,
  offsets: { suffix: 'offsets.bin', atomic: true }
});

assert.ok(Array.isArray(result.parts) && result.parts.length > 0, 'expected sharded parts');
assert.ok(Array.isArray(result.offsets) && result.offsets.length === result.parts.length, 'expected offsets per part');

let globalIndex = 0;
for (let i = 0; i < result.parts.length; i += 1) {
  const partPath = path.join(tempRoot, ...result.parts[i].split('/'));
  const offsetsPath = path.join(tempRoot, ...result.offsets[i].split('/'));
  const count = result.counts[i] || 0;
  for (let localIndex = 0; localIndex < count; localIndex += 1) {
    const row = await readJsonlRowAt(partPath, offsetsPath, localIndex);
    assert.deepEqual(row, items[globalIndex], 'offset row mismatch');
    globalIndex += 1;
  }
}

assert.strictEqual(globalIndex, items.length, 'expected to read all rows');
console.log('offsets unified roundtrip test passed');
