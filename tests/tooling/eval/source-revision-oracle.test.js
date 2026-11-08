import assert from 'node:assert/strict';
import { getOfflineEvaluationAdapter } from '../../../tools/eval/adapters.js';
import { SOURCE_REVISION_PROFILE, SOURCE_REVISION_RECEIPT_SCHEMA } from '../../../src/contracts/schemas/revision-source.js';
import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';
import { compileSourceRevisionScenario } from '../../../tools/eval/revisions/source-scenario.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/source-revision-oracle/')[1];
const adapter = await getOfflineEvaluationAdapter(SOURCE_REVISION_PROFILE);
const generate = (family = 'edit-delete-rename', seed = 0, parser = 'babel', repositoryNamespace = 'source-fixture') => adapter.generate({ repositoryNamespace, family, seed, parser });
const expected = (scenario, checkpoint) => adapter.compareDiagnostic({ scenario, checkpoint, actual: [] }).expected;
const inspect = scenario => {
  const handle = adapter.run(scenario);
  try { return adapter.inspect(handle); } finally { adapter.dispose(handle); }
};
if (mode === 'registered-source-producers') {
  for (const family of ['edit-delete-rename', 'coordinate-prefixes', 'same-text-distinct-paths', 'empty-module-retraction']) {
    for (const parser of ['babel', 'acorn', 'esprima']) {
      const scenario = generate(family, 17, parser), report = inspect(scenario);
      assert.equal(report.outcome, 'pass', family + ':' + parser);
      assert.equal(report.checkpoints.length, scenario.revisions.length + 1);
      assert.ok(report.checkpoints.every(row => row.claims.every(claim => claim.outcome === 'pass')));
      assert.ok(report.checkpoints.every(row => row.candidateOutputId === row.rebuildOutputId && row.candidateOutputId === row.referenceOutputId));
      assert.ok(report.checkpoints.flatMap(row => row.sources).every(source => source.parser.family === parser), 'record the actual parser, not the requested label');
      assert.deepEqual(scenario, generate(family, 17, parser));
      assert.ok(Buffer.byteLength(JSON.stringify(report)) <= report.limits.receiptBytes);
      assert.match(report.scope, /no-execution-or-index-publication/);
    }
  }
  for (const seed of [0, 1, 4294967295]) assert.equal(inspect(generate('edit-delete-rename', seed)).outcome, 'pass');
} else if (mode === 'independent-range-and-content-defects') {
  const scenario = generate('coordinate-prefixes'), correct = expected(scenario, 1);
  assert.equal(adapter.compareDiagnostic({ scenario, checkpoint: 1, actual: correct }).outcome, 'pass');
  for (const mutate of [value => { value[0].chunks[0].start--; }, value => { value[0].chunks[1].end++; },
    value => { value[0].chunks[1].kind = 'FunctionDeclaration'; }, value => { value[0].chunks[0].startLine = 1; },
    value => { value[0].chunks[0].text = 'function fn_wrong() {}'; }, value => { value[0].byteHash = '0'.repeat(64); },
    value => { value[0].chunks[0].name = 'fn_decoy'; }, value => { value[0].chunks.pop(); }]) {
    const wrong = structuredClone(correct); mutate(wrong);
    assert.equal(adapter.compareDiagnostic({ scenario, checkpoint: 1, actual: wrong }).outcome, 'fail');
  }
  assert.ok(correct[0].chunks[1].start > correct[0].chunks[0].end, 'export wrapper is outside the declaration range');
} else if (mode === 'delete-and-rename-retractions') {
  const scenario = generate(), report = inspect(scenario);
  assert.deepEqual(report.checkpoints.map(row => [row.work.parsedFiles, row.work.reusedFiles, row.work.removedFiles]),
    [[2, 0, 0], [1, 1, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]]);
  for (const checkpoint of [1, 2, 3, 4]) {
    assert.equal(adapter.compareDiagnostic({ scenario, checkpoint, actual: expected(scenario, checkpoint - 1) }).outcome, 'fail', 'old content must not survive a revision');
    assert.equal(adapter.compareDiagnostic({ scenario, checkpoint, actual: expected(scenario, checkpoint) }).outcome, 'pass');
  }
  assert.deepEqual(report.checkpoints[3].sources.map(source => source.path), ['src/moved.js']);
  assert.deepEqual(report.checkpoints[4].sources.map(source => source.path), ['src/moved.js', 'src/second.js']);
  assert.equal(inspect(generate('empty-module-retraction')).checkpoints[3].sources.length, 0);
} else if (mode === 'source-coordinate-and-namespace-identity') {
  const scenario = generate('coordinate-prefixes'), rows = inspect(scenario).checkpoints;
  assert.equal(rows[1].sources[0].lineStarts[1] > 1, true);
  assert.ok(rows[1].sources[0].byteLength > rows[1].sources[0].textLength, 'astral prefix uses distinct UTF-8/UTF-16 coordinates');
  assert.equal(expected(scenario, 2)[0].chunks[0].start, 1, 'BOM is retained as a source code unit');
  assert.equal(rows[0].sources[0].sourceUnitId, rows[3].sources[0].sourceUnitId, 'exact restored source identity is stable');
  assert.notEqual(rows[0].sources[0].sourceUnitId, rows[1].sources[0].sourceUnitId);
  const paths = inspect(generate('same-text-distinct-paths')).checkpoints[0].sources;
  assert.equal(paths[0].byteHash, paths[1].byteHash); assert.notEqual(paths[0].sourceUnitId, paths[1].sourceUnitId);
  const other = inspect(generate('coordinate-prefixes', 0, 'babel', 'other-repository')).checkpoints[0].sources[0];
  assert.equal(other.byteHash, rows[0].sources[0].byteHash); assert.notEqual(other.sourceUnitId, rows[0].sources[0].sourceUnitId);
  assert.ok(rows[0].sources[0].declarationIds.every(id => /^jsdecl1:[a-f0-9]{64}$/.test(id)));
} else if (mode === 'strict-source-preconditions') {
  for (const mutate of [s => { s.revisions[0].beforeId = '0'.repeat(64); }, s => { s.revisions[0].afterId = '0'.repeat(64); },
    s => { s.revisions[1].id = s.revisions[0].id; }, s => { s.revisions[0].removePaths.push('absent.js'); },
    s => { s.files.push(s.files[0]); }, s => { s.files[0].declarations.push(s.files[0].declarations[0]); },
    s => { s.files[0].path = '../escape.js'; }, s => { s.files[0].path = 'C:/outside.js'; },
    s => { s.files[0].declarations[0].name = 'fn_inject(){}'; }, s => { s.command = 'node'; },
    s => { s.files[0].source = 'arbitrary source'; }, s => { s.parser = 'unregistered'; }, s => { s.profile = 'shell'; }]) {
    const scenario = structuredClone(generate()); mutate(scenario); assert.throws(() => adapter.run(scenario));
  }
  let reads = 0; const scenario = generate();
  assert.throws(() => adapter.run({ ...scenario, get files() { reads++; return scenario.files; } })); assert.equal(reads, 0);
  assert.throws(() => generate('unsupported'), /Unsupported/);
  assert.throws(() => compileSourceRevisionScenario({ ...scenario, schemaVersion: 0 }));
} else if (mode === 'unknown-reference-bound') {
  const scenario = generate(), handle = adapter.run(scenario, { maxReferenceFiles: 0 });
  try {
    const report = adapter.inspect(handle); assert.equal(report.outcome, 'unknown');
    assert.equal(report.checkpoints.length, scenario.revisions.length + 1);
    assert.ok(report.checkpoints.every(row => row.outcome === 'unknown' && row.claims[0].reason === 'reference-work-budget' && row.claims[1].outcome === 'pass'));
    assert.throws(() => adapter.minimize(handle, { checkpointId: scenario.revisions[0].id }), /no matching independent failure/);
  } finally { adapter.dispose(handle); }
  assert.throws(() => adapter.run(scenario, { maxReferenceFiles: 9 }));
  assert.throws(() => adapter.run(scenario, { maxMs: 1001 }));
} else if (mode === 'original-execution-retirement') {
  const handle = adapter.run(generate()), receipt = adapter.inspect(handle);
  assert.throws(() => adapter.inspect({ ...handle }), /Original/); assert.throws(() => adapter.inspect(receipt), /Original/);
  assert.ok(Object.isFrozen(receipt) && Object.isFrozen(receipt.checkpoints[0].sources[0].parser.options));
  assert.throws(() => adapter.minimize(handle, { checkpointId: 'edit-function' }), /no matching independent failure/);
  assert.equal(adapter.dispose(handle).retired, true); assert.throws(() => adapter.inspect(handle), /Original/);
  assert.throws(() => adapter.dispose(handle), /Original/);
} else if (mode === 'cancellation-and-closed-contracts') {
  const scenario = generate(), controller = new AbortController(); controller.abort(null);
  assert.throws(() => adapter.run(scenario, { signal: controller.signal }), error => error.name === 'AbortError' && error.cause === null);
  assert.throws(() => adapter.run(scenario, { execute: () => {} }));
  const report = inspect(scenario), validate = compileSchema(createAjv({ strict: true, allErrors: true }), SOURCE_REVISION_RECEIPT_SCHEMA);
  assert.equal(validate(report), true);
  for (const mutate of [r => { r.checkpoints[0].sources[0].parser.family = 'requested-not-observed'; },
    r => { r.scope = 'full-index-qualified'; }, r => { r.checkpoints[0].work.nativeQualified = true; },
    r => { r.checkpoints[0].sources[0].declarationIds[0] = 'guessed'; }]) {
    const wrong = structuredClone(report); mutate(wrong); assert.equal(validate(wrong), false);
  }
  const corrupted = structuredClone(expected(scenario, 0)); corrupted[0].chunks[0].start = -1;
  assert.throws(() => adapter.compareDiagnostic({ scenario, checkpoint: 0, actual: corrupted }));
} else throw new Error('Unknown source revision oracle case: ' + mode);
console.log('Source revision oracle case passed: ' + mode);
