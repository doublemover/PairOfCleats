#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { assembleIndexPieces } from '../../src/index/build/piece-assembly.js';

process.env.PAIROFCLEATS_TESTING = '1';

const createIndex = async (rootDir, name, compatibilityKey) => {
  const indexDir = path.join(rootDir, name);
  await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
  const chunkMeta = [{ id: 0, file: 'src/a.js', start: 0, end: 1 }];
  const tokenPostings = {
    vocab: ['alpha'],
    postings: [[[0, 1]]],
    docLengths: [1],
    avgDocLen: 1,
    totalDocs: 1
  };
  const indexState = {
    generatedAt: new Date().toISOString(),
    mode: 'code',
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    compatibilityKey
  };
  const pieces = [
    { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' },
    { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
    { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' }
  ];
  const manifest = {
    version: 2,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    compatibilityKey,
    pieces
  };
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(chunkMeta, null, 2));
  await fs.writeFile(path.join(indexDir, 'token_postings.json'), JSON.stringify(tokenPostings, null, 2));
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify(indexState, null, 2));
  await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify(manifest, null, 2));
  return indexDir;
};

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-compat-assemble-'));
const inputA = await createIndex(rootDir, 'index-a', 'compat-a');
const inputB = await createIndex(rootDir, 'index-b', 'compat-b');
const outDir = path.join(rootDir, 'out');

let failed = false;
try {
  await assembleIndexPieces({
    inputs: [inputA, inputB],
    outDir,
    root: rootDir,
    mode: 'code',
    userConfig: {},
    strict: true
  });
} catch (err) {
  failed = true;
  assert.match(
    String(err?.message || err),
    /compatibilityKey mismatch/i,
    'expected compatibilityKey mismatch error'
  );
}

if (!failed) {
  throw new Error('Expected assembleIndexPieces to reject mismatched compatibilityKey values');
}

console.log('compatibility key federation block test passed');
