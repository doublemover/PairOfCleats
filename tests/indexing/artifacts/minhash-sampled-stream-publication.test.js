#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SimpleMinHash, minifyMinhashSignature, resolveMinhashSampledPlan } from '../../../src/index/minhash.js';
import { resolveMinhashOutputs } from '../../../src/index/build/postings/minhash.js';
import { buildPostings } from '../../../src/index/build/postings.js';
import { createMinhashSignatureIterable, packMinhashSignatures } from '../../../src/index/build/artifacts/minhash-packed.js';
import { writeIndexArtifacts } from '../../../src/index/build/artifacts.js';
import { loadMinhashSignatures } from '../../../src/shared/artifact-io/loaders/minhash.js';
import { rankMinhash } from '../../../src/retrieval/rankers.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const words = ['alpha', 'beta'];
const hash = new SimpleMinHash();
for (const word of words) hash.update(word);
const chunks = Array.from({ length: 5 }, (_, id) => ({
  id, chunkUid: `ck64:v1:repo:src/${id}.js:${String(id).padStart(16, '0')}`,
  chunkId: `chunk_${id}`, virtualPath: `src/${id}.js`, file: `src/${id}.js`, name: `item${id}`,
  kind: 'FunctionDeclaration', start: 0, end: 1, startLine: 1, endLine: 1,
  text: 'x', tokens: [], tokenCount: 0, minhashSig: [...hash.hashValues]
}));
const sampled = resolveMinhashSampledPlan({ totalDocs: chunks.length, maxDocs: 2, signatureLength: 128 });
const legacyRows = chunks.map((chunk) => minifyMinhashSignature(chunk.minhashSig, sampled));
const packedLegacy = packMinhashSignatures({ signatures: legacyRows });

// The streaming plan must not read/materialize one signature per document.
let signatureReads = 0;
const counted = chunks.map((chunk) => ({ get minhashSig() { signatureReads += 1; return chunk.minhashSig; } }));
const resolved = resolveMinhashOutputs({ sparseEnabled: true, minhashMaxDocs: 2, minhashStream: true, chunks: counted });
assert.deepEqual(resolved.minhashSigs, []);
assert.ok(signatureReads < counted.length, 'planning must not inspect every signature to materialize sampled rows');
assert.equal(resolved.minhashGuard.sampled, true);
assert.deepEqual(resolveMinhashOutputs({ sparseEnabled: true, minhashMaxDocs: 2, minhashStream: false, chunks }).minhashSigs, legacyRows);
assert.deepEqual(resolveMinhashOutputs({ sparseEnabled: false, chunks }).minhashSigs, []);
assert.equal(packMinhashSignatures({ chunks: [] }), null);

for (const hashStride of [1, 2, 3, 5, 8]) {
  const sampling = { mode: 'sampled-minified', signatureLength: 128, sampledSignatureLength: Math.ceil(128 / hashStride), hashStride };
  const oddRows = [
    null, [], ...chunks.map((chunk) => chunk.minhashSig),
    [0xffffffff, '12', -1, Infinity, NaN, 1.5, 0x100000001],
    Array.from({ length: 64 }, (_, index) => index + 1),
    Array.from({ length: 135 }, (_, index) => index + 10)
  ];
  const source = { chunks: oddRows.map((minhashSig) => ({ minhashSig })), sampling };
  const expected = oddRows.map((sig) => minifyMinhashSignature(sig, sampling));
  const repeatable = createMinhashSignatureIterable(source);
  assert.deepEqual([...repeatable], expected);
  assert.deepEqual([...repeatable], expected, 'measurement and JSON writing must see the same repeatable rows');
  const actual = packMinhashSignatures(source);
  const baseline = packMinhashSignatures({ signatures: expected });
  assert.deepEqual(actual, baseline, 'direct sampled packing must preserve bytes, shape and coercion counts');
  const explicit = { ...source, signatures: expected };
  assert.equal(createMinhashSignatureIterable(explicit), expected, 'explicit sampled rows are never sampled again');
  assert.deepEqual(packMinhashSignatures(explicit), baseline);
}
assert.throws(() => packMinhashSignatures({ chunks, sampling: { ...sampled, hashStride: 1.5 } }), /Invalid minhash/);

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-minhash-stream-'));
const originalReadStream = fsSync.createReadStream;
const packedPath = path.join(root, 'out', 'minhash_signatures.packed.bin');
let checksumRereads = 0;
fsSync.createReadStream = function (input, ...options) {
  if (input === packedPath) checksumRereads += 1;
  return originalReadStream.call(this, input, ...options);
};
try {
  const outDir = path.join(root, 'out');
  await fs.mkdir(outDir);
  applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off' });
  const config = { minhashMaxDocs: 2, minhashStream: true };
  const postings = await buildPostings({
    chunks, df: new Map(), tokenPostings: new Map(), docLengths: [],
    fieldPostings: {}, fieldDocLengths: {}, phrasePost: new Map(), triPost: new Map(),
    postingsConfig: config, embeddingsEnabled: false, modelId: 'stub', useStubEmbeddings: true, log: () => {}
  });
  assert.deepEqual(postings.minhashSigs, []);
  assert.equal(postings.minhashStream, true);
  const state = {
    chunks, scannedFilesTimes: [], scannedFiles: [], skippedFiles: [], totalTokens: 0,
    fileRelations: new Map(), fileInfoByPath: new Map(), fileDetailsByPath: new Map(),
    chunkUidToFile: new Map(chunks.map((chunk) => [chunk.chunkUid, chunk.file])),
    docLengths: [], vfsManifestRows: [], vfsManifestCollector: null, fieldTokens: [], importResolutionGraph: null
  };
  await writeIndexArtifacts({
    outDir, mode: 'code', state, postings, postingsConfig: config,
    modelId: 'stub', useStubEmbeddings: true, dictSummary: null, timing: { start: Date.now() }, root,
    userConfig: { indexing: { scm: { provider: 'none' }, artifacts: { minhashJsonLargeThreshold: 1000 } } },
    incrementalEnabled: false, fileCounts: { candidates: 0 },
    indexState: { generatedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), counts: { files: 0, chunks: chunks.length }, mode: 'code' },
    graphRelations: null, stageCheckpoints: null
  });
  assert.deepEqual(await fs.readFile(packedPath), packedLegacy.buffer);
  assert.equal(checksumRereads, 0, 'publication should reuse the checksum already computed for packed bytes');
  const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'pieces', 'manifest.json'), 'utf8'));
  const packedPiece = manifest.pieces.find((entry) => entry.path === 'minhash_signatures.packed.bin');
  assert.equal(packedPiece.bytes, packedLegacy.buffer.length);
  assert.equal(packedPiece.checksum, `sha1:${crypto.createHash('sha1').update(packedLegacy.buffer).digest('hex')}`);
  const json = JSON.parse(await fs.readFile(path.join(outDir, 'minhash_signatures.json'), 'utf8'));
  assert.deepEqual(json.signatures, legacyRows);
  assert.equal(json.sampling.hashStride, sampled.hashStride);
  const loaded = await loadMinhashSignatures(outDir, { strict: false });
  assert.deepEqual(loaded.signatures.map((row) => Array.from(row)), legacyRows);
  assert.equal(loaded.sampling.hashStride, sampled.hashStride);
  assert.equal(rankMinhash({ minhash: loaded }, words, 1, new Set([0]))[0].sim, 1);
  assert.deepEqual(postings.minhashSigs, [], 'artifact writing must not retain transformed sampled rows in postings');
  console.log('sampled minhash streaming passed: lazy planning, direct packed parity, repeatable JSON rows, actual writer/loader/ranker');
} finally {
  fsSync.createReadStream = originalReadStream;
  await fs.rm(root, { recursive: true, force: true });
}
