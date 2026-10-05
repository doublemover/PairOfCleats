#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readCrossFileInferenceCache, writeCrossFileInferenceCache } from '../../../../src/index/type-inference-crossfile/cache.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-crossfile-complete-'));
const cachePath = path.join(root, 'output-cache.json');
const inferred = [
  { chunkUid: 'small', codeRelations: { calls: [['small', 'callee']] }, docmeta: null },
  { chunkUid: 'large', codeRelations: null, docmeta: { inferredReturn: 'Int', summary: 'x'.repeat(4096) } }
];
const fresh = () => inferred.map((chunk) => ({ chunkUid: chunk.chunkUid, codeRelations: null, docmeta: null }));
const read = (chunks, options = {}) => readCrossFileInferenceCache({ cachePath, chunks,
  crossFileFingerprint: 'fixture', requireComplete: true, ...options });
try {
  await writeCrossFileInferenceCache({ cacheDir: root, cachePath, chunks: inferred,
    crossFileFingerprint: 'fixture', stats: { inferredReturns: 1 }, maxBytes: 700 });
  const partial = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  assert.equal(partial.admission.droppedRows, 1, 'actual bounded writer retains only one row');
  const cold = fresh();
  const before = structuredClone(cold);
  const logs = [];
  assert.equal(await read(cold, { log: (line) => logs.push(line) }), null,
    'partial output cannot stand in for a full inference result');
  assert.deepEqual(cold, before, 'a declined partial entry cannot contaminate the recomputation input');
  assert.ok(logs.some((line) => line.includes('recomputing inference')));
  const explicitlyPartial = fresh();
  assert.ok(await read(explicitlyPartial, { requireComplete: false }), 'explicit partial API behavior remains available');
  assert.deepEqual(explicitlyPartial[0].codeRelations, inferred[0].codeRelations);
  assert.equal(explicitlyPartial[1].docmeta, null);

  await writeCrossFileInferenceCache({ cacheDir: root, cachePath, chunks: inferred,
    crossFileFingerprint: 'fixture', stats: { inferredReturns: 1 }, maxBytes: 64 * 1024 });
  const full = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  const restored = fresh();
  assert.equal((await read(restored)).inferredReturns, 1);
  assert.deepEqual(restored, inferred, 'complete output retains the existing cache-hit fast path');
  for (const [name, rows] of [
    ['missing row', full.rows.slice(0, 1)],
    ['duplicate row', [full.rows[0], full.rows[0]]],
    ['unknown identity', [full.rows[0], { ...full.rows[1], id: 'unknown' }]],
    ['missing output field', [full.rows[0], { id: full.rows[1].id, codeRelations: null }]]
  ]) {
    await fs.writeFile(cachePath, JSON.stringify({ ...full, admission: null, rows }));
    const untouched = fresh();
    assert.equal(await read(untouched), null, `${name}: claimed full entry is rejected`);
    assert.deepEqual(untouched, fresh(), `${name}: rejection happens before any row mutation`);
  }
  await fs.writeFile(cachePath, JSON.stringify(full));
  const duplicateInputs = [fresh()[0], fresh()[0]];
  assert.equal(await read(duplicateInputs), null, 'duplicate input identities cannot establish complete coverage');
  console.log('Cross-file full-result reuse rejects partial/malformed identity coverage before mutation; complete and explicit partial routes pass.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
