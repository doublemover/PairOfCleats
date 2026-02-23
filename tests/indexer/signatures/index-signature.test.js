#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildIndexSignature, INDEX_SIGNATURE_TTL_MS } from '../../../src/retrieval/index-cache.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'index-signature');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const indexStatePath = path.join(tempRoot, 'index_state.json');
const chunkMetaPath = path.join(tempRoot, 'chunk_meta.json');
const tokenPostingsPath = path.join(tempRoot, 'token_postings.json');
const fileRelationsPath = path.join(tempRoot, 'file_relations.json');

await fsPromises.writeFile(
  indexStatePath,
  JSON.stringify({ buildId: 'buildA', mode: 'code', artifactSurfaceVersion: '1' })
);

const signatureA = await buildIndexSignature(tempRoot);
assert.ok(signatureA, 'Expected initial signature.');

const syncMethods = ['readFileSync', 'statSync', 'readdirSync', 'existsSync'];
const syncOriginals = new Map();
for (const name of syncMethods) {
  syncOriginals.set(name, fsSync[name]);
  fsSync[name] = () => {
    throw new Error(`sync fs used: ${name}`);
  };
}

let signatureB;
try {
  await fsPromises.writeFile(
    indexStatePath,
    JSON.stringify({ buildId: 'buildB', mode: 'code', artifactSurfaceVersion: '1' })
  );
  signatureB = await buildIndexSignature(tempRoot);
} finally {
  for (const [name, original] of syncOriginals.entries()) {
    fsSync[name] = original;
  }
}

assert.notEqual(signatureA, signatureB, 'Expected signature to change when index_state changes.');

await fsPromises.rm(indexStatePath, { force: true });
await fsPromises.writeFile(chunkMetaPath, JSON.stringify([{ id: 0, file: 'a.js' }]));
await fsPromises.writeFile(tokenPostingsPath, JSON.stringify({ vocab: [], postings: [], docLengths: [] }));
await fsPromises.writeFile(fileRelationsPath, JSON.stringify([{ file: 'a.js', imports: ['b.js'] }]));

const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;

let signatureC;
let signatureD;
try {
  signatureC = await buildIndexSignature(tempRoot);
  await fsPromises.writeFile(
    chunkMetaPath,
    JSON.stringify([{ id: 0, file: 'a.js' }, { id: 1, file: 'b.js' }])
  );
  now += INDEX_SIGNATURE_TTL_MS + 1;
  signatureD = await buildIndexSignature(tempRoot);
} finally {
  Date.now = originalNow;
}

assert.notEqual(signatureC, signatureD, 'Expected signature to change when chunk_meta changes.');

console.log('index signature test passed');

