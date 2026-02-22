#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writePiecesManifest } from '../../../../src/index/build/artifacts/checksums.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { loadPiecesManifestPieces } from '../../../helpers/pieces-manifest.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'pieces-manifest-precomputed-checksum');
const outDir = path.join(tempRoot, 'index-code');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const piecePath = path.join(outDir, 'chunk_meta.json');
const payload = '[{"id":0,"file":"a.js","start":0,"end":1}]\n';
await fs.writeFile(piecePath, payload, 'utf8');
const checksum = crypto.createHash('sha1').update(payload, 'utf8').digest('hex');

await writePiecesManifest({
  pieceEntries: [{
    type: 'chunks',
    name: 'chunk_meta',
    format: 'json',
    path: 'chunk_meta.json',
    bytes: Buffer.byteLength(payload, 'utf8'),
    checksum: `sha1:${checksum}`
  }],
  outDir,
  mode: 'code',
  indexState: { stage: 'stage1' }
});

const pieces = loadPiecesManifestPieces(outDir);
const entry = pieces.find((piece) => piece?.path === 'chunk_meta.json');
assert.ok(entry, 'expected manifest entry for chunk_meta.json');
assert.equal(entry.checksum, `sha1:${checksum}`, 'expected precomputed checksum to be preserved');
assert.equal(entry.bytes, Buffer.byteLength(payload, 'utf8'), 'expected precomputed bytes to be preserved');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('pieces manifest precomputed checksum test passed');
