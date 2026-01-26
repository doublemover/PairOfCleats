#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildIndexSignature } from '../../src/retrieval/index-cache.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'index-signature');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const chunkMetaPath = path.join(tempRoot, 'chunk_meta.json');
const tokenPostingsPath = path.join(tempRoot, 'token_postings.json');
const fileRelationsPath = path.join(tempRoot, 'file_relations.json');

await fsPromises.writeFile(chunkMetaPath, JSON.stringify([{ id: 0, file: 'a.js' }]));
await fsPromises.writeFile(tokenPostingsPath, JSON.stringify({ vocab: [], postings: [], docLengths: [] }));
await fsPromises.writeFile(fileRelationsPath, JSON.stringify([{ file: 'a.js', imports: ['b.js'] }]));

const signatureA = buildIndexSignature(tempRoot);
assert.ok(signatureA, 'Expected initial signature.');

await fsPromises.writeFile(chunkMetaPath, JSON.stringify([{ id: 0, file: 'a.js' }, { id: 1, file: 'b.js' }]));
const signatureB = buildIndexSignature(tempRoot);

assert.notEqual(signatureA, signatureB, 'Expected signature to change when chunk_meta changes.');

await fsPromises.writeFile(fileRelationsPath, JSON.stringify([{ file: 'a.js', imports: ['c.js'] }]));
const signatureC = buildIndexSignature(tempRoot);

assert.notEqual(signatureB, signatureC, 'Expected signature to change when file_relations changes.');

console.log('index signature test passed');

