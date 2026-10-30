import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { createRecoveryFixture, semanticNode, deferred } from '../../helpers/semantic-recovery.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { operationIndexEntries, compareOperationIndexRows } from '../../../src/semantic/operation-index.js';
import { assertSemanticOperationIndex } from '../../../src/contracts/validators/semantic-operation-index.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['parity', 'failure-drain'].includes(selected));
const originalFailure = Object.freeze(new Error('original operation-index producer refused'));
const key = Symbol.for('poc.derived-index-composition');
const state = { calls: [], entered: deferred(), release: deferred(), failure: selected === 'failure-drain', originalFailure };
globalThis[key] = state;
const source = new URL('../../../src/index/build/artifacts/writers/semantic/query-index.js', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/writers/semantic/family.js') && specifier === './query-index.js') {
      return { url: 'derived-index:observed-owner', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url !== 'derived-index:observed-owner') return next(url, context);
    return { format: 'module', shortCircuit: true, source: `
      import { writeSemanticQueryIndex as original } from ${JSON.stringify(source)};
      export async function writeSemanticQueryIndex(options) {
        const state = globalThis[Symbol.for('poc.derived-index-composition')];
        const operation = options.directoryPrefix === 'semantic-operation-index-';
        state.calls.push({operation,batchRows:options.batchRows,batchBytes:options.batchBytes,maxOpenRuns:options.maxOpenRuns});
        if (operation && state.failure) throw state.originalFailure;
        if (!operation) { state.entered.resolve(); await state.release.promise; }
        return original(options);
      }` };
  }
});
const fixture = await createRecoveryFixture('original expression;');
let operation;
try {
  const ref = localId => ({ partitionId: fixture.partitionId, localId });
  const partition = await fixture.write([semanticNode(0, fixture.source.textLength), semanticNode(1, fixture.source.textLength),
    { family: 'operand', row: { parent: ref(0), child: ref(1), slot: 'callee', ordinal: 0, flags: [] } }]);
  const facts = createSemanticFactsRef({ source: fixture.source, partitions: [partition], syntaxPartitionId: partition.partitionId,
    storage: { generation: fixture.generation, relativePath: 'semantic' }, coverage: [] });
  const jobs = [], pieces = [];
  const { enqueueSemanticArtifacts } = await import('../../../src/index/build/artifacts/writers/semantic/family.js');
  enqueueSemanticArtifacts({ state: { semanticFactsByFile: new Map([['original.js', facts]]), semanticDiskAccount: fixture.account },
    root: fixture.root, outDir: fixture.root, indexState: { buildId: fixture.generation.baseBuildId }, enabled: true,
    enqueueWrite: (_label, job) => jobs.push(job), addPieceFile: entry => pieces.push(entry), declareArtifactFamily() {} });
  assert.equal(jobs.length, 1);
  let settled = false;
  operation = jobs[0]().then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  await state.entered.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.calls.length, 2, 'both independent producers are admitted before the held original completes');
  assert.equal(settled, false, 'a sibling refusal cannot release the held original producer');
  for (const call of state.calls) assert.equal(call.batchBytes, 1048576, 'valid original-size rows retain their full allowance');
  for (const [field, total] of [['batchRows', 1024], ['batchBytes', 2097152], ['maxOpenRuns', 16]]) {
    assert.ok(state.calls.reduce((sum, call) => sum + call[field], 0) <= total, field + ' stays within the bounded combined budget');
  }
  state.release.resolve();
  const result = await operation;
  if (state.failure) {
    assert.ok(errorGraphIncludes(result.error, originalFailure));
    assert.equal(pieces.some(piece => ['semantic_query_index', 'semantic_operation_index'].includes(piece.name)), false);
    await assert.rejects(fs.access(path.join(fixture.root, 'semantic_query_index.json')), { code: 'ENOENT' });
  } else {
    assert.equal(result.error, undefined);
    const store = fixture.store([partition]), reference = path.join(fixture.root, 'reference');
    const common = { root: reference, generation: fixture.generation, partitions: [partition], store, diskAccount: fixture.account };
    const expectedQuery = await writeSemanticQueryIndex(common);
    const expectedOperation = await writeSemanticQueryIndex({ ...common, entries: operationIndexEntries(store, [partition]),
      compareRows: compareOperationIndexRows, keyForRow: row => row, validateIndex: assertSemanticOperationIndex,
      directoryPrefix: 'semantic-operation-index-', schemaVersion: 2 });
    const readRows = async (index, root) => {
      const rows = [];
      for (const piece of index.pieces) {
        const text = await fs.readFile(path.join(root, piece.path), 'utf8');
        rows.push(...text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
      }
      assert.equal(rows.length, index.rowCount); return rows;
    };
    for (const [filename, expected] of [['semantic_query_index.json', expectedQuery], ['semantic_operation_index.json', expectedOperation]]) {
      const actual = JSON.parse(await fs.readFile(path.join(fixture.root, filename), 'utf8'));
      assert.deepEqual(await readRows(actual, fixture.stagingRoot), await readRows(expected, reference), filename);
    }
  }
} finally {
  state.release.resolve(); await operation;
  hooks.deregister(); delete globalThis[key]; await fixture.cleanup();
}
console.log('Derived semantic indexes preserve exact sequential rows, aggregate budgets and original sibling settlement.');
