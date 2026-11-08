import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getOfflineEvaluationAdapter } from '../../../tools/eval/adapters.js';
import { INDEX_REVISION_PROFILE } from '../../../tools/eval/revisions/index-runner.js';
import { realizeSourceFile } from '../../../tools/eval/revisions/source-scenario.js';
import { referencePublishedSourceRevision } from '../../../tools/eval/revisions/source-reference.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { INDEX_REVISION_RECEIPT_SCHEMA } from '../../../src/contracts/schemas/revision-index.js';
import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';
import { parseProgressEventLine } from '../../../src/shared/cli/progress-events.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/published-index-revision-oracle/')[1];
assert.ok(['closed-preflight', 'edit-only', 'delete-file', 'edit-delete-rename', 'restore-file', 'original-world-rechecks', 'pending-reader-retirement'].includes(mode));
const revisionCheckpoint = { 'edit-only': 1, 'delete-file': 2, 'edit-delete-rename': 3, 'restore-file': 4 }[mode];
const parent = await makeTempDir('poc-index-revision-oracle-'), adapter = await getOfflineEvaluationAdapter(INDEX_REVISION_PROFILE);
const scenario = adapter.generate({ repositoryNamespace: 'published-index-oracle', family: 'edit-delete-rename', seed: 3 });
const open = fs.open, originalHome = process.env.PAIROFCLEATS_HOME;
let handle, recovery, primary, denyClose = false, fileSession = null;
const retainBuildLogs = async workspace => {
  const target = path.resolve('.testLogs', 'published-index-revisions', mode + '-' + process.pid);
  await fs.mkdir(target, { recursive: true });
  const logs = path.join(workspace, 'logs');
  for (const name of await fs.readdir(logs)) {
    assert.match(name, /^\d+\.(command\.json|stdout\.log|stderr\.log)$/);
    const source = path.join(logs, name), stat = await fs.stat(source);
    assert.ok(stat.size <= 1024 * 1024, 'original build logs remain bounded before retention');
    await fs.copyFile(source, path.join(target, name));
  }
};
try {
  if (mode === 'closed-preflight') {
    for (const obsolete of [1, 2]) await assert.rejects(getOfflineEvaluationAdapter('published-javascript-chunk-index-revisions-v' + obsolete),
      { code: 'ERR_INTERVENTION_ADAPTER_UNAVAILABLE' });
    const before = await fs.readdir(parent), controller = new AbortController(); controller.abort(null);
    await assert.rejects(adapter.run(scenario, { parent, signal: controller.signal }), error => error.name === 'AbortError' && error.cause === null);
    for (const options of [{ parent, checkpoints: [1] }, { parent, checkpoints: [0, 0] }, { parent, checkpoints: [0, 17] },
      { parent, maxMs: 30000 }, { parent, maxMs: 0 }, { parent: path.parse(parent).root }, { parent, signal: {} }, { parent, build: () => {} }, { parent, args: ['--rebuild'] }]) {
      await assert.rejects(adapter.run(scenario, options));
    }
    await assert.rejects(adapter.run({ ...scenario, parser: 'acorn' }, { parent }));
    await assert.rejects(adapter.minimize({ executionId: 'copied', scenarioId: 'f'.repeat(64) }, { checkpointId: 'edit-function' }), /Original published-index/);
    let getters = 0; const options = Object.defineProperty({}, 'parent', { enumerable: true, get() { getters++; return parent; } });
    await assert.rejects(adapter.run(scenario, options)); assert.equal(getters, 0);
    const reference = referencePublishedSourceRevision([{ path: 'empty.js', prefix: 'plain', declarations: [] },
      { path: 'comment.js', prefix: 'unicode-crlf', declarations: [] }, { path: 'bom.js', prefix: 'bom', declarations: [] }]);
    assert.deepEqual(reference.output.map(row => row.path), ['comment.js', 'bom.js']);
    assert.ok(reference.output.every(row => row.chunks[0].startLine === 1 && row.chunks[0].endLine === 1));
    const exported = referencePublishedSourceRevision([{ path: 'exported.js', prefix: 'plain',
      declarations: [{ name: 'fn_api', value: 3, exported: true }] }]);
    assert.deepEqual(exported.output[0].chunks, [{ name: 'fn_api', kind: 'FunctionDeclaration', start: 7, end: 38,
      startLine: 1, endLine: 1, text: 'function fn_api() { return 3; }' }]);
    assert.deepEqual(await fs.readdir(parent), before, 'invalid intent performs no source/cache/log writes or builds');
  } else {
    try { handle = await adapter.run(scenario, { parent, checkpoints: revisionCheckpoint ? [0, revisionCheckpoint] : [0] }); }
    catch (error) { recovery = error.sourceIndexRevisionSession; throw error; }
    const receipt = adapter.inspect(handle), workspace = receipt.workspace;
    const diagnostics = path.resolve('.diagnostics', 'published-index-revisions');
    await fs.mkdir(diagnostics, { recursive: true });
    await fs.writeFile(path.join(diagnostics, mode + '.json'), JSON.stringify(receipt, null, 2) + '\n');
    assert.equal(receipt.outcome, 'pass'); assert.equal(receipt.profile, INDEX_REVISION_PROFILE);
    await assert.rejects(adapter.minimize(handle, { checkpointId: receipt.checkpoints.at(-1).checkpointId }), /no matching independent published-index failure/);
    const validate = compileSchema(createAjv({ strict: true, allErrors: true }), INDEX_REVISION_RECEIPT_SCHEMA);
    assert.equal(validate(receipt), true);
    for (const mutate of [value => { value.completeScenarioCoverage = 'yes'; }, value => { value.limits.maxMs = 30000; },
      value => { value.checkpoints[0].candidate.execution.exitCode = -1073741819; }, value => { value.omittedCheckpoints.push(17); },
      value => { value.checkpoints[0].claims[0].tier = 'universal-correctness'; }, value => { value.checkpoints[0].rebuild.extra = true; },
      value => { value.limits.maxConcurrentBuilds = 3; }, value => { value.profile = 'published-javascript-chunk-index-revisions-v2'; }]) {
      const invalid = structuredClone(receipt); mutate(invalid); assert.equal(validate(invalid), false);
    }
    assert.equal(receipt.completeScenarioCoverage, false); assert.equal(Object.isFrozen(receipt.checkpoints[0].claims[0]), true);
    assert.equal(receipt.limits.maxConcurrentBuilds, 2);
    assert.throws(() => adapter.inspect({ ...handle }), /Original/); await assert.rejects(adapter.dispose({ ...handle }), /Original/);
    assert.match(receipt.strategy, /production-default-worker-backend/); assert.match(receipt.scope, /real-stage2-code-publication/);
    assert.equal(receipt.checkpoints.length, revisionCheckpoint ? 2 : 1);
    for (const checkpoint of receipt.checkpoints) {
      assert.ok(checkpoint.claims.every(claim => claim.outcome === 'pass'));
      assert.equal(checkpoint.candidate.outputId, checkpoint.rebuild.outputId, 'stable chunk UIDs, source projections and published tokens are compared exactly');
      assert.notEqual(checkpoint.candidate.indexRoot, checkpoint.rebuild.indexRoot);
      assert.notEqual(checkpoint.candidate.execution.cwd, checkpoint.rebuild.execution.cwd);
      for (const execution of [checkpoint.candidate.execution, checkpoint.rebuild.execution]) {
        assert.equal(execution.exitCode, 0); assert.equal(execution.signal, null);
        assert.equal((await fs.stat(execution.logPrefix + '.stdout.log')).size, execution.stdoutBytes);
        assert.equal((await fs.stat(execution.logPrefix + '.stderr.log')).size, execution.stderrBytes);
        for (const stream of ['stdout', 'stderr']) for (const line of (await fs.readFile(execution.logPrefix + '.' + stream + '.log', 'utf8')).split('\n')) {
          if (!line.trim()) continue;
          const event = parseProgressEventLine(line); assert.ok(event, line);
          assert.ok(!['warn', 'error'].includes(event.level));
          assert.ok(!['failed', 'error', 'cancelled', 'aborted'].includes(event.status));
        }
        assert.ok(!execution.args.includes('--stub-embeddings') && !execution.args.includes('--rebuild'));
      }
    }
    if (revisionCheckpoint) {
      assert.equal(receipt.checkpoints[1].checkpointId, scenario.revisions[revisionCheckpoint - 1].id);
      assert.notEqual(receipt.checkpoints[0].candidate.outputId, receipt.checkpoints[1].candidate.outputId);
      assert.ok(receipt.checkpoints[1].candidate.execution.args.includes('--incremental'));
      assert.equal(receipt.checkpoints[1].rebuild.execution.args.includes('--incremental'), false);
      assert.deepEqual(receipt.omittedCheckpoints, [1, 2, 3, 4].filter(index => index !== revisionCheckpoint));
    } else if (mode === 'original-world-rechecks') {
      const first = adapter.recheck(handle, 0), joined = adapter.recheck(handle, 0); assert.equal(joined, first);
      await assert.rejects(adapter.dispose(handle), { code: 'ERR_REVISION_INDEX_RECHECKS_PENDING' });
      assert.equal((await first).unchanged, true);
      const pointer = receipt.checkpoints[0].rebuild.pointerPath, pointerBytes = await fs.readFile(pointer);
      try {
        await fs.writeFile(pointer, Buffer.concat([pointerBytes, Buffer.from(' ')]));
        await assert.rejects(adapter.recheck(handle, 0), /execution failed|recheck failed|retained/i);
      } finally { await fs.writeFile(pointer, pointerBytes); }
      const source = path.join(receipt.checkpoints[0].rebuild.execution.cwd, scenario.files[0].path), originalSource = realizeSourceFile(scenario.files[0]);
      try {
        await fs.writeFile(source, originalSource.replace('return 3', 'return 9'));
        await assert.rejects(adapter.recheck(handle, 0));
      } finally { await fs.writeFile(source, originalSource); }
      assert.equal((await adapter.recheck(handle, 0)).unchanged, true);
      const marker = path.join(workspace, '.source-index-revision-owner'), markerBytes = await fs.readFile(marker);
      try {
        await fs.writeFile(marker, 'different fixture owner'); await assert.rejects(adapter.dispose(handle));
        assert.equal((await fs.stat(workspace)).isDirectory(), true);
      } finally { await fs.writeFile(marker, markerBytes); }
    } else {
      const source = path.join(receipt.checkpoints[0].rebuild.execution.cwd, scenario.files[0].path);
      const closeFailure = Object.freeze(new Error('original source FileHandle close refused'));
      let intercepted = false, closes = 0;
      denyClose = true;
      fs.open = async (filename, ...args) => {
        const actual = await open(filename, ...args);
        if (filename === source && !intercepted) {
          intercepted = true; const close = actual.close;
          actual.close = function () { assert.equal(this, actual); closes++; if (denyClose) throw closeFailure; return close.call(actual); };
        }
        return actual;
      };
      let failure;
      try { await adapter.recheck(handle, 0); } catch (error) { failure = error; }
      assert.ok(failure); assert.equal(intercepted, true); assert.equal(errorGraphIncludes(failure, closeFailure), true);
      fileSession = getContainedFileSession(failure); assert.ok(fileSession);
      await assert.rejects(adapter.dispose(handle)); assert.equal((await fs.stat(workspace)).isDirectory(), true);
      assert.equal(closes, 1, 'metadata retirement cannot retry the original descriptor close implicitly');
      denyClose = false; await fileSession.releaseAfterClose(); assert.equal(closes, 2); fs.open = open;
    }
    await retainBuildLogs(workspace);
    assert.equal((await adapter.dispose(handle)).retired, true); handle = null;
    await assert.rejects(fs.stat(workspace), { code: 'ENOENT' });
  }
  assert.equal(process.env.PAIROFCLEATS_HOME, originalHome, 'the adapter never mutates its parent environment');
} catch (error) {
  primary = error;
  if (recovery) {
    try { await retainBuildLogs(recovery.root); }
    catch (retention) { throw new AggregateError([error, retention], 'Original revision failure and build-log retention failure.', { cause: error }); }
  }
  throw error;
}
finally {
  denyClose = false; fs.open = open;
  try {
    if (fileSession) await fileSession.releaseAfterClose();
    if (handle) await adapter.dispose(handle); else if (recovery) await recovery.releaseAfterClosure();
    await rmDirRecursive(parent, { retries: 0 });
  } catch (cleanup) { if (primary) throw new AggregateError([primary, cleanup], 'Original published-index fixture failure and cleanup failure.', { cause: primary }); throw cleanup; }
}
console.log('Registered published-index revision cohorts retain actual builds, independent source claims, exact stable identities and original reader retirement.');
