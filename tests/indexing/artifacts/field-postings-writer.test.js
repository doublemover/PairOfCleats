#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import {
  createFieldPostingsRowSerializer,
  planFieldPostingsShardParts,
  writeFieldPostingsJsonFromRanges
} from '../../../src/index/build/artifacts/field-postings.js';

applyTestEnv({ testing: '1' });

const parts = planFieldPostingsShardParts({
  outDir: 'C:/repo/out',
  fieldCount: 10,
  shardCount: 4
});
assert.equal(parts.length, 4, 'expected one part per planned shard when rows are sufficient');
assert.deepEqual(
  parts.map((part) => part.count),
  [3, 3, 3, 1],
  'expected shard planner to split counts deterministically'
);
assert.equal(parts[0].relPath, 'field_postings.shards/field_postings.part-0000.json');
assert.equal(parts[3].relPath, 'field_postings.shards/field_postings.part-0003.json');

let cachedSerializeCalls = 0;
const cachedSerializer = createFieldPostingsRowSerializer({
  fieldNames: ['alpha'],
  fieldPostingsObject: {
    alpha: {
      toJSON() {
        cachedSerializeCalls += 1;
        return { docs: [0, 1, 2] };
      }
    }
  },
  cacheValues: true
});

cachedSerializer.serializePairAt(0);
cachedSerializer.serializePairAt(0);
cachedSerializer.serializeBinaryAt(0);
assert.equal(cachedSerializeCalls, 1, 'expected cached serializer to reuse serialized value across artifact variants');

let uncachedSerializeCalls = 0;
const uncachedSerializer = createFieldPostingsRowSerializer({
  fieldNames: ['alpha'],
  fieldPostingsObject: {
    alpha: {
      toJSON() {
        uncachedSerializeCalls += 1;
        return { docs: [0, 1, 2] };
      }
    }
  },
  cacheValues: false
});

uncachedSerializer.serializePairAt(0);
uncachedSerializer.serializePairAt(0);
uncachedSerializer.serializeBinaryAt(0);
assert.equal(uncachedSerializeCalls, 3, 'expected uncached serializer to recompute each serialization request');

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-field-postings-writer-'));
try {
  const targetPath = path.join(tmpRoot, 'field_postings.json');
  const writerSerializer = createFieldPostingsRowSerializer({
    fieldNames: ['field_a', 'field_b', 'field_c'],
    fieldPostingsObject: {
      field_a: { totalDocs: 1 },
      field_b: { totalDocs: 2 },
      field_c: { totalDocs: 3 }
    },
    cacheValues: true
  });

  const writeMetrics = await writeFieldPostingsJsonFromRanges({
    targetPath,
    ranges: [
      { start: 1, end: 3 },
      { start: 0, end: 1 }
    ],
    serializePairAt: writerSerializer.serializePairAt,
    batchTargetBytes: 12
  });

  const raw = await fs.readFile(targetPath, 'utf8');
  const fieldBIndex = raw.indexOf('"field_b"');
  const fieldCIndex = raw.indexOf('"field_c"');
  const fieldAIndex = raw.indexOf('"field_a"');
  assert.ok(fieldBIndex >= 0 && fieldCIndex >= 0 && fieldAIndex >= 0, 'expected all fields in emitted payload');
  assert.ok(fieldBIndex < fieldCIndex && fieldCIndex < fieldAIndex, 'expected writer to preserve range order exactly');

  assert.equal(writeMetrics.directFdStreaming, true, 'expected streaming write metrics flag');
  assert.ok(Number.isFinite(writeMetrics.serializationMs), 'expected serialization timing metric');
  assert.ok(Number.isFinite(writeMetrics.diskMs), 'expected disk timing metric');
} finally {
  await fs.rm(tmpRoot, { recursive: true, force: true });
}

console.log('field_postings writer helpers test passed');
