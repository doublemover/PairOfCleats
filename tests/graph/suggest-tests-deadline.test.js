import assert from 'node:assert/strict';
import path from 'node:path';
import { buildSuggestTestsReport } from '../../src/graph/suggest-tests.js';
import { buildGraphIndex } from '../../src/graph/store.js';
import { validateSuggestTests } from '../../src/contracts/validators/analysis.js';
import { graphRelationsFromEdges } from './helpers/graph-fixtures.js';

const repoRoot = path.resolve('virtual-suggestion-repo');
const base = { repoRoot, changed: ['src/app.js'], indexSignature: 'suggestion-deadline-v1',
  now: () => '2026-10-25T00:00:00.000Z' };
const virtualDirectory = ({ advance = () => {}, failRead = null, close = () => {}, names = ['app.test.js', 'other.txt'] } = {}) => {
  let index = 0;
  return {
    readSync: () => {
      advance(); if (failRead) throw failRead;
      const name = names[index++];
      return name ? { name, isDirectory: () => false, isFile: () => true } : null;
    }, closeSync: close
  };
};
const verify = report => {
  const validation = validateSuggestTests(report);
  assert.equal(validation.ok, true, validation.errors.join('; '));
  assert.ok(Buffer.byteLength(JSON.stringify(report)) < 12000, 'small deadline diagnostics stay bounded');
  assert.equal(report.execution.settlement, 'confirmed');
};
let time = 0, opens = 0, closes = 0;
const slow = buildSuggestTestsReport({ ...base, caps: { maxWallClockMs: 10 }, runtime: {
  clock: () => time, openDirectory: () => { opens += 1; return virtualDirectory({
    advance: () => { time += 4; }, close: () => { closes += 1; time += 1; } }); }
} });
verify(slow);
assert.equal(opens, 1); assert.equal(closes, 1);
assert.equal(slow.execution.observed.directoryReads, 3);
assert.equal(slow.execution.observed.inventoryEntries, 2);
assert.equal(slow.execution.phaseAtStop, 'discovery');
assert.equal(slow.execution.elapsedMs, 13); assert.equal(slow.execution.overrunMs, 3);
assert.equal(slow.execution.observed.fallbackChecks, 0);
assert.deepEqual(slow.suggestions, [], 'an incomplete/time-limited directory admits no prefix candidates');
assert.equal(slow.fidelity.state, 'partial');
assert.ok(slow.fidelity.reasonCodes.includes('deadline_exhausted'));
assert.ok(slow.truncation.some(row => row.cap === 'maxWallClockMs' && row.observed === 13));
assert.ok(!slow.warnings.some(row => row.code === 'NO_TESTS_FOUND' || row.code === 'GRAPH_NO_MATCHES'));

// Fresh bounded enumeration is required even when the complete inventory was
// cached under this same generation. It cannot spend an old invocation's time.
for (let request = 0; request < 2; request++) {
  time = 0; opens = 0;
  const fresh = buildSuggestTestsReport({ ...base, caps: { maxWallClockMs: 10 }, runtime: {
    clock: () => time, openDirectory: () => { opens += 1; return virtualDirectory(); }
  } });
  verify(fresh); assert.equal(opens, 1);
  assert.equal(fresh.execution.state, 'complete'); assert.equal(fresh.suggestions[0].testPath, 'app.test.js');
}
time = 0;
const expiredWarm = buildSuggestTestsReport({ ...base, caps: { maxWallClockMs: 10 }, runtime: {
  clock: () => time, openDirectory: () => virtualDirectory({ advance: () => { time += 10; } })
} });
verify(expiredWarm); assert.equal(expiredWarm.execution.observed.directoryReads, 1);
assert.deepEqual(expiredWarm.suggestions, []);

const relations = graphRelationsFromEdges({ importEdges: [
  ['tests/one.test.js', ['src/one.js']], ['tests/two.test.js', ['src/two.js']]
] });
for (const mode of ['raw', 'legacy', 'csr']) {
  time = 0; let neighborCalls = 0;
  const graphIndex = mode === 'raw' ? null : buildGraphIndex({ graphRelations: relations, includeCsr: mode === 'csr' });
  const report = buildSuggestTestsReport({ ...base, changed: ['src/one.js', 'src/two.js'],
    tests: ['tests/one.test.js', 'tests/two.test.js'], graphIndex, graphRelations: relations,
    caps: { maxWallClockMs: 10 }, runtime: { clock: () => time,
      neighbors: ({ getNeighbors }) => { neighborCalls += 1; time += 4; return getNeighbors(); } } });
  verify(report);
  assert.equal(neighborCalls, 3, 'both seeds share one allowance; another neighbor operation cannot start after expiry');
  assert.equal(report.execution.phaseAtStop, 'traversal');
  assert.equal(report.execution.observed.neighborReads, 4);
  assert.equal(report.fidelity.graph.edgesVisited, 2);
  assert.equal(report.execution.observed.fallbackChecks, 0);
  assert.equal(report.fidelity.state, 'partial');
  const complete = buildSuggestTestsReport({ ...base, changed: ['src/one.js', 'src/two.js'],
    tests: ['tests/one.test.js', 'tests/two.test.js'], graphIndex, graphRelations: relations,
    caps: { maxWallClockMs: 10 }, runtime: { clock: () => 0 } });
  verify(complete); assert.equal(complete.fidelity.state, 'complete');
  assert.equal(complete.suggestions.length, 2);
  assert.ok(complete.suggestions.every(row => row.witnessPath.distance === 1));
}
const counted = buildSuggestTestsReport({ ...base, changed: ['src/one.js'], tests: ['tests/one.test.js'], graphRelations: relations,
  caps: { maxWallClockMs: 10, maxEdges: 0 }, runtime: { clock: () => 0 } });
verify(counted); assert.equal(counted.fidelity.graph.edgesVisited, 0);
assert.ok(counted.truncation.some(row => row.cap === 'maxEdges'));
let excludedOpens = 0;
const excluded = buildSuggestTestsReport({ ...base, caps: { maxWallClockMs: 10 }, runtime: {
  clock: () => 0, openDirectory: location => {
    assert.equal(location, repoRoot); excludedOpens += 1;
    const names = ['.cache', '.tmp', 'app.test.js'];
    return { readSync: () => {
      const name = names.shift(); return name ? { name, isDirectory: () => name.startsWith('.'), isFile: () => !name.startsWith('.') } : null;
    }, closeSync() {} };
  }
} });
verify(excluded); assert.equal(excludedOpens, 1); assert.equal(excluded.suggestions.length, 1);
let zeroOpens = 0;
const zero = buildSuggestTestsReport({ ...base, caps: { maxWallClockMs: 0 }, runtime: {
  clock: () => 5, openDirectory: () => { zeroOpens += 1; throw new Error('No zero-budget I/O may start.'); }
} });
verify(zero); assert.equal(zeroOpens, 0); assert.equal(zero.execution.phaseAtStop, 'admission');
assert.equal(zero.provenance.capsUsed.suggestTests.maxWallClockMs, 0);
assert.equal(zero.fidelity.state, 'partial');
for (const invalid of [-1, NaN, Infinity, '10', Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => buildSuggestTestsReport({ ...base, caps: { maxWallClockMs: invalid } }), /maxWallClockMs/);
}
const fractional = buildSuggestTestsReport({ ...base, tests: [], caps: { maxWallClockMs: 2.9 }, runtime: { clock: () => 0 } });
assert.equal(fractional.execution.limitMs, 2); verify(fractional);

// An actual pending-operation observation owns the read and its directory.
// Deadline observation grants no permission to close it or report settlement.
let released = false, pendingCloses = 0;
const pending = Object.freeze(Object.assign(new Error('read still owns native work'), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => released
}));
let failure;
assert.throws(() => buildSuggestTestsReport({ ...base, caps: { maxWallClockMs: 10 }, runtime: {
  clock: () => time, openDirectory: () => virtualDirectory({ failRead: pending,
    advance: () => { time += 20; }, close: () => { pendingCloses += 1; } })
} }), error => { failure = error; return error.cacheOwnershipPending === true; });
assert.equal(pendingCloses, 0); assert.equal(failure.cacheOwnershipReleased(), false);
assert.throws(() => failure.storageSuggestTestsDirectory.release());
assert.equal(pendingCloses, 0);
released = true;
assert.equal(failure.storageSuggestTestsDirectory.release(), true);
assert.equal(pendingCloses, 1); assert.equal(failure.cacheOwnershipReleased(), true);

let closeAttempts = 0;
assert.throws(() => buildSuggestTestsReport({ ...base, caps: { maxWallClockMs: 10 }, runtime: {
  clock: () => 0, openDirectory: () => virtualDirectory({ close: () => { if (++closeAttempts === 1) throw 0; } })
} }), error => { failure = error; return error.cacheOwnershipPending === true; });
assert.equal(failure.cacheOwnershipReleased(), false);
assert.equal(failure.storageSuggestTestsDirectory.release(), true);
assert.equal(closeAttempts, 2); assert.equal(failure.cacheOwnershipReleased(), true);
console.log('Suggestion deadlines bound fresh discovery and shared traversal while preserving native ownership.');
