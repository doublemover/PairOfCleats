import assert from 'node:assert/strict';
import { getOfflineEvaluationAdapter } from '../../../tools/eval/adapters.js';
import { REVISION_RELATIONAL_VERSION, REVISION_RELATIONAL_PROFILE } from '../../../src/contracts/schemas/revision-relational.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/relational-revision-oracle/')[1];
assert.ok(['actual-registered-operators', 'independent-cross-term-and-threshold-defects', 'multiplicity-and-origin-defects',
  'strict-revision-worlds', 'unknown-reference-budget', 'original-execution-retirement',
  'unary-retractions-and-incomplete-domains', 'unary-independent-mapping-defects'].includes(mode));
const adapter = await getOfflineEvaluationAdapter(REVISION_RELATIONAL_PROFILE);
const world = { generation: { baseBuildId: 'relational-revision-base', semanticRevision: 0 }, repositoryNamespace: 'fixture', contextKey: 'declared-inputs' };
const generate = (family, seed = 0) => adapter.generate({ world, family, seed });
const empty = { capturedDomainComplete: true, unresolvedLeftSupports: 0, rows: [] };
const expected = (scenario, checkpoint) => adapter.compareDiagnostic({ scenario, checkpoint, actual: empty }).expected;
if (mode === 'actual-registered-operators') {
  for (const family of ['join-cross-term', 'anti-join-support-threshold', 'seeded-bags']) for (const seed of [0, 1, 17, 4294967295]) {
    const scenario = generate(family, seed), run = adapter.run(scenario);
    try {
      const report = adapter.inspect(run); assert.equal(report.outcome, 'pass', family + ':' + seed);
      assert.equal(report.checkpoints.length, 4); assert.equal(report.sourceAuthority, 'not-established'); assert.equal(report.semanticClosure, 'not-implied');
      assert.ok(report.checkpoints.every(row => row.claims.length === 2 && row.claims.every(claim => claim.outcome === 'pass')));
      assert.ok(report.checkpoints.every(row => row.candidateRelationRootId === row.rebuildRelationRootId));
      assert.notEqual(report.checkpoints[1].candidateViewRootId, report.checkpoints[1].rebuildViewRootId,
        'private transition ledgers differ; relation content is compared without pretending view roots match');
      assert.deepEqual(scenario, generate(family, seed));
      assert.ok(Buffer.byteLength(JSON.stringify(report)) <= report.limits.receiptBytes);
    } finally { adapter.dispose(run); }
  }
} else if (mode === 'independent-cross-term-and-threshold-defects') {
  const join = generate('join-cross-term');
  assert.equal(adapter.compareDiagnostic({ scenario: join, checkpoint: 1, actual: empty }).outcome, 'fail', 'dropping delta-left × delta-right is detected');
  assert.equal(adapter.compareDiagnostic({ scenario: join, checkpoint: 1, actual: expected(join, 1) }).outcome, 'pass');
  const anti = generate('anti-join-support-threshold'), present = expected(anti, 2);
  assert.ok(present.rows.length);
  assert.equal(adapter.compareDiagnostic({ scenario: anti, checkpoint: 1, actual: present }).outcome, 'fail', '2→1 cannot expose a left key');
  assert.equal(adapter.compareDiagnostic({ scenario: anti, checkpoint: 2, actual: empty }).outcome, 'fail', '1→0 must expose it');
  assert.equal(adapter.compareDiagnostic({ scenario: anti, checkpoint: 3, actual: present }).outcome, 'fail', '0→1 must retract it');
  for (const checkpoint of [0, 1, 2, 3]) assert.equal(adapter.compareDiagnostic({ scenario: anti, checkpoint, actual: expected(anti, checkpoint) }).outcome, 'pass');
} else if (mode === 'multiplicity-and-origin-defects') {
  const scenario = generate('seeded-bags', 17), output = expected(scenario, 1);
  assert.equal(output.rows.length, 2);
  for (const mutate of [value => { value.rows[0].multiplicity = '1'; }, value => { value.rows[0].parents.right.supportId = 'wrong-origin'; },
    value => { value.rows.pop(); }, value => { value.capturedDomainComplete = false; }, value => { value.unresolvedLeftSupports = 1; }]) {
    const wrong = structuredClone(output); mutate(wrong);
    assert.equal(adapter.compareDiagnostic({ scenario, checkpoint: 1, actual: wrong }).outcome, 'fail');
  }
  assert.ok(output.rows.some(row => Number(row.multiplicity) > 1));
} else if (mode === 'strict-revision-worlds') {
  for (const mutate of [s => { s.revisions[0].beforeId = '0'.repeat(64); }, s => { s.revisions[0].afterId = '0'.repeat(64); },
    s => { s.revisions[1].toWorld.contextKey = 'different'; }, s => { s.revisions[1].id = s.revisions[0].id; },
    s => { s.revisions[0].left[0].multiplicity = '-8'; }, s => { s.command = 'node'; }, s => { s.profile = 'shell'; },
    s => { s.initial.left = Array.from({ length: 9 }, (_, index) => ({ occurrenceId: String(index), supportId: String(index), from: 'a', to: 'b', multiplicity: '1', sourceRef: null })); }]) {
    const scenario = structuredClone(generate('join-cross-term')); mutate(scenario); assert.throws(() => adapter.run(scenario));
  }
  let reads = 0; const scenario = generate('join-cross-term');
  assert.throws(() => adapter.run({ ...scenario, get revisions() { reads++; return scenario.revisions; } })); assert.equal(reads, 0);
  assert.throws(() => generate('unregistered'), /Unsupported/);
  const controller = new AbortController(); controller.abort(null);
  assert.throws(() => adapter.run(scenario, { signal: controller.signal }), error => error.name === 'AbortError' && error.cause === null);
} else if (mode === 'unknown-reference-budget') {
  const scenario = generate('join-cross-term'), run = adapter.run(scenario, { maxReferenceWork: 0 });
  try {
    const report = adapter.inspect(run); assert.equal(report.outcome, 'unknown'); assert.equal(report.checkpoints.length, 4);
    assert.equal(report.checkpoints[0].outcome, 'pass'); assert.equal(report.checkpoints[1].outcome, 'unknown');
    assert.equal(report.checkpoints[1].claims[0].reason, 'reference-operation-budget');
    assert.equal(report.checkpoints[1].claims[1].outcome, 'pass', 'rebuild parity cannot substitute for the exhausted independent reference');
  } finally { adapter.dispose(run); }
  for (const options of [{ maxReferenceWork: -1 }, { maxReferenceWork: 4097 }, { maxMs: 1001 }, { maxReferencePairs: 1 }]) assert.throws(() => adapter.run(scenario, options));
} else if (mode === 'unary-retractions-and-incomplete-domains') {
  for (const family of ['group-extremum-retraction', 'selected-duplicate-projection', 'group-partial-domain', 'selected-partial-domain', 'anti-join-partial-domain']) for (const seed of [0, 17, 4294967295]) {
    const scenario = generate(family, seed), run = adapter.run(scenario);
    try {
      const report = adapter.inspect(run); assert.equal(report.schemaVersion, REVISION_RELATIONAL_VERSION); assert.equal(report.outcome, 'pass', family + ':' + seed);
      assert.equal(report.operator, scenario.definition.operator);
      assert.ok(report.checkpoints.every(row => row.outcome === 'pass' && row.candidateRelationRootId === row.rebuildRelationRootId));
      if (family === 'group-partial-domain') {
        assert.equal(expected(scenario, 0).relationCardinality, '0'); assert.ok(Number(expected(scenario, 1).relationCardinality) > 0);
      }
      if (family === 'selected-partial-domain') assert.ok(Number(expected(scenario, 0).relationCardinality) > 0);
    } finally { adapter.dispose(run); }
  }
  await assert.rejects(getOfflineEvaluationAdapter('finite-relational-revisions-v1'), { code: 'ERR_INTERVENTION_ADAPTER_UNAVAILABLE' });
  const stale = structuredClone(generate('join-cross-term')); stale.schemaVersion = 1; stale.profile = 'finite-relational-revisions-v1';
  assert.throws(() => adapter.run(stale), /Invalid/);
} else if (mode === 'unary-independent-mapping-defects') {
  for (const family of ['group-extremum-retraction', 'selected-duplicate-projection', 'group-partial-domain']) {
    const scenario = generate(family, 17), output = expected(scenario, 1);
    const mutations = [value => { value.relationCardinality = '99'; }, value => { value.rows.pop(); },
      value => { value.capturedDomainComplete = !value.capturedDomainComplete; }];
    if (family.startsWith('group-')) mutations.push(value => { value.rows[0].minimum = 'stale-minimum'; },
      value => { value.rows[0].weightedCount = '1'; }, value => { value.rows[0].alternatives[0].supportId = 'wrong-parent'; });
    else mutations.push(value => { value.rows[0].multiplicity = '8'; }, value => { value.rows[0].parent.supportId = 'wrong-parent'; });
    for (const mutate of mutations) {
      const wrong = structuredClone(output); mutate(wrong);
      assert.equal(adapter.compareDiagnostic({ scenario, checkpoint: 1, actual: wrong }).outcome, 'fail', family);
    }
    const unknown = adapter.run(scenario, { maxReferenceWork: 0 });
    try { assert.equal(adapter.inspect(unknown).outcome, 'unknown'); assert.equal(adapter.inspect(unknown).checkpoints[0].claims[1].outcome, 'pass'); }
    finally { adapter.dispose(unknown); }
  }
} else {
  const scenario = generate('anti-join-support-threshold'), first = adapter.run(scenario), receipt = adapter.inspect(first);
  assert.throws(() => adapter.inspect({ ...first }), /Original/); assert.throws(() => receipt.checkpoints.push({}), TypeError);
  assert.throws(() => adapter.minimize(first, { checkpointId: 'one-to-zero' }), /no matching independent failure/);
  assert.equal(adapter.dispose(first).retired, true); assert.throws(() => adapter.inspect(first), /Original/);
  const second = adapter.run(scenario); try { assert.equal(adapter.inspect(second).outcome, 'pass'); assert.notEqual(second.executionId, first.executionId); }
  finally { adapter.dispose(second); }
}
console.log('Registered relational revision runs separate independent tiny-bag truth from rebuild parity and source authority.');
