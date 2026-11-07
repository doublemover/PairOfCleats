import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { queryRuntimeEvidence, defaultRuntimeQuerySelectors } from '../../../src/index/semantic/runtime/query.js';
import { assertRuntimeQuery } from '../../../src/contracts/validators/runtime-query.js';
import { runtimeByteHash } from '../../../src/index/semantic/runtime/raw-store.js';

const fixture = await createRuntimeImportFixture();
const originalPrepare = Database.prototype.prepare;
let sourcePredicates = 0;
try {
  const first = await importRuntimeEvidence(fixture.options());
  const a = { sourceUnitId: fixture.source.sourceUnitId, byteHash: fixture.source.byteHash };
  const b = { sourceUnitId: 'su1:' + 'b'.repeat(64), byteHash: 'c'.repeat(64) };
  const second = await importRuntimeEvidence({ ...fixture.options(), capture: { ...fixture.capture,
    sources: [a, b], question: 'same saved observations; another source inventory' } });
  const partialOptions = fixture.options();
  partialOptions.capture = structuredClone(fixture.capture);
  partialOptions.capture.captureId = 'excluded-partial'; partialOptions.capture.completion = 'partial';
  partialOptions.capture.rawArtifacts.forEach(row => { row.captureId = 'excluded-partial'; });
  partialOptions.authority = { ...partialOptions.authority, captureId: 'excluded-partial' };
  const excluded = await importRuntimeEvidence(partialOptions);
  const generations = [first.pointer.generationId, second.pointer.generationId];
  const request = { schemaVersion: 1, repositoryNamespace: fixture.capture.repositoryNamespace,
    generation: fixture.capture.generation, familyGenerations: generations, selectors: defaultRuntimeQuerySelectors(),
    limits: { maxRecords: 32, maxBytes: 65536, maxMs: 1000 }, cursor: null };
  const query = changes => queryRuntimeEvidence({ destination: fixture.options().destination, request: { ...request, ...changes } });
  const oracle = new Map();
  for (const generationId of generations) {
    const bytes = await fs.readFile(path.join(fixture.options().destination, 'generations', generationId, 'evidence.jsonl'));
    oracle.set(generationId, new Map(bytes.toString('utf8').trimEnd().split('\n').map(line => {
      const row = JSON.parse(line); return [row.evidenceId, { row, hash: runtimeByteHash(Buffer.from(line + '\n')) }];
    })));
  }
  const resolve = (page, occurrence) => {
    const family = page.pinnedFamilies[occurrence.reference.family];
    const saved = oracle.get(family.generationId).get(occurrence.evidenceId);
    assert.equal(occurrence.captureId, family.captureId);
    assert.equal(occurrence.reference.rowHash, saved.hash);
    const { reference, ...raw } = occurrence;
    assert.deepEqual(raw, saved.row);
    assert.match(family.manifestHash, /^[a-f0-9]{64}$/);
    return family.generationId + ':' + occurrence.evidenceId + ':' + reference.rowHash;
  };
  Database.prototype.prepare = function(sql) {
    const statement = originalPrepare.call(this, sql);
    if (!sql.startsWith('SELECT count(*) AS count FROM evidence INDEXED BY evidence_source')) return statement;
    assert.ok(sql.includes('source_unit_id=? AND source_hash=?'));
    return new Proxy(statement, { get(target, property) {
      if (property === 'get') return (...args) => { sourcePredicates++; assert.equal(args.length, 2); return target.get(...args); };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  for (const sources of [[b], [a, b], [b, a], [{ ...a, byteHash: 'd'.repeat(64) }]]) {
    sourcePredicates = 0;
    const page = await query({ selectors: { ...request.selectors, sources } });
    assert.equal(page.status, 'partial');
    assert.equal(page.cost.sourcePredicates, sources.length * 2); assert.equal(sourcePredicates, page.cost.sourcePredicates);
    assert.equal(page.cost.hydratedRecords, page.observations.length);
    assert.ok(page.observations.every(row => sources.some(source => row.join.sourceUnitId === source.sourceUnitId && row.join.sourceHash === source.byteHash)));
    const hasA = sources.includes(a);
    assert.equal(page.observations.length, hasA ? 12 : 0, 'OR selection retains only the actual matching source observations');
    for (const [index, coverage] of page.coverage.entries()) {
      assert.equal(coverage.sourceJoinCountsScope, 'family'); assert.equal(coverage.sourceJoinCounts.exactSource, 6);
      const absent = coverage.requestedSources.find(source => source.sourceUnitId !== a.sourceUnitId || source.byteHash !== a.byteHash);
      assert.equal(absent.retainedExactCount, 0); assert.equal(absent.executionCoverage, 'unknown');
      assert.equal(absent.state, absent.sourceUnitId === b.sourceUnitId && index === 1
        ? 'no-retained-exact-observations' : 'absent-from-snapshot');
      assert.equal(coverage.requestedSources.length, sources.length);
    }
  }
  const all = await query({});
  const expectedOccurrences = all.observations.map(row => resolve(all, row));
  assert.equal(all.observations.length, 14);
  assert.equal(new Set(all.observations.map(row => row.evidenceId)).size, 7, 'logical IDs remain stable across metadata-only projections');
  assert.equal(new Set(expectedOccurrences).size, 14, 'each immutable projection remains separately qualified');
  for (const explanation of all.explanations) {
    const ref = explanation.evidenceRefs[0];
    assert.ok(all.observations.some(row => row.evidenceId === ref.evidenceId && row.reference.family === ref.family && row.reference.rowHash === ref.rowHash));
  }
  const reverse = await query({ familyGenerations: [...generations].reverse() });
  assert.deepEqual(new Set(reverse.observations.map(row => resolve(reverse, row))), new Set(expectedOccurrences));
  const seen = [], stableCoverage = [];
  let cursor = null;
  do {
    const page = await query({ selectors: { ...request.selectors, sources: [a, b] },
      limits: { ...request.limits, maxRecords: 2 }, cursor });
    cursor = page.nextCursor;
    assert.equal(page.status, 'partial'); seen.push(...page.observations.map(row => resolve(page, row)));
    if (!stableCoverage.length) stableCoverage.push(...page.coverage);
    else assert.deepEqual(page.coverage, stableCoverage, 'coverage qualifies the pinned selector, independent of page contents');
  } while (cursor);
  assert.equal(seen.length, 12); assert.equal(new Set(seen).size, 12);
  const filtered = await query({ familyGenerations: [...generations, excluded.pointer.generationId],
    selectors: { ...request.selectors, captureIds: [fixture.capture.captureId], sources: [a] } });
  assert.equal(filtered.status, 'complete', 'an excluded partial family cannot change the selected scope verdict');
  assert.equal(filtered.coverage[2].selected, false);
  assert.equal(filtered.coverage[2].requestedSources[0].state, 'not-selected');
  assert.equal(filtered.coverage[2].requestedSources[0].retainedExactCount, null);
  assert.equal(filtered.cost.sourcePredicates, 2);
  for (const mutate of [page => { page.observations[0].reference.family = 31; },
    page => { page.explanations[0].evidenceRefs[0].rowHash = '0'.repeat(64); },
    page => { page.coverage[0].requestedSources[1].state = 'retained-exact-observations'; }]) {
    const invalid = structuredClone(await query({ selectors: { ...request.selectors, sources: [a, b] } }));
    mutate(invalid); assert.throws(() => assertRuntimeQuery('result', invalid), { code: 'ERR_RUNTIME_QUERY_CONTRACT' });
  }
  const secondRows = [...oracle.get(generations[1]).values()];
  const evidenceId = secondRows[0].row.evidenceId;
  const filename = path.join(fixture.options().destination, 'generations', generations[1], 'evidence.jsonl');
  const original = await fs.readFile(filename), changed = Buffer.from(original); changed[0] ^= 1;
  await fs.writeFile(filename, changed);
  try {
    await assert.rejects(query({ selectors: { ...request.selectors, evidenceIds: [evidenceId] } }),
      { code: 'ERR_RUNTIME_IMPORT_INTEGRITY' }, 'an intact duplicate cannot hide a corrupt sibling projection');
  } finally { await fs.writeFile(filename, original); }
} finally {
  Database.prototype.prepare = originalPrepare;
  await fixture.cleanup();
}
console.log('Runtime source coverage stays selector-local; repeated logical observations retain immutable family/row ownership.');
