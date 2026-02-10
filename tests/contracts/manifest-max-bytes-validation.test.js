#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../helpers/test-env.js';
import { loadPiecesManifest } from '../../src/shared/artifact-io/manifest.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-manifest-max-bytes-'));
applyTestEnv({ cacheRoot: tempRoot });

const indexDir = path.join(tempRoot, 'index');
const piecesDir = path.join(indexDir, 'pieces');
await fs.mkdir(piecesDir, { recursive: true });
await fs.writeFile(path.join(piecesDir, 'manifest.json'), JSON.stringify({ pieces: [] }, null, 2));

assert.throws(
  () => loadPiecesManifest(indexDir, { maxBytes: '65536', strict: true }),
  /maxBytes must be a finite number/i
);
assert.throws(
  () => loadPiecesManifest(indexDir, { maxBytes: 0, strict: true }),
  /maxBytes must be greater than zero/i
);

const nonStrictManifest = loadPiecesManifest(indexDir, { maxBytes: '65536', strict: false });
assert.ok(nonStrictManifest && Array.isArray(nonStrictManifest.pieces));

const strictManifest = loadPiecesManifest(indexDir, { maxBytes: 65536, strict: true });
assert.ok(strictManifest && Array.isArray(strictManifest.pieces));

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('manifest max-bytes validation test passed');
