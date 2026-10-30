import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { createRecoveryFixture, semanticNode, deferred, sha256 } from '../../helpers/semantic-recovery.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { createSemanticTaskId, semanticHash } from '../../../src/index/semantic/identity.js';
import { semanticTaskInputHash } from '../../../src/index/semantic/frontier.js';
import { writeSemanticJson } from '../../../src/index/semantic/disk-writes.js';
import { SEMANTIC_MEMBER_NAMES } from '../../../src/contracts/schemas/semantic-envelopes.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['frontier-order', 'late-completion', 'bad-target'].includes(selected));
const fixture = await createRecoveryFixture('original expression;');
const key = Symbol.for('poc.validated-family-frontier-order');
const state = { lower: 'sy1:' + '1'.repeat(64), upper: 'sy1:' + '2'.repeat(64), upperRead: deferred(), calls: new Map(), frontierOrder: [] };
globalThis[key] = state;
const source = new URL('../../../src/semantic/artifact-store.js', import.meta.url).href;
let failed = false, workError;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/writers/semantic/family.js') && specifier.endsWith('/semantic/artifact-store.js')) {
      return { url: 'validated-family:original-store-order', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url !== 'validated-family:original-store-order') return next(url, context);
    return { format: 'module', shortCircuit: true, source: `
      import {createArtifactSemanticStore as original} from ${JSON.stringify(source)};
      export const createArtifactSemanticStore = options => {
        const base = original(options), state = globalThis[Symbol.for('poc.validated-family-frontier-order')];
        return {...base, async *iterateRows(partitionId, member, readOptions) {
          const key = partitionId+'/'+member;
          state.calls.set(key,(state.calls.get(key)||0)+1);
          if(member==='semantic_frontier'&&partitionId===state.lower)await state.upperRead.promise;
          try {
            for await(const row of base.iterateRows(partitionId,member,readOptions)) {
              if(member==='semantic_frontier')state.frontierOrder.push(partitionId);
              yield row;
            }
          } finally {if(member==='semantic_frontier'&&partitionId===state.upper)state.upperRead.resolve();}
        }};
      };` };
  }
});
try {
  const targetSet = { schemaVersion: 1, generation: fixture.generation, sourceUnits: [fixture.source.sourceUnitId],
    compilerInventory: null, syntaxPartitionRefs: [] };
  const targetSetHash = semanticHash('pairofcleats.semantic.binding-targets.v1', targetSet);
  const targetPath = 'semantic-frontier-targets/' + targetSetHash + '.json';
  await writeSemanticJson({ filename: path.join(fixture.stagingRoot, targetPath), value: targetSet, diskAccount: fixture.account });
  const targetBytes = await fs.readFile(path.join(fixture.stagingRoot, targetPath));
  const task = (input, dependency) => {
    const identity = { kind: 'bind', inputHashes: [input.repeat(64)], policyHash: 'b'.repeat(64), targetSetHash };
    return { schemaVersion: 1, taskId: createSemanticTaskId(identity), ...identity,
      baseBuildId: fixture.generation.baseBuildId, sourceUnits: [fixture.source.sourceUnitId], targetsRef: targetPath,
      dependencies: [{ dependencyKey: 'original-authority', expectedHash: dependency.repeat(64) }],
      priority: 1, reason: 'independent immutable frontier row', coverageToProduce: ['bindings'] };
  };
  const low = [task('a', '1'), task('a', '2'), task('c', '3'), task('c', '4')], high = task('a', '5');
  if (selected === 'bad-target') high.targetSetHash = '0'.repeat(64);
  // A bad target remains a valid canonical task with its own exact task ID.
  if (selected === 'bad-target') high.taskId = createSemanticTaskId({ kind: high.kind,
    inputHashes: high.inputHashes, policyHash: high.policyHash, targetSetHash: high.targetSetHash });
  const first = await fixture.write([semanticNode(0, fixture.source.textLength), ...low.map(row => ({ family: 'frontier', row }))], { partitionId: state.lower });
  const second = await fixture.write([semanticNode(0, fixture.source.textLength), { family: 'frontier', row: high }], { partitionId: state.upper });
  const partitions = [second, first], facts = createSemanticFactsRef({ source: fixture.source, partitions,
    syntaxPartitionId: first.partitionId, storage: { generation: fixture.generation, relativePath: 'semantic' }, coverage: [] });
  const receipts = [high, low[3]].map(value => ({ taskId: value.taskId, baseBuildId: fixture.generation.baseBuildId,
    policyHash: value.policyHash, inputHash: semanticTaskInputHash(value), manifestHash: 'e'.repeat(64), publishedBuildId: 'next' }));
  if (selected === 'late-completion') receipts[0].inputHash = '0'.repeat(64);
  const jobs = [], registered = [], before = fixture.account.used;
  const { enqueueSemanticArtifacts } = await import('../../../src/index/build/artifacts/writers/semantic/family.js');
  enqueueSemanticArtifacts({ state: { semanticFactsByFile: new Map([['original.js', facts]]), semanticDiskAccount: fixture.account,
    semanticFrontierTargets: [{ path: targetPath, bytes: targetBytes.length, hash: sha256(targetBytes) }], semanticCompletedTasks: receipts },
  root: fixture.root, outDir: fixture.root, indexState: { buildId: fixture.generation.baseBuildId }, enabled: true,
  enqueueWrite: (_name, run) => jobs.push(run), addPieceFile: entry => registered.push(entry), declareArtifactFamily() {} });
  assert.equal(jobs.length, 1);
  if (selected === 'frontier-order') {
    await jobs[0]();
    assert.equal(state.frontierOrder[0], state.upper, 'arrival order deliberately opposes original sorted precedence');
    assert.ok(state.frontierOrder.slice(1).every(value => value === state.lower));
    const manifest = JSON.parse(await fs.readFile(path.join(fixture.root, 'semantic_manifest.json'), 'utf8'));
    assert.deepEqual(manifest.completedTasks, receipts, 'higher partition and later same-partition row supply the exact original completion inputs');
    assert.equal(registered.filter(row => row.name === 'semantic_source_text').length, 1);
    assert.equal(registered.filter(row => row.name === 'semantic_query_index').length, 1);
    assert.equal(registered.filter(row => row.name === 'semantic_operation_index').length, 1);
    for (const partition of partitions) for (const member of SEMANTIC_MEMBER_NAMES) assert.equal(state.calls.get(partition.partitionId + '/' + member), 1);
    const disabledRoot = path.join(fixture.root, 'disabled'); await fs.mkdir(disabledRoot);
    const disabledJobs = [];
    enqueueSemanticArtifacts({ state: { semanticDiskAccount: fixture.account }, root: fixture.root, outDir: disabledRoot,
      indexState: { buildId: fixture.generation.baseBuildId }, enabled: false,
      enqueueWrite: (_name, run) => disabledJobs.push(run), addPieceFile() {}, declareArtifactFamily() {} });
    await disabledJobs[0]();
    assert.equal(JSON.parse(await fs.readFile(path.join(disabledRoot, 'semantic_manifest.json'), 'utf8')).status, 'disabled');
    for (const filename of ['semantic_query_index.json', 'semantic_operation_index.json']) {
      const index = JSON.parse(await fs.readFile(path.join(disabledRoot, filename), 'utf8'));
      assert.equal(index.rowCount, 0); assert.deepEqual(index.pieces, []); assert.deepEqual(index.partitionHashes, []);
    }
  } else {
    let rejected = false, failure;
    try { await jobs[0](); } catch (error) { rejected = true; failure = error; }
    if (rejected) observeStorageResource(failure).requireSettled();
    assert.equal(rejected, true);
    assert.match(failure.message, selected === 'late-completion' ? /completion receipt mismatch/ : /frontier target\/generation mismatch/);
    assert.deepEqual(registered, [], 'no family member is registered before all canonical and completion checks settle');
    assert.equal(fixture.account.used, before);
    for (const file of ['semantic_manifest.json', 'semantic_query_index.json', 'semantic_operation_index.json']) {
      await assert.rejects(fs.access(path.join(fixture.root, file)), { code: 'ENOENT' });
    }
    assert.ok(!(await fs.readdir(fixture.stagingRoot)).some(name => /^semantic-(query|operation)-index-/.test(name)));
  }
} catch (error) { failed = true; workError = error; throw error; }
finally {
  state.upperRead.resolve(); hook.deregister(); delete globalThis[key];
  if (failed) observeStorageResource(workError).requireSettled(); await fixture.cleanup();
}
console.log('Actual semantic family ' + selected + ' preserves frontier precedence and full-validation publication fencing.');
