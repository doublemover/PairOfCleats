import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { enqueueTokenPostingsArtifacts, resolveTokenPostingsPlan } from '../../../src/index/build/artifacts/token-postings.js';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';
import { loadTokenPostings } from '../../../src/shared/artifact-io/loaders/token-postings.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-token-representations-'));
const postings = { tokenVocab: ['alpha', '雪😀', 'zulu'], tokenPostingsList: [[[0, 2], [2, 1]], [], [[1, 3]]], avgDocLen: 2 };
const state = { docLengths: [2, 3, 1] };
const makePlan = requireCompatibility => resolveTokenPostingsPlan({ artifactMode: 'auto', tokenPostingsFormatConfig: 'packed',
  tokenPostingsShardSize: 10, tokenPostingsShardThreshold: 100, tokenPostingsBinaryColumnar: true,
  tokenPostingsBinaryColumnarRequired: requireCompatibility, postings,
  maxJsonBytes: 1024 * 1024, maxJsonBytesSoft: 512 * 1024, shardTargetBytes: 64 * 1024, log() {} });
const write = async (label, plan) => {
  const outDir = path.join(root, label); await fs.mkdir(outDir);
  const registry = createArtifactPieceRegistry({ outDir }), jobs = [];
  await enqueueTokenPostingsArtifacts({ outDir, state, postings, tokenPostingsFormat: 'packed',
    tokenPostingsBinaryColumnar: true, representationPlan: plan?.representationPlan,
    enqueueWrite: (name, job) => jobs.push({ name, job }), enqueueJsonObject() { assert.fail('unexpected JSON copy'); },
    ...registry });
  for (const { job } of jobs) await job();
  const manifest = { version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: registry.listPieceEntries() };
  await fs.mkdir(path.join(outDir, 'pieces'));
  await fs.writeFile(path.join(outDir, 'pieces', 'manifest.json'), JSON.stringify(manifest));
  return { outDir, jobs, manifest };
};
try {
  const minimalPlan = makePlan(false), compatibilityPlan = makePlan(true);
  assert.equal(minimalPlan.representationPlan.primary, 'packed');
  assert.equal(minimalPlan.tokenPostingsBinaryColumnar, false);
  assert.equal(compatibilityPlan.tokenPostingsBinaryColumnar, true);
  assert.equal(compatibilityPlan.representationPlan.compatibilityReason, 'explicit-request');
  const minimal = await write('minimal', minimalPlan);
  const compatibility = await write('compatibility', compatibilityPlan);
  const legacy = await write('legacy-direct-caller', null);
  assert.equal(minimal.jobs.some(job => job.name === 'token_postings.binary-columnar.bundle'), false);
  assert.equal(compatibility.jobs.some(job => job.name === 'token_postings.binary-columnar.bundle'), true);
  assert.equal(legacy.jobs.some(job => job.name === 'token_postings.binary-columnar.bundle'), true,
    'existing direct writer callers retain their requested compatibility output');
  assert.equal(minimal.manifest.pieces.length, 3);
  assert.equal(compatibility.manifest.pieces.length, 7);
  for (const fixture of [minimal, compatibility, legacy]) {
    for (const preferBinaryColumnar of [false, true]) {
      const loaded = loadTokenPostings(fixture.outDir, { manifest: fixture.manifest, preferBinaryColumnar });
      assert.deepEqual(loaded.vocab, postings.tokenVocab);
      assert.deepEqual(loaded.postings, postings.tokenPostingsList);
      assert.deepEqual(loaded.docLengths, state.docLengths);
      assert.equal(loaded.avgDocLen, postings.avgDocLen);
    }
  }
  // A stale, unlisted optional artifact cannot supersede the selected primary.
  for (const filename of ['token_postings.binary-columnar.bin', 'token_postings.binary-columnar.offsets.bin',
    'token_postings.binary-columnar.lengths.varint', 'token_postings.binary-columnar.meta.json']) {
    await fs.writeFile(path.join(minimal.outDir, filename), 'stale and malformed');
  }
  assert.deepEqual(loadTokenPostings(minimal.outDir, { manifest: minimal.manifest }).postings, postings.tokenPostingsList);
  const primary = minimal.manifest.pieces.find(piece => piece.name === 'token_postings');
  const invalid = structuredClone(minimal.manifest);
  invalid.pieces.find(piece => piece.name === 'token_postings').extensions.representationPlan.primary = 'json';
  assert.throws(() => loadTokenPostings(minimal.outDir, { manifest: invalid }), { code: 'ERR_MANIFEST_INVALID' });
  for (const filename of ['token_postings.packed.offsets.bin', 'token_postings.packed.meta.json']) {
    const bytes = await fs.readFile(path.join(minimal.outDir, filename));
    await fs.rm(path.join(minimal.outDir, filename));
    assert.throws(() => loadTokenPostings(minimal.outDir, { manifest: minimal.manifest }),
      filename.endsWith('meta.json') ? /Missing JSON artifact:.*token_postings\.packed\.meta\.json/ : /Missing token_postings packed offsets/);
    await fs.writeFile(path.join(minimal.outDir, filename), bytes);
  }
  for (const name of ['token_postings_meta', 'token_postings_offsets']) {
    const missing = structuredClone(minimal.manifest);
    missing.pieces = missing.pieces.filter(piece => piece.name !== name);
    assert.throws(() => loadTokenPostings(minimal.outDir, { manifest: missing }), { code: 'ERR_MANIFEST_INCOMPLETE' },
      'a physical stale sidecar cannot satisfy planned manifest membership');
  }
  for (const name of ['token_postings', 'token_postings_meta', 'token_postings_offsets']) {
    for (const checksum of ['sha512:abc', 'sha1:bad', 'unchecked', 17]) {
      const invalid = structuredClone(minimal.manifest);
      invalid.pieces.find(piece => piece.name === name).checksum = checksum;
      assert.throws(() => loadTokenPostings(minimal.outDir, { manifest: invalid }), { code: 'ERR_MANIFEST_INVALID' });
    }
  }
  const metaPath = path.join(minimal.outDir, 'token_postings.packed.meta.json');
  const metaBytes = await fs.readFile(metaPath);
  await fs.writeFile(metaPath, Buffer.concat([metaBytes, Buffer.from(' ')]));
  assert.throws(() => loadTokenPostings(minimal.outDir, { manifest: minimal.manifest }), /checksum mismatch/,
    'planned metadata checksums are verified against freshly opened bytes');
  await fs.writeFile(metaPath, metaBytes);
  const noMetaChecksum = structuredClone(minimal.manifest);
  delete noMetaChecksum.pieces.find(piece => piece.name === 'token_postings_meta').checksum;
  for (const [key, value, code] of [
    ['blockSize', 1.5, 'ERR_ARTIFACT_INVALID'], ['vocabCount', 4, 'ERR_ARTIFACT_INVALID'],
    ['offsets', 'foreign.offsets.bin', 'ERR_MANIFEST_INCOMPLETE']
  ]) {
    const meta = JSON.parse(metaBytes); (meta.fields || meta)[key] = value;
    await fs.writeFile(metaPath, JSON.stringify(meta));
    assert.throws(() => loadTokenPostings(minimal.outDir, { manifest: noMetaChecksum }), { code });
  }
  await fs.writeFile(metaPath, metaBytes);
  const legacyNoInventory = structuredClone(legacy.manifest);
  legacyNoInventory.pieces = legacyNoInventory.pieces.filter(piece => !['token_postings_meta', 'token_postings_offsets'].includes(piece.name));
  assert.deepEqual(loadTokenPostings(legacy.outDir, { manifest: legacyNoInventory, preferBinaryColumnar: false }).postings,
    postings.tokenPostingsList, 'unplanned legacy sidecar discovery retains its compatibility contract');
  const missingCompatibility = structuredClone(compatibility.manifest);
  missingCompatibility.pieces = missingCompatibility.pieces.filter(piece => piece.name !== 'token_postings_binary_columnar_lengths');
  assert.throws(() => loadTokenPostings(compatibility.outDir, { manifest: missingCompatibility }), { code: 'ERR_MANIFEST_INCOMPLETE' });
  await fs.rm(path.join(compatibility.outDir, 'token_postings.binary-columnar.meta.json'));
  assert.throws(() => loadTokenPostings(compatibility.outDir, { manifest: compatibility.manifest }), { code: 'ERR_MANIFEST_INCOMPLETE' });
  assert.equal(primary.extensions.representationPlan.emitBinaryColumnar, false);
  await assert.rejects(enqueueTokenPostingsArtifacts({ outDir: minimal.outDir, postings, state,
    tokenPostingsFormat: 'packed', representationPlan: { ...minimalPlan.representationPlan } }), TypeError);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Packed postings use one planned representation; explicit and legacy compatibility output and loader authority remain intact.');
