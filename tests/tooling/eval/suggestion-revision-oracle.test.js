import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parse } from 'acorn';
import { getOfflineEvaluationAdapter } from '../../../tools/eval/adapters.js';
import { compileSuggestionRevisionScenario, sealSuggestionRevisionEdits } from '../../../tools/eval/revisions/suggestion-scenario.js';
import { referenceSuggestionRevision } from '../../../tools/eval/revisions/suggestion-reference.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/suggestion-revision-oracle/')[1];
const families = ['duplicate-retraction', 'negative-reactivation', 'cycle-shortcut', 'node-and-test-replacement', 'seeded-imports'];
const adapter = await getOfflineEvaluationAdapter('finite-import-test-suggestion-revisions-v1');
const generate = (family, seed = 0, repositoryNamespace = 'suggestion-oracle-fixture') => adapter.generate({ repositoryNamespace, family, seed });
const retained = scenario => {
  const handle = adapter.run(scenario);
  try { const receipt = adapter.inspect(handle); assert.equal(receipt.outcome, 'pass'); return receipt; }
  finally { adapter.dispose(handle); }
};
if (families.includes(mode)) {
  for (const seed of [0, 1, 17, 4294967295]) {
    const scenario = generate(mode, seed), receipt = retained(scenario);
    assert.deepEqual(generate(mode, seed), scenario); assert.equal(receipt.checkpoints.length, scenario.revisions.length + 1);
    assert.match(receipt.scope, /no-source-extraction-publication-or-execution-coverage-claim/);
    assert.equal(receipt.consumer, 'buildSuggestTestsReport:1.0.0');
    assert.ok(receipt.checkpoints.every(row => row.claims.every(claim => claim.outcome === 'pass')));
    assert.equal(new Set(receipt.checkpoints.flatMap(row => [row.candidateExecutionId, row.rebuildExecutionId])).size, receipt.checkpoints.length * 2);
    for (const row of receipt.checkpoints) {
      assert.equal(row.work.graphBuilds, 2); assert.equal(row.output.indexSignature.length, 64);
      assert.equal(row.originalEdgeIds.length, row.work.edgeSupports);
      assert.ok(row.work.referenceOperations <= 4096); assert.equal(row.output.complete, true);
    }
    if (mode === 'duplicate-retraction') {
      assert.equal(receipt.checkpoints[0].output.graphRows.length, 2); assert.equal(receipt.checkpoints[1].output.graphRows.length, 2);
      assert.equal(receipt.checkpoints[2].output.graphRows.length, 0); assert.equal(receipt.checkpoints[3].output.graphRows.length, 2);
      assert.notEqual(receipt.checkpoints[0].stateId, receipt.checkpoints[1].stateId, 'logical set parity cannot erase original support identity');
    } else if (mode === 'negative-reactivation') {
      assert.equal(receipt.checkpoints[0].output.graphRows.length, 0); assert.equal(receipt.checkpoints[1].output.graphRows.length, 1);
      assert.equal(receipt.checkpoints[2].output.graphRows.length, 0); assert.equal(receipt.checkpoints[3].output.graphRows.length, 1);
      assert.equal(receipt.checkpoints[4].output.graphRows[0].distance, 0);
    } else if (mode === 'cycle-shortcut') {
      assert.equal(receipt.checkpoints[0].output.graphRows.find(row => row.testPath === 'tests/t1.test.js').distance, 2);
      assert.equal(receipt.checkpoints[1].output.graphRows.find(row => row.testPath === 'tests/t1.test.js').distance, 1);
      assert.equal(receipt.checkpoints[2].output.graphRows.find(row => row.testPath === 'tests/t1.test.js').distance, 2);
    }
  }
} else if (mode === 'independent-seeded-defects') {
  const scenario = generate('cycle-shortcut'), receipt = retained(scenario), correct = receipt.checkpoints[1].output;
  const compare = actual => adapter.compareDiagnostic({ scenario, checkpoint: 1, actual });
  assert.equal(compare(correct).outcome, 'pass');
  const stale = structuredClone(correct), test = stale.graphRows.find(row => row.testPath === 'tests/t1.test.js');
  Object.assign(test, { distance: 2, score: 1 / 3, witnessDistance: 2, witness: ['src/u0.js', 'tests/t0.test.js', 'tests/t1.test.js'] });
  assert.equal(compare(stale).outcome, 'fail', 'a valid longer route cannot impersonate shortest-distance ranking');
  const omitted = structuredClone(correct); omitted.graphRows.pop(); assert.equal(compare(omitted).outcome, 'fail');
  const invented = structuredClone(correct); invented.graphRows[0].witness = ['src/u1.js', invented.graphRows[0].testPath];
  assert.equal(compare(invented).outcome, 'fail', 'names and endpoints alone do not establish original dependency edges');
  const score = structuredClone(correct); score.graphRows[0].score = 1; assert.equal(compare(score).outcome, 'fail');
  const target = structuredClone(correct); target.graphRows[0].witnessTarget = 'src/u1.js'; assert.equal(compare(target).outcome, 'fail');
  const reordered = structuredClone(correct); reordered.graphRows.reverse(); assert.equal(compare(reordered).outcome, 'fail');
  const namespace = generate('cycle-shortcut', 0, 'other-repository');
  assert.equal(adapter.compareDiagnostic({ scenario: namespace, checkpoint: 1, actual: correct }).outcome, 'fail');
  assert.deepEqual(compare(correct), { diagnosticOnly: true, qualifiedExecution: false, outcome: 'pass', reason: null });
} else if (mode === 'stale-negative-and-retracted-witness') {
  const scenario = generate('negative-reactivation'), receipt = retained(scenario), old = structuredClone(receipt.checkpoints[0].output);
  old.indexSignature = receipt.checkpoints[1].output.indexSignature;
  assert.equal(adapter.compareDiagnostic({ scenario, checkpoint: 1, actual: old }).outcome, 'fail', 'the new route reactivates an earlier empty graph result');
  const removed = structuredClone(receipt.checkpoints[1].output); removed.indexSignature = receipt.checkpoints[2].output.indexSignature;
  assert.equal(adapter.compareDiagnostic({ scenario, checkpoint: 2, actual: removed }).outcome, 'fail', 'a retracted original edge cannot support a retained witness');
  const duplicate = generate('duplicate-retraction'), duplicates = retained(duplicate);
  const restored = duplicates.checkpoints[3].output;
  assert.equal(adapter.compareDiagnostic({ scenario: duplicate, checkpoint: 3, actual: restored }).outcome, 'pass');
} else if (mode === 'closed-preconditions-and-original-supports') {
  const scenario = generate('duplicate-retraction');
  for (const field of ['beforeId', 'afterId']) {
    const stale = structuredClone(scenario); stale.revisions[0][field] = 'f'.repeat(64); assert.throws(() => adapter.run(stale));
  }
  const reused = structuredClone(scenario); reused.revisions[2].addEdges[0].to = 'src/u1.js';
  assert.throws(() => sealSuggestionRevisionEdits(reused, reused.revisions), /original edge identity/);
  const absent = structuredClone(scenario); absent.revisions[0].removeEdgeIds = ['absent']; assert.throws(() => sealSuggestionRevisionEdits(absent, absent.revisions));
  const outside = structuredClone(scenario); outside.initial.edges[0].to = 'src/foreign.js'; assert.throws(() => adapter.run(outside));
  const duplicate = structuredClone(scenario); duplicate.initial.edges.push(duplicate.initial.edges[0]); assert.throws(() => adapter.run(duplicate));
  for (const extra of [{ command: 'node' }, { source: 'export const x = 1' }, { candidate: () => ({}) }]) assert.throws(() => adapter.run({ ...scenario, ...extra }));
} else if (mode === 'passive-and-bounded-inputs') {
  const scenario = generate('seeded-imports'); let calls = 0;
  const getter = Object.defineProperty({ ...scenario }, 'initial', { enumerable: true, get() { calls++; return scenario.initial; } });
  assert.throws(() => adapter.run(getter)); assert.equal(calls, 0);
  assert.throws(() => adapter.run(new Proxy(scenario, { ownKeys() { calls++; return []; } }))); assert.equal(calls, 0);
  const tooMany = structuredClone(scenario); tooMany.initial.nodes = Array.from({ length: 13 }, (_, i) => `src/u${i}.js`); assert.throws(() => adapter.run(tooMany));
  for (const options of [{ maxMs: 1001 }, { maxMs: 0 }, { maxReferenceWork: -1 }, { maxReferenceWork: 4097 }, { runtime: {} }, { signal: {} }]) assert.throws(() => adapter.run(scenario, options));
  const compiled = compileSuggestionRevisionScenario(scenario); assert.ok(Object.isFrozen(compiled.scenario.initial.edges[0]));
} else if (mode === 'unknown-and-cancellation') {
  const scenario = generate('cycle-shortcut'), handle = adapter.run(scenario, { maxReferenceWork: 0 });
  try {
    const receipt = adapter.inspect(handle); assert.equal(receipt.outcome, 'unknown'); assert.equal(receipt.checkpoints.length, scenario.revisions.length + 1);
    assert.ok(receipt.checkpoints.every(row => row.claims[0].outcome === 'unknown' && row.claims[1].outcome === 'pass'));
    assert.ok(receipt.checkpoints.every(row => row.referenceOutputId === null && row.work.referenceOperations === 0));
  } finally { adapter.dispose(handle); }
  const receipt = retained(scenario), incomplete = structuredClone(receipt.checkpoints[0].output); incomplete.graphRows.pop(); incomplete.complete = false;
  assert.equal(adapter.compareDiagnostic({ scenario, checkpoint: 0, actual: incomplete }).outcome, 'unknown');
  for (const row of incomplete.graphRows) Object.assign(row, { witness: [], witnessTarget: null, witnessDistance: null });
  assert.equal(adapter.compareDiagnostic({ scenario, checkpoint: 0, actual: incomplete }).outcome, 'unknown', 'an uncompleted witness is not an exact proof or a producer contradiction');
  const controller = new AbortController(); controller.abort(null);
  assert.throws(() => adapter.run(scenario, { signal: controller.signal }), error => error.name === 'AbortError' && error.cause === null);
  const short = adapter.run(scenario, { maxMs: 1 });
  try { assert.equal(adapter.inspect(short).checkpoints.length, scenario.revisions.length + 1); }
  finally { adapter.dispose(short); }
} else if (mode === 'original-handles-and-independent-reference') {
  const scenario = generate('cycle-shortcut'), handle = adapter.run(scenario), receipt = adapter.inspect(handle);
  assert.throws(() => adapter.inspect({ ...handle })); assert.throws(() => adapter.inspect(receipt)); assert.ok(Object.isFrozen(receipt.checkpoints[0].output.graphRows));
  assert.throws(() => adapter.minimize(handle, { checkpointId: 'shortcut' }), /no matching independent failure/);
  const source = await fs.readFile(new URL('../../../tools/eval/revisions/suggestion-reference.js', import.meta.url), 'utf8');
  const imports = parse(source, { sourceType: 'module', ecmaVersion: 'latest' }).body.filter(row => row.type === 'ImportDeclaration').map(row => row.source.value);
  assert.ok(imports.every(value => !/graph\/|suggestion-scenario|suggestion-runner|revisionKey|ordering/.test(value)), 'the independent reference imports no candidate traversal or graph preparation');
  const state = compileSuggestionRevisionScenario(scenario).states[0], result = referenceSuggestionRevision(state);
  assert.deepEqual(result.rows, [{ testPath: 'tests/t0.test.js', distance: 1, score: 0.5 }, { testPath: 'tests/t1.test.js', distance: 2, score: 1 / 3 }]);
  assert.equal(result.operations, state.nodes.length + state.edges.length + state.nodes.length ** 3 + state.testPaths.length);
  const originalId = receipt.executionId; assert.equal(adapter.dispose(handle).executionId, originalId); assert.throws(() => adapter.inspect(handle)); assert.throws(() => adapter.dispose(handle));
} else assert.fail('Select an independently bounded test-suggestion revision case.');
console.log('Real test-suggestion revisions retain original support identities and compare shortest routes with an independent forward matrix.');
