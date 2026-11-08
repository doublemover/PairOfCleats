#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io/loaders.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

applyTestEnv();

const root = process.cwd();
const testRoot = await prepareArtifactIoTestDir('manifest-maxbytes-infinity', { root });

await fs.writeFile(
  path.join(testRoot, 'dense_vectors_uint8.json'),
  JSON.stringify([{ vector: [1, 2, 3] }], null, 2)
);
await writePiecesManifest(testRoot, [
  { name: 'dense_vectors_uint8', path: 'dense_vectors_uint8.json', format: 'json' }
]);

const rows = [];
for await (const row of loadJsonArrayArtifactRows(testRoot, 'dense_vectors_uint8', {
  strict: false,
  maxBytes: Number.POSITIVE_INFINITY,
  materialize: true
})) {
  rows.push(row);
}

assert.equal(rows.length, 1, 'expected one vector row when maxBytes is Infinity');
assert.deepEqual(rows[0], { vector: [1, 2, 3] }, 'unexpected row payload');

await assert.rejects(async () => {
  for await (const _row of loadJsonArrayArtifactRows(testRoot, 'dense_vectors_uint8', {
    strict: true, maxBytes: Number.POSITIVE_INFINITY
  })) assert.fail('strict manifest reads cannot admit a nonfinite budget');
}, { code: 'ERR_MANIFEST_MAX_BYTES' });

console.log('manifest maxBytes Infinity loader test passed');
