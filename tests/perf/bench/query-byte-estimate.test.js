#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveBenchQueryByteEstimate } from '../../../tools/bench/language/query-byte-estimate.js';
import { readIndexArtifactBytes } from '../../../src/shared/ops/resource-visibility.js';

process.env.PAIROFCLEATS_TESTING = '1';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-bench-byte-estimate-'));
try {
  await fs.mkdir(path.join(root, 'pieces'));
  await fs.writeFile(path.join(root, 'pieces', 'manifest.json'), JSON.stringify({ pieces: [{ bytes: 3 * 1024 ** 3 }] }));
  const database = path.join(root, 'fixture.db');
  await fs.writeFile(database, Buffer.alloc(192));
  let fallbackCalls = 0;
  const readManifest = () => { fallbackCalls += 1; return readIndexArtifactBytes(root); };
  for (const value of [null, undefined, '', ' ', false, true, [], {}, -1, Infinity, NaN, 'invalid']) {
    assert.equal(await resolveBenchQueryByteEstimate(value, readManifest), 3 * 1024 ** 3,
      'unknown/invalid supplied estimates must read the real manifest instead of coercing to zero');
  }
  assert.equal(fallbackCalls, 12);
  assert.equal(await resolveBenchQueryByteEstimate(null, async () => (await fs.stat(database)).size), 192);
  for (const [value, expected] of [[0, 0], ['0', 0], [192, 192], ['192', 192]]) {
    assert.equal(await resolveBenchQueryByteEstimate(value, () => { throw new Error('explicit estimate must not read fallback'); }), expected);
  }
  assert.equal(await resolveBenchQueryByteEstimate(null, () => null), null, 'missing evidence stays unknown');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Unknown query byte estimates read actual file/manifest evidence; explicit zero remains authoritative.');
