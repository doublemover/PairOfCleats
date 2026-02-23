#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadTokenPostings } from '../../../src/shared/artifact-io/loaders.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const testRoot = await prepareArtifactIoTestDir('token-postings-binary-columnar-path-traversal', { root });
const indexDir = path.join(testRoot, 'index');
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });

await fs.writeFile(path.join(indexDir, 'token_postings.binary-columnar.bin'), Buffer.from([0]));
await fs.writeFile(path.join(indexDir, 'token_postings.binary-columnar.offsets.bin'), Buffer.from([0, 0, 0, 0]));
await fs.writeFile(path.join(indexDir, 'token_postings.binary-columnar.lengths.varint'), Buffer.from([0]));
await fs.writeFile(path.join(testRoot, 'outside.bin'), Buffer.from([0]));
await fs.writeFile(
  path.join(indexDir, 'token_postings.binary-columnar.meta.json'),
  JSON.stringify({
    fields: {
      format: 'binary-columnar-v1',
      count: 1,
      data: '../outside.bin',
      offsets: 'token_postings.binary-columnar.offsets.bin',
      lengths: 'token_postings.binary-columnar.lengths.varint'
    },
    arrays: {
      vocab: ['alpha'],
      docLengths: [1]
    }
  }, null, 2)
);
await writePiecesManifest(indexDir, [
  { name: 'token_postings', path: 'token_postings.binary-columnar.bin', format: 'binary-columnar' },
  { name: 'token_postings_meta', path: 'token_postings.binary-columnar.meta.json', format: 'json' },
  { name: 'token_postings_binary_columnar_offsets', path: 'token_postings.binary-columnar.offsets.bin', format: 'binary' },
  { name: 'token_postings_binary_columnar_lengths', path: 'token_postings.binary-columnar.lengths.varint', format: 'varint' }
]);

assert.throws(
  () => loadTokenPostings(indexDir, { strict: false }),
  /Invalid token_postings binary-columnar data path/,
  'expected token_postings binary-columnar loader to reject traversal sidecar paths'
);

console.log('token-postings binary-columnar path traversal test passed');
