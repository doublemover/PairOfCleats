#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { loadChunkMeta, loadTokenPostings } from '../../../src/shared/artifact-io/loaders.js';
import { encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import { encodeVarint64List } from '../../../src/shared/artifact-io/varint.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

applyTestEnv();

const root = process.cwd();
const testRoot = await prepareArtifactIoTestDir('prefer-binary-columnar-loaders', { root });

await fs.writeFile(
  path.join(testRoot, 'chunk_meta.json'),
  JSON.stringify([{ id: 0, file: 'json.cc', start: 0, end: 1 }], null, 2)
);
await fs.writeFile(
  path.join(testRoot, 'token_postings.json'),
  JSON.stringify({
    vocab: ['json_tok'],
    postings: [[[1, 1]]],
    docLengths: [1],
    totalDocs: 1,
    avgDocLen: 1
  }, null, 2)
);

const chunkMetaBinaryRows = encodeBinaryRowFrames([
  Buffer.from(JSON.stringify({ id: 0, fileRef: 0, start: 0, end: 1 }), 'utf8')
]);
await fs.writeFile(path.join(testRoot, 'chunk_meta.binary-columnar.bin'), chunkMetaBinaryRows.dataBuffer);
await fs.writeFile(path.join(testRoot, 'chunk_meta.binary-columnar.offsets.bin'), chunkMetaBinaryRows.offsetsBuffer);
await fs.writeFile(path.join(testRoot, 'chunk_meta.binary-columnar.lengths.varint'), chunkMetaBinaryRows.lengthsBuffer);
await fs.writeFile(
  path.join(testRoot, 'chunk_meta.binary-columnar.meta.json'),
  JSON.stringify({
    fields: {
      format: 'binary-columnar-v1',
      count: 1,
      data: 'chunk_meta.binary-columnar.bin',
      offsets: 'chunk_meta.binary-columnar.offsets.bin',
      lengths: 'chunk_meta.binary-columnar.lengths.varint'
    },
    arrays: {
      fileTable: ['binary.cc']
    }
  }, null, 2)
);

const tokenPayload = encodeVarint64List([1, 2, 4, 1]);
const tokenPostingsBinaryRows = encodeBinaryRowFrames([tokenPayload]);
await fs.writeFile(path.join(testRoot, 'token_postings.binary-columnar.bin'), tokenPostingsBinaryRows.dataBuffer);
await fs.writeFile(path.join(testRoot, 'token_postings.binary-columnar.offsets.bin'), tokenPostingsBinaryRows.offsetsBuffer);
await fs.writeFile(path.join(testRoot, 'token_postings.binary-columnar.lengths.varint'), tokenPostingsBinaryRows.lengthsBuffer);
await fs.writeFile(
  path.join(testRoot, 'token_postings.binary-columnar.meta.json'),
  JSON.stringify({
    fields: {
      format: 'binary-columnar-v1',
      count: 1,
      data: 'token_postings.binary-columnar.bin',
      offsets: 'token_postings.binary-columnar.offsets.bin',
      lengths: 'token_postings.binary-columnar.lengths.varint',
      totalDocs: 1,
      avgDocLen: 3
    },
    arrays: {
      vocab: ['binary_tok'],
      docLengths: [3]
    }
  }, null, 2)
);

await writePiecesManifest(testRoot, [
  { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
  { name: 'token_postings', path: 'token_postings.json', format: 'json' }
]);

const chunkMetaDefault = await loadChunkMeta(testRoot, { strict: true, preferBinaryColumnar: false });
assert.equal(chunkMetaDefault[0]?.file, 'json.cc', 'expected manifest JSON chunk_meta when preference is disabled');

const chunkMetaPreferred = await loadChunkMeta(testRoot, { strict: true, preferBinaryColumnar: true });
assert.equal(
  chunkMetaPreferred[0]?.file,
  'binary.cc',
  'expected chunk_meta preference to use binary-columnar fast path when available'
);

const chunkMetaImplicitPreference = await loadChunkMeta(testRoot, { strict: true });
assert.equal(
  chunkMetaImplicitPreference[0]?.file,
  'binary.cc',
  'expected chunk_meta loader default to prefer binary-columnar when available'
);

await writePiecesManifest(testRoot, [
  { name: 'chunk_meta', path: 'chunk_meta.binary-columnar.bin', format: 'binary-columnar' },
  { name: 'token_postings', path: 'token_postings.json', format: 'json' }
]);
const chunkMetaBinaryDeclared = await loadChunkMeta(testRoot, { strict: true, preferBinaryColumnar: true });
assert.equal(
  chunkMetaBinaryDeclared[0]?.file,
  'binary.cc',
  'expected binary chunk_meta when manifest explicitly declares binary-columnar format'
);

const postingsDefault = loadTokenPostings(testRoot, { strict: true, preferBinaryColumnar: false });
assert.equal(postingsDefault?.vocab?.[0], 'json_tok', 'expected manifest JSON token_postings when preference is disabled');

const postingsPreferred = loadTokenPostings(testRoot, { strict: true, preferBinaryColumnar: true });
assert.equal(postingsPreferred?.vocab?.[0], 'binary_tok', 'expected binary token_postings when preference is enabled');
assert.deepEqual(postingsPreferred?.postings?.[0], [[1, 2], [5, 1]], 'expected binary postings payload to be decoded');

const postingsImplicitPreference = loadTokenPostings(testRoot, { strict: true });
assert.equal(
  postingsImplicitPreference?.vocab?.[0],
  'binary_tok',
  'expected token_postings loader default to prefer binary-columnar when available'
);

const oversizedTokenPayload = encodeVarint64List(
  Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? Math.floor(index / 2) + 1 : 1))
);
const oversizedTokenPostingsRows = encodeBinaryRowFrames([oversizedTokenPayload]);
await fs.writeFile(path.join(testRoot, 'token_postings.binary-columnar.bin'), oversizedTokenPostingsRows.dataBuffer);
await fs.writeFile(path.join(testRoot, 'token_postings.binary-columnar.offsets.bin'), oversizedTokenPostingsRows.offsetsBuffer);
await fs.writeFile(path.join(testRoot, 'token_postings.binary-columnar.lengths.varint'), oversizedTokenPostingsRows.lengthsBuffer);

assert.throws(
  () => loadTokenPostings(testRoot, {
    strict: true,
    preferBinaryColumnar: true,
    maxBytes: 16
  }),
  /maxBytes/i,
  'expected default binary token_postings load to respect maxBytes'
);

const postingsBudgetBypassed = loadTokenPostings(testRoot, {
  strict: true,
  preferBinaryColumnar: true,
  enforceBinaryDataBudget: false,
  maxBytes: 16
});
assert.equal(
  postingsBudgetBypassed?.vocab?.[0],
  'binary_tok',
  'expected disable-enforce flag to allow large binary token_postings to load'
);

await fs.writeFile(
  path.join(testRoot, 'token_postings.binary-columnar.meta.json'),
  JSON.stringify({
    fields: {
      format: 'binary-columnar-v1',
      count: 1,
      data: 'token_postings.binary-columnar.bin',
      offsets: 'token_postings.binary-columnar.offsets.bin',
      lengths: 'token_postings.binary-columnar.lengths.varint'
    },
    arrays: {
      vocab: [],
      docLengths: [3]
    }
  }, null, 2)
);
assert.throws(
  () => loadTokenPostings(testRoot, { strict: true, preferBinaryColumnar: true }),
  /cardinality invariant failed/i,
  'expected token_postings binary-columnar loader to enforce vocab/postings cardinality invariants'
);

console.log('prefer binary-columnar loaders test passed');
