import assert from 'node:assert/strict';
import { buildContextIndex, expandContext } from '../../../src/retrieval/context-expansion.js';
import { createModeExpander } from '../../../src/retrieval/cli/run-search-session/mode-expansion.js';
import { graphRelationsFromEdges } from '../../graph/helpers/graph-fixtures.js';

const count = 256;
const seed = { id: 0, chunkUid: 'seed', file: 'seed.js', name: 'seed', codeRelations: { calls: [['seed', 'common']] } };
const chunks = [seed, ...Array.from({ length: count }, (_, index) => ({ id: index + 1,
  chunkUid: `target-${index}`, file: 'targets.js', name: 'common' }))];
const baseIndex = buildContextIndex({ chunkMeta: chunks, repoMap: [{ name: 'fallback', file: 'targets.js' }] });
const modes = [
  { name: 'import-fallback', fileRelations: new Map([['seed.js', { importLinks: ['targets.js'] }]]),
    options: { includeCalls: false, includeImports: true } },
  { name: 'import-graph', graphRelations: graphRelationsFromEdges({ importEdges: [['seed.js', ['targets.js']]] }),
    options: { includeCalls: false, includeImports: true } },
  { name: 'direct-call-name', options: { includeCalls: true, includeImports: false } },
  { name: 'repository-map', source: { ...seed, codeRelations: { calls: [['seed', 'fallback']] } },
    options: { includeCalls: true, includeImports: false } },
  { name: 'export-name', fileRelations: new Map([['seed.js', { exports: ['common'] }]]),
    options: { includeCalls: false, includeImports: false, includeExports: true } },
  { name: 'usage-name', fileRelations: new Map([['seed.js', { usages: ['common'] }]]),
    options: { includeCalls: false, includeImports: false, includeUsages: true } }
];
const run = (route, options, allowedIds, extra = {}) => {
  const chunkMeta = route.source ? [route.source, ...chunks.slice(1)] : chunks;
  const contextIndex = route.source ? buildContextIndex({ chunkMeta,
    repoMap: [{ name: 'fallback', file: 'targets.js' }] }) : baseIndex;
  return expandContext({ hits: [{ id: 0 }], chunkMeta, contextIndex,
    fileRelations: route.fileRelations, graphRelations: route.graphRelations,
    allowedIds, options: { ...route.options, ...options }, ...extra });
};
const hasCap = (result, cap) => result.stats.truncation?.some(row => row.cap === cap);
for (const route of modes) {
  let probes = 0;
  const rejected = new Set(); rejected.has = () => { probes++; return false; };
  const tiny = run(route, { maxWorkUnits: 5 }, rejected);
  assert.equal(tiny.contextHits.length, 0, route.name);
  assert.ok(probes <= 5, `${route.name}: rejected candidates must consume work before membership/metadata probes`);
  assert.ok(hasCap(tiny, 'maxWorkUnits'), route.name);
  assert.ok(tiny.stats.candidateAttempts <= 5); assert.ok(tiny.stats.candidateVisits <= 5);
  assert.equal(tiny.stats.preparation.contextIndex, 'supplied'); assert.equal(tiny.stats.preparation.scannedChunkRows, 0);
  assert.ok(tiny.stats.truncation.every(row => row.omitted == null), 'unvisited tails are not scanned to fabricate omitted counts');
  const sufficient = run(route, { maxWorkUnits: 10000, maxNameCandidates: 1 }, new Set([count]));
  assert.deepEqual(sufficient.contextHits.map(hit => hit.id), [count], route.name);
  assert.equal(sufficient.stats.truncation, null, 'the eligible-name cap remains independent of rejected scan work');
  const reference = run(route, { maxWorkUnits: 10000, maxNameCandidates: count, includeReasons: true,
    maxPerHit: count, maxTotal: count }, null);
  const bounded = run(route, { maxWorkUnits: 10000, maxNameCandidates: count, includeReasons: true,
    maxPerHit: count, maxTotal: count }, new Set(chunks.map(row => row.id)));
  assert.deepEqual(bounded.contextHits, reference.contextHits, 'sufficient work preserves exact ordered hits and reasons');
}

const imports = modes[0];
for (const budget of [0, 1, 2, 3]) {
  let visits = 0;
  const rejected = new Set(); rejected.has = () => { visits++; return false; };
  const result = run(imports, { maxWorkUnits: budget }, rejected);
  assert.ok(visits <= budget); assert.ok(result.stats.workUnitsUsed <= budget);
  assert.ok(hasCap(result, 'maxWorkUnits'));
}
let clock = 0, clockProbes = 0;
const timedAllowed = new Set(); timedAllowed.has = () => { clock++; clockProbes++; return false; };
const timed = run(imports, { maxWorkUnits: 10000, maxWallClockMs: 1 }, timedAllowed, { now: () => clock });
assert.ok(hasCap(timed, 'maxWallClockMs')); assert.ok(clockProbes <= 16, 'time admission runs inside a single high-fanout edge');
const zeroTime = run(imports, { maxWorkUnits: 10000, maxWallClockMs: 0 }, null);
assert.ok(hasCap(zeroTime, 'maxWallClockMs')); assert.equal(zeroTime.stats.candidateVisits, 0);
const controller = new AbortController(); let cancelProbes = 0;
const canceledAllowed = new Set(); canceledAllowed.has = () => { if (++cancelProbes === 2) controller.abort(); return false; };
assert.throws(() => run(imports, { maxWorkUnits: 10000 }, canceledAllowed, { signal: controller.signal }), { name: 'AbortError' });
assert.equal(cancelProbes, 2); assert.equal(seed.context, undefined);

const adversarial = { ...baseIndex, byFile: new Map(baseIndex.byFile) };
adversarial.byFile.set('targets.js', [0, 1, 1, 999999, ...baseIndex.byFile.get('targets.js')]);
const boundedNoise = run(imports, { maxWorkUnits: 7, maxTotal: count, maxPerHit: count }, null, { contextIndex: adversarial });
assert.ok(hasCap(boundedNoise, 'maxWorkUnits')); assert.ok(boundedNoise.stats.candidateVisits <= 5);
assert.deepEqual(boundedNoise.contextHits.map(hit => hit.id), [1], 'duplicate/primary/missing candidates consume work without new hits');

const emptyBuckets = { ...baseIndex, byDocId: new Map(baseIndex.byDocId),
  repoMapByName: new Map([['fallback', Array.from({ length: count }, (_, index) => `empty-${index}.js`)]]) };
emptyBuckets.byDocId.set(0, modes[3].source);
const emptyResult = run(modes[3], { maxWorkUnits: 4 }, null, { contextIndex: emptyBuckets });
assert.ok(hasCap(emptyResult, 'maxWorkUnits')); assert.ok(emptyResult.stats.nameBucketVisits <= 3);
assert.equal(emptyResult.stats.candidateVisits, 0, 'empty file buckets are separately charged, rather than called candidates');

const idx = { chunkMeta: chunks, fileRelations: imports.fileRelations,
  contextIndex: { ...baseIndex, chunkMeta: chunks, repoMap: undefined } };
const expander = createModeExpander({ contextExpansionEnabled: true, contextExpansionRespectFilters: true,
  filtersActive: true, filters: { file: 'seed.js' }, contextExpansionOptions: { ...imports.options, maxWorkUnits: 5 } });
const first = await expander.expandModeHits('code', idx, [{ id: 0 }]);
assert.ok(hasCap(first, 'maxWorkUnits')); assert.equal(first.stats.candidateVisits <= 5, true);
assert.equal(first.stats.preparation.filterSet.state, 'built');
assert.equal(first.stats.preparation.filterSet.availableChunkRows, count + 1);
assert.equal(first.stats.preparation.filterSet.selectedRows, 1);
const warm = await expander.expandModeHits('code', idx, [{ id: 0 }]);
assert.equal(warm.stats.preparation.filterSet.state, 'reused');
assert.equal(expander.contextExpansionStats.code, warm.stats);
idx.chunkMeta = chunks.map(row => row.id === 7 ? { ...row, file: 'seed.js' } : row);
const replaced = await expander.expandModeHits('code', idx, [{ id: 0 }]);
assert.equal(replaced.stats.preparation.filterSet.state, 'built', 'changed metadata identity invalidates the prepared filter set');
assert.equal(replaced.stats.preparation.filterSet.selectedRows, 2);
console.log('context expansion charges rejected, duplicate, missing and empty-bucket work before scanning');
