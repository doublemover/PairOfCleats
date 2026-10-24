#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tokenPostingsDictionaryProof, tokenPostingsRepresentationProof, reuseTokenPostingsFamily, sealTokenPostingsFamily } from '../../../src/index/build/artifacts/token-postings-reuse.js';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';
import { getRepoCacheRoot } from '../../../src/shared/dict-utils.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { writeArtifactPublicationRecord, writeArtifactPublicationValidationReport } from '../../../src/index/build/artifact-publication.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv({ testing: '1' });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-token-family-'));
try {
  const dictionary = { dictWords: new Set(['one']), codeDictCommonWords: new Set(), codeDictWordsAll: new Set(), codeDictWordsByLanguage: new Map() };
  const dictionarySignature = tokenPostingsDictionaryProof(dictionary);
  assert.notEqual(dictionarySignature, tokenPostingsDictionaryProof({ ...dictionary, dictWords: new Set(['two']) }));
  const input = { state: { chunks: [{ id: 0, chunkUid: 'stable', file: 'a.js', start: 0, end: 4 }], docLengths: [1] },
    postings: { tokenVocab: ['one'], tokenPostingsList: [[[0, 1]]], avgDocLen: 1 },
    policy: { dictionarySignature, dictionary: {}, postings: {}, lexicalMode: 'code' }, format: { encoding: 'packed' } };
  const proof = tokenPostingsRepresentationProof(input);
  assert.match(proof, /^[a-f0-9]{64}$/);
  assert.equal(tokenPostingsRepresentationProof({ ...input, policy: null }), null);
  for (const changed of [
    { ...input, state: { ...input.state, chunks: [{ ...input.state.chunks[0], id: 1 }] } },
    { ...input, state: { ...input.state, docLengths: [2] } },
    { ...input, postings: { ...input.postings, tokenPostingsList: [[[0, 2]]] } },
    { ...input, format: { encoding: 'json' } },
    { ...input, policy: { ...input.policy, postings: { changed: true } } }
  ]) assert.notEqual(tokenPostingsRepresentationProof(changed), proof);
  const userConfig = { cache: { root: path.join(root, 'cache') } };
  const cache = getRepoCacheRoot(root, userConfig), buildRoot = path.join(cache, 'builds', 'source'), outDir = path.join(buildRoot, 'index-code');
  await fs.mkdir(path.join(outDir, 'pieces'), { recursive: true });
  const registry = createArtifactPieceRegistry({ outDir });
  for (const [name, label, data] of [['token_postings', 'token_postings.packed.bin', 'data'], ['token_postings_offsets', 'token_postings.offsets.bin', 'offsets'], ['token_postings_meta', 'token_postings.meta.json', '{"vocab":["one"]}']]) {
    const filename = path.join(outDir, label); await fs.writeFile(filename, data);
    registry.addPieceFile({ name, type: 'postings', format: name.endsWith('meta') ? 'json' : 'binary' }, filename);
  }
  await sealTokenPostingsFamily({ outDir, plan: { proof }, entries: registry.listPieceEntries(), addPieceFile: registry.addPieceFile });
  const manifestPath = path.join(outDir, 'pieces', 'manifest.json');
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, mode: 'code', buildId: 'source', pieces: registry.listPieceEntries() };
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const publicationValidation = await writeArtifactPublicationValidationReport({ buildRoot, outDir, mode: 'code', buildId: 'source', manifestPath, pieceEntries: manifest.pieces });
  await writeArtifactPublicationRecord({ buildRoot, outDir, mode: 'code', buildId: 'source', manifestPath, pieceEntries: manifest.pieces, publicationValidation });
  await fs.writeFile(path.join(cache, 'builds', 'current.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildId: 'source', buildRoot: 'builds/source', buildRootsByMode: { code: 'builds/source' } }));
  const target = path.join(root, 'target'); await fs.mkdir(target);
  const targetRegistry = createArtifactPieceRegistry({ outDir: target });
  const reused = await reuseTokenPostingsFamily({ root, userConfig, outDir: target, mode: 'code', proof, enabled: true, addPieceFile: targetRegistry.addPieceFile });
  assert.equal(reused.reused, true); assert.equal(targetRegistry.listPieceEntries().length, 3);
  assert.equal(reused.payloadBytesCopied, 4 + 7 + Buffer.byteLength('{"vocab":["one"]}'));
  assert.equal(reused.payloadBytesRead, reused.payloadBytesCopied * 3);
  assert.deepEqual(await fs.readFile(path.join(target, 'token_postings.packed.bin')), Buffer.from('data'));
  const occupied = path.join(root, 'occupied'); await fs.mkdir(occupied);
  await fs.writeFile(path.join(occupied, 'token_postings.offsets.bin'), 'authority');
  const refused = await reuseTokenPostingsFamily({ root, userConfig, outDir: occupied, mode: 'code', proof, enabled: true, addPieceFile: () => assert.fail('partial registration') });
  assert.equal(refused.reused, false);
  await assert.rejects(fs.stat(path.join(occupied, 'token_postings.packed.bin')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(occupied, 'token_postings.offsets.bin'), 'utf8'), 'authority');
  await fs.writeFile(path.join(outDir, 'token_postings.offsets.bin'), 'corrupt');
  const miss = await reuseTokenPostingsFamily({ root, userConfig, outDir: path.join(root, 'corrupt-target'), mode: 'code', proof, enabled: true, addPieceFile: () => assert.fail('corrupt registration') });
  assert.equal(miss.reused, false);
} finally { await fs.rm(root, { recursive: true, force: true }); }
