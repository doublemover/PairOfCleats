#!/usr/bin/env node
import assert from 'node:assert/strict';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { queryRuntimeEvidence, defaultRuntimeQuerySelectors } from '../../../src/index/semantic/runtime/query.js';
import { listRuntimeFamilies } from '../../../src/index/semantic/runtime/families.js';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';

const fixture = await createRuntimeImportFixture();
try {
  const imported = await importRuntimeEvidence(fixture.options());
  const request = { schemaVersion: 1, repositoryNamespace: fixture.capture.repositoryNamespace, generation: fixture.capture.generation,
    familyGenerations: [imported.pointer.generationId], selectors: defaultRuntimeQuerySelectors(),
    limits: { maxRecords: 2, maxBytes: 65536, maxMs: 1000 }, cursor: null };
  const query = value => queryRuntimeEvidence({ destination: fixture.options().destination, request: value });
  const seen = [], cursors = new Set();
  let cursor = null, pages = 0;
  do {
    const result = await query({ ...request, cursor });
    pages += 1; assert.ok(pages <= 4);
    assert.ok(result.observations.length <= 2); assert.ok(result.cost.visitedRecords <= 2);
    seen.push(...result.observations.map(row => row.evidenceId));
    cursor = result.nextCursor;
    if (cursor) { assert.ok(!cursors.has(cursor)); cursors.add(cursor); }
  } while (cursor);
  assert.equal(pages, 4); assert.equal(seen.length, 7); assert.equal(new Set(seen).size, 7);
  const first = await query(request);
  await assert.rejects(query({ ...request, selectors: { ...request.selectors, kinds: ['cpuProfile'] }, cursor: first.nextCursor }), { code: 'ERR_RUNTIME_QUERY_CURSOR' });
  await assert.rejects(query({ ...request, limits: { ...request.limits, maxRecords: 3 }, cursor: first.nextCursor }), { code: 'ERR_RUNTIME_QUERY_CURSOR' });
  await assert.rejects(query({ ...request, cursor: first.nextCursor.slice(0, -1) + '!' }), { code: 'ERR_RUNTIME_QUERY_CURSOR' });
  await assert.rejects(query({ ...request, familyGenerations: ['0'.repeat(64)] }), { code: 'ERR_RUNTIME_FAMILY_UNAVAILABLE' });
  await assert.rejects(query({ ...request, limits: { ...request.limits, maxRecords: 129 } }), { code: 'ERR_RUNTIME_QUERY_CONTRACT' });
  await assert.rejects(query({ ...request, execute: true }), { code: 'ERR_RUNTIME_QUERY_CONTRACT' });
  const small = await query({ ...request, limits: { ...request.limits, maxRecords: 7, maxBytes: 4096 } });
  assert.ok(small.cost.responseBytes <= 4096);
  assert.ok(small.omitted.length > 0); assert.equal(small.status, 'partial');
  assert.ok(small.observations.length < 7); assert.equal(small.nextCursor, null);
  const abort = new AbortController(); abort.abort(new Error('stop saved runtime query'));
  await assert.rejects(queryRuntimeEvidence({ destination: fixture.options().destination, request, signal: abort.signal }), { code: 'ABORT_ERR' });
  const originalNow = Date.now, start = originalNow();
  let clockReads = 0;
  try {
    Date.now = () => start + (clockReads++ ? 1001 : 0);
    const expired = await query(request);
    assert.equal(expired.status, 'partial'); assert.equal(expired.observations.length, 0);
    assert.ok(expired.nextCursor); assert.deepEqual(expired.warnings, ['query_time_allowance_exhausted']);
  } finally { Date.now = originalNow; }
  await importRuntimeEvidence({ ...fixture.options(), capture: { ...fixture.capture, question: 'another saved question' } });
  await assert.rejects(listRuntimeFamilies({ destination: fixture.options().destination, maxScan: 1 }), { code: 'ERR_RUNTIME_QUERY_BUDGET' });
  console.log('runtime pages are bounded, opaque and request-pinned; byte omission, cancellation and discovery bounds are explicit');
} finally { await fixture.cleanup(); }
