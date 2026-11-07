import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { parse } from 'acorn';
import { createRepositoryAnswerInput } from '../../helpers/repository-answer-input.js';
import { getOfflineEvaluationAdapter } from '../../../tools/eval/adapters.js';
import { compileRevisionScenario, sealRevisionEdits, revisionScenarioId } from '../../../tools/eval/revisions/scenario.js';
import { evaluateRevisionReference } from '../../../tools/eval/revisions/reference.js';
import { throwIfAborted } from '../../../src/shared/abort.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/revision-oracle/')[1];
assert.ok(['registered-revision-controls', 'independent-seeded-defects', 'provenance-multiplicity', 'scenario-preconditions',
  'unknown-and-budget-outcomes', 'original-execution-handles', 'minimizer-predicate-model'].includes(mode));
const adapter = await getOfflineEvaluationAdapter('finite-positive-support-revisions-v1');
const worldRef = createRepositoryAnswerInput().queryReceipt.world;
const generate = (family, seed = 0) => adapter.generate({ worldRef, family, seed });
const expected = (scenario, checkpoint) => evaluateRevisionReference(compileRevisionScenario(scenario).states[checkpoint]).output;
const fact = (output, id) => output.facts.find(row => row.id === id);
if (mode === 'registered-revision-controls') {
  for (const family of ['join-cross-term', 'recursive-retraction', 'duplicate-supports', 'seeded-rules']) {
    for (const seed of [0, 1, 17, 4294967295]) {
      const scenario = generate(family, seed), run = adapter.run(scenario);
      try {
        const report = adapter.inspect(run);
        assert.equal(report.outcome, 'pass', family + ':' + seed);
        assert.equal(report.checkpoints.length, scenario.revisions.length + 1);
        assert.ok(report.checkpoints.every(row => row.claims.length === 2 && row.claims.every(claim => claim.outcome === 'pass')));
        assert.equal(report.sourceAuthority, 'supplied-model-only'); assert.equal(report.programSemantics, 'not-established');
        assert.match(report.semantics, /not-all-derivations/);
        assert.equal(new Set(report.checkpoints.flatMap(row => [row.candidateExecutionId, row.rebuildExecutionId])).size, report.checkpoints.length * 2);
        assert.equal(report.candidateStrategy, 'existing-complete-declared-model-recomputation');
        assert.deepEqual(scenario, generate(family, seed), 'generator identity and revisions are deterministic');
      } finally { adapter.dispose(run); }
    }
  }
} else if (mode === 'independent-seeded-defects') {
  for (const [family, checkpoint, replacement] of [['join-cross-term', 1, false], ['recursive-retraction', 1, true]]) {
    const scenario = generate(family), output = structuredClone(expected(scenario, checkpoint));
    fact(output, 'P').present = replacement;
    const result = adapter.compareDiagnostic({ scenario, checkpoint, actual: output });
    assert.equal(result.outcome, 'fail'); assert.ok(result.differences.some(row => row.id === 'P'));
    assert.equal(adapter.compareDiagnostic({ scenario, checkpoint, actual: expected(scenario, checkpoint) }).outcome, 'pass');
  }
  const scenario = generate('join-cross-term'), missing = structuredClone(expected(scenario, 1));
  missing.facts = missing.facts.filter(row => row.id !== 'B');
  assert.equal(adapter.compareDiagnostic({ scenario, checkpoint: 1, actual: missing }).outcome, 'fail');
  const extra = structuredClone(expected(scenario, 1)); extra.facts.push({ id: 'phantom', present: true, producers: [] });
  assert.equal(adapter.compareDiagnostic({ scenario, checkpoint: 1, actual: extra }).outcome, 'fail');
} else if (mode === 'provenance-multiplicity') {
  const scenario = generate('duplicate-supports'), first = expected(scenario, 0), second = expected(scenario, 1), third = expected(scenario, 2);
  assert.equal(fact(first, 'A').producers.length, 2); assert.equal(fact(second, 'A').producers.length, 1);
  assert.equal(fact(second, 'P').present, true); assert.equal(fact(third, 'P').present, false);
  const dropped = structuredClone(first); fact(dropped, 'A').producers.pop();
  assert.equal(adapter.compareDiagnostic({ scenario, checkpoint: 0, actual: dropped }).outcome, 'fail');
  const origin = structuredClone(first); fact(origin, 'A').producers[0].originId = 'f'.repeat(64);
  assert.equal(adapter.compareDiagnostic({ scenario, checkpoint: 0, actual: origin }).outcome, 'fail');
  const reordered = structuredClone(first); reordered.facts.reverse(); fact(reordered, 'A').producers.reverse();
  assert.equal(adapter.compareDiagnostic({ scenario, checkpoint: 0, actual: reordered }).outcome, 'pass');
  const run = adapter.run(scenario);
  try { assert.equal(adapter.inspect(run).checkpoints[1].work.truthChanges, 0); assert.equal(adapter.inspect(run).checkpoints[1].work.producerChanges, 1); }
  finally { adapter.dispose(run); }
} else if (mode === 'scenario-preconditions') {
  for (const mutate of [s => { s.revisions[0].beforeId = '0'.repeat(64); }, s => { s.revisions[0].afterId = '0'.repeat(64); },
    s => { s.revisions[0].addSupports.push(s.revisions[0].addSupports[0]); }, s => { s.revisions[0].removeOriginIds = ['0'.repeat(64)]; },
    s => { s.input.definition.rules[0].head = 'A'; }, s => { s.profile = 'shell'; }, s => { s.command = 'node'; },
    s => { s.input.definition.rules[0].body = ['missing']; }, s => { s.revisions[1].id = s.revisions[0].id; }, s => { s.revisions[0].id = 'base'; }]) {
    const scenario = structuredClone(generate('join-cross-term')); mutate(scenario); assert.throws(() => adapter.run(scenario));
  }
  let reads = 0; const value = generate('join-cross-term');
  assert.throws(() => adapter.run({ ...value, get revisions() { reads++; return value.revisions; } })); assert.equal(reads, 0);
  assert.throws(() => generate('anti-join'), /Unsupported/);
  const controller = new AbortController(); controller.abort(null);
  assert.throws(() => adapter.run(value, { signal: controller.signal }), error => error.name === 'AbortError' && error.cause === null);
  const run = adapter.run(value); try { assert.equal(adapter.inspect(run).outcome, 'pass'); } finally { adapter.dispose(run); }
} else if (mode === 'unknown-and-budget-outcomes') {
  const scenario = generate('join-cross-term'), actual = expected(scenario, 1);
  assert.equal(adapter.compareDiagnostic({ scenario, checkpoint: 1, actual: { ...actual, complete: false } }).outcome, 'unknown');
  assert.equal(adapter.compareDiagnostic({ scenario, checkpoint: 1, actual, oracleOptions: { maxValuations: 1 } }).outcome, 'unknown');
  const run = adapter.run(scenario, { maxValuations: 1, maxOutputBytes: 16384 });
  try {
    const report = adapter.inspect(run); assert.equal(report.outcome, 'unknown'); assert.equal(report.checkpoints.length, 4);
    assert.ok(report.checkpoints.every(row => row.outcome === 'unknown')); assert.ok(Buffer.byteLength(JSON.stringify(report)) <= report.bounds.maxOutputBytes);
  } finally { adapter.dispose(run); }
  for (const options of [{ maxMs: 1001 }, { maxValuations: 4097 }, { maxOutputBytes: 1024 }]) assert.throws(() => adapter.run(scenario, options), RangeError);
} else if (mode === 'original-execution-handles') {
  const scenario = generate('recursive-retraction'), run = adapter.run(scenario), report = adapter.inspect(run);
  assert.throws(() => adapter.inspect({ ...run }), { code: 'ERR_REVISION_ORACLE_HANDLE' });
  assert.throws(() => adapter.minimize(run, { checkpointId: 'remove-seed', factId: 'P' }), /no matching independent failure/);
  assert.throws(() => report.checkpoints.push({}), TypeError);
  assert.throws(() => { scenario.revisions[0].beforeId = '0'.repeat(64); }, TypeError);
  assert.equal(adapter.dispose(run).retired, true); assert.throws(() => adapter.inspect(run), { code: 'ERR_REVISION_ORACLE_HANDLE' });
  const next = adapter.run(scenario); try { assert.equal(adapter.inspect(next).outcome, 'pass'); assert.notEqual(next.executionId, run.executionId); } finally { adapter.dispose(next); }
} else {
  // Finite harness model invokes the actual minimizer body with a seeded bad
  // candidate boundary. It does not claim a failure of the current real owner.
  const source = await fs.readFile(new URL('../../../tools/eval/revisions/runner.js', import.meta.url), 'utf8');
  const declarations = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.flatMap(row =>
    (row.type === 'ExportNamedDeclaration' ? row.declaration : row)?.declarations ?? []);
  const node = declarations.find(row => row.id.name === 'minimizeRevisionFailure').init;
  const scenario = generate('join-cross-term'), report = { executionId: 'original', checkpoints: [{ checkpointId: 'simultaneous-inputs',
    claims: [{ tier: 'independent-finite-reference', outcome: 'fail', differences: [{ id: 'P' }] }] }] };
  const original = { compiled: compileRevisionScenario(scenario), receipt: report }, trace = { runs: 0, retired: 0 };
  const minimize = vm.runInNewContext('(' + source.slice(node.start, node.end) + ')', {
    performance, throwIfAborted, sealRevisionEdits, revisionScenarioId, immutable: value => value, get: () => original,
    runRevisionScenario(candidate) { trace.runs++; return { candidate }; },
    readRevisionRun(trial) { return { ...report, executionId: 'trial-' + trace.runs, scenarioId: revisionScenarioId(trial.candidate), outcome: 'fail' }; },
    retireRevisionRun() { trace.retired++; }
  });
  const result = minimize({}, { checkpointId: 'simultaneous-inputs', factId: 'P' });
  assert.equal(result.changed, true); assert.equal(result.scenario.revisions.length, 1); assert.equal(trace.runs, trace.retired);
  assert.equal(scenario.revisions.length, 3, 'original reproducer remains intact');
  assert.equal(result.originalScenarioId, original.compiled.scenarioId);
  assert.ok(result.attempts.every(row => row.accepted));
  assert.equal(compileRevisionScenario(result.scenario).states.length, 2);
  assert.throws(() => minimize({}, { checkpointId: 'simultaneous-inputs', factId: 'missing' }), /no matching independent failure/);
}
console.log('Finite revision harness distinguishes independent correctness, rebuild parity and unqualified outcomes.');
