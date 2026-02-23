#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadTokenPostings } from '../../../src/shared/artifact-io/loaders.js';
import { encodePackedOffsets, packTfPostings } from '../../../src/shared/packed-postings.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const testRoot = await prepareArtifactIoTestDir('token-postings-packed-offsets-path-traversal', { root });
const indexDir = path.join(testRoot, 'index');
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });

const postings = [[[1, 2]]];
const packed = packTfPostings(postings, { blockSize: 2 });
await fs.writeFile(path.join(indexDir, 'token_postings.packed.bin'), packed.buffer);
await fs.writeFile(path.join(testRoot, 'outside.offsets.bin'), encodePackedOffsets(packed.offsets));
await fs.writeFile(
  path.join(indexDir, 'token_postings.packed.meta.json'),
  JSON.stringify({
    fields: {
      blockSize: packed.blockSize,
      offsets: '../outside.offsets.bin',
      totalDocs: 1,
      avgDocLen: 1
    },
    arrays: {
      vocab: ['alpha'],
      docLengths: [1]
    }
  }, null, 2)
);
await writePiecesManifest(indexDir, [
  { name: 'token_postings', path: 'token_postings.packed.bin', format: 'packed' },
  { name: 'token_postings_meta', path: 'token_postings.packed.meta.json', format: 'json' }
]);

assert.throws(
  () => loadTokenPostings(indexDir, { strict: false }),
  /Invalid token_postings packed offsets path/,
  'expected packed token_postings loader to reject traversal offsets path'
);

console.log('token-postings packed offsets path traversal test passed');
