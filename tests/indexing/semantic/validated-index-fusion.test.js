import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRecoveryFixture, semanticNode, deferred } from '../../helpers/semantic-recovery.js';
import { writeValidatedSemanticIndexes } from '../../../src/index/build/artifacts/writers/semantic/validated-indexes.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { operationIndexEntries, compareOperationIndexRows } from '../../../src/semantic/operation-index.js';
import { assertSemanticOperationIndex } from '../../../src/contracts/validators/semantic-operation-index.js';
import { SEMANTIC_MEMBER_NAMES } from '../../../src/contracts/schemas/semantic-envelopes.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['parity', 'late-hash', 'late-source', 'late-count', 'late-reference', 'observer-drain', 'abort-drain'].includes(selected));
const fixture = await createRecoveryFixture('original expression;');
const readRows = async (index, root) => {
  const rows = [];
  for (const piece of index.pieces) {
    const bytes = await fs.readFile(path.join(root, piece.path), 'utf8');
    rows.push(...bytes.trim().split('\n').filter(Boolean).map(JSON.parse));
  }
  assert.equal(rows.length, index.rowCount); return rows;
};
const id = digit => 'sy1:' + digit.repeat(64), ref = (partitionId, localId) => ({ partitionId, localId });
const directories = async () => (await fs.readdir(fixture.stagingRoot)).filter(name => /^semantic-(query|operation)-index-/.test(name));
let failed = false, workError;
const confirmedFailure = async (operation, pattern) => {
  let rejected = false, failure;
  try { await operation; } catch (error) { rejected = true; failure = error; }
  if (rejected) observeStorageResource(failure).requireSettled();
  assert.equal(rejected, true); assert.match(failure.message, pattern);
};
try {
  if (selected === 'parity') {
    const a = id('1'), b = id('2'), c = id('3'), rows = [semanticNode(0, fixture.source.textLength),
      { family: 'node', row: { id: 1, kind: 'occurrence', span: [0, 1], scope: null,
        data: { nameId: 0, roles: ['reference'], expression: ref(b, 0), flags: [] } } },
      { family: 'lookup', row: { kind: 'name', id: 0, value: 'original' } },
      { family: 'operand', row: { parent: ref(a, 0), child: ref(b, 0), slot: 'callee', ordinal: 0, flags: [] } },
      ...[ref(a, 0), ref(b, 0)].map((to, index) => ({ family: 'edge', row: {
        id: index, kind: 'references', from: ref(a, 0), to, callSite: null, operandOrdinal: null,
        contextKey: null, condition: null, evidence: null, certainty: 'exact-static' } }))];
    const first = await fixture.write(rows, { partitionId: a });
    const second = await fixture.write([semanticNode(0, fixture.source.textLength),
      { family: 'node', row: { id: 1, kind: 'type', span: [0, 1], scope: null,
        data: { origin: 'declared', textRef: { span: [0, 1] }, compilerContextKey: null, expression: 'string' } } },
      { family: 'node', row: { id: 2, kind: 'literal', span: [0, 1], scope: null,
        data: { literalKind: 'number', textRef: { span: [0, 1] }, scalar: { type: 'number', representation: '42' } } } }
    ], { partitionId: b });
    const ownership = Array.from({ length: 129 }, (_, index) => ({ recordRef: ref(b, 0), chunkUid: 'chunk:' + index, role: 'overlap' }));
    ownership.push({ recordRef: ref(b, 1), chunkUid: 'non-expression', role: 'primary' });
    const third = await fixture.write(ownership.map(row => ({ family: 'ownership', row })), { partitionId: c });
    const partitions = [first, second, third], base = fixture.store(partitions), calls = new Map(), hydrated = deferred();
    let active = 0, peak = 0, canonicalActive = 0, canonicalPeak = 0, sourceChecks = 0, hydrationCalls = 0;
    const batches = [];
    const store = { ...base,
      async *iterateRows(partitionId, member, options) {
        const key = partitionId + '/' + member; calls.set(key, (calls.get(key) || 0) + 1);
        active++; peak = Math.max(peak, active);
        canonicalActive++; canonicalPeak = Math.max(canonicalPeak, canonicalActive);
        try {
          if (partitionId === b && member === 'semantic_records') await hydrated.promise;
          yield* base.iterateRows(partitionId, member, options);
        } finally { active--; canonicalActive--; }
      },
      async getRecords(refs, fields, options) {
        hydrationCalls++; batches.push(refs.length); active++; peak = Math.max(peak, active);
        try { return await base.getRecords(refs, fields, options); }
        finally { active--; hydrated.resolve(); }
      },
      async verifySource(...args) { sourceChecks++; return base.verifySource(...args); }
    };
    let canonicalSettled = false;
    const [query, operation] = await writeValidatedSemanticIndexes({ root: fixture.stagingRoot, generation: fixture.generation,
      partitions, store, diskAccount: fixture.account, afterValidation() {
        assert.equal(active, 0); assert.equal(sourceChecks, 1); canonicalSettled = true;
        for (const partition of partitions) for (const member of SEMANTIC_MEMBER_NAMES) assert.equal(calls.get(partition.partitionId + '/' + member), 1);
      } });
    assert.equal(canonicalSettled, true); assert.ok(canonicalPeak <= 2); assert.ok(peak <= 3);
    assert.equal(hydrationCalls, 2); assert.deepEqual(batches, [128, 2]);
    const actualQuery = await readRows(query, fixture.stagingRoot), actualOperation = await readRows(operation, fixture.stagingRoot);
    assert.equal(actualQuery.filter(row => row.member === 'semantic_edges').length, 3, 'self edge has one owner; distinct edge has both');
    assert.deepEqual(actualQuery.filter(row => row.member === 'semantic_records'), [
      { owner: ref(b, 0), member: 'semantic_records', partitionId: a, rowOrdinal: 1 }
    ], 'skipped expression preserves the original occurrence ordinal');
    assert.deepEqual(actualOperation.filter(row => row.field === 'chunkUid').map(row => row.value).toSorted(),
      ownership.filter(row => row.recordRef.localId === 0).map(row => row.chunkUid).toSorted(), 'qualified cross-partition expression kinds, not seen-row guesses');
    assert.equal(actualOperation.filter(row => row.field === 'typeExpression').length, 1);
    assert.equal(actualOperation.filter(row => row.field === 'literalValue').length, 1);
    const referenceRoot = path.join(fixture.root, 'sequential'), common = { root: referenceRoot, generation: fixture.generation,
      partitions, store: base, diskAccount: fixture.account, batchRows: 512, batchBytes: 1048576, maxOpenRuns: 8 };
    const referenceQuery = await writeSemanticQueryIndex(common);
    const referenceOperation = await writeSemanticQueryIndex({ ...common, entries: operationIndexEntries(base, partitions),
      compareRows: compareOperationIndexRows, keyForRow: row => row, validateIndex: assertSemanticOperationIndex,
      directoryPrefix: 'semantic-operation-index-', schemaVersion: 2 });
    assert.deepEqual(actualQuery, await readRows(referenceQuery, referenceRoot));
    assert.deepEqual(actualOperation, await readRows(referenceOperation, referenceRoot));
    for (const [actual, reference] of [[query, referenceQuery], [operation, referenceOperation]]) {
      assert.deepEqual(actual.partitionHashes, reference.partitionHashes);
      assert.deepEqual(actual.pieces.map(({ hash, offsetsHash, count, bytes }) => ({ hash, offsetsHash, count, bytes })),
        reference.pieces.map(({ hash, offsetsHash, count, bytes }) => ({ hash, offsetsHash, count, bytes })));
    }
    const empty = await writeValidatedSemanticIndexes({ root: fixture.stagingRoot, generation: fixture.generation,
      partitions: [], store: { iterateRows() { throw new Error('empty inventory must not admit a reader'); } }, diskAccount: fixture.account });
    for (const index of empty) { assert.equal(index.rowCount, 0); assert.deepEqual(index.pieces, []); assert.deepEqual(index.partitionHashes, []); }
  } else if (selected.startsWith('late-')) {
    const own = fixture.partitionId;
    const rows = Array.from({ length: 180 }, (_, index) => semanticNode(index, fixture.source.textLength));
    rows.push(...Array.from({ length: 600 }, (_, index) => ({ family: 'operand', row: {
      parent: ref(own, 0), child: selected === 'late-reference' && index === 599 ? ref(id('f'), 0) : ref(own, 1),
      slot: 'argument', ordinal: index, flags: [] } })));
    rows.push({ family: 'coverage', row: { scope: { sourceUnitId: fixture.source.sourceUnitId }, phase: 'syntax', state: 'partial',
      reason: 'independent late validation', observedCount: 180, completedCount: 0, frontierRef: null } });
    const partition = await fixture.write(rows), before = fixture.account.used;
    if (selected === 'late-hash') partition.canonicalHash = '0'.repeat(64);
    if (selected === 'late-source') {
      const bytes = Buffer.from(fixture.bytes); bytes[0] ^= 1;
      await fs.writeFile(path.join(fixture.stagingRoot, 'semantic-sources', fixture.source.byteHash + '.utf8'), bytes);
    }
    const base = fixture.store([partition]), visited = new Set();
    const store = { ...base, async *iterateRows(partitionId, member, options) {
      visited.add(member);
      for await (const row of base.iterateRows(partitionId, member, options)) {
        if (selected !== 'late-count' || member !== 'semantic_coverage') yield row;
      }
    } };
    let admittedSpills = false, finalChecks = false;
    const operation = writeValidatedSemanticIndexes({ root: fixture.stagingRoot, generation: fixture.generation,
      partitions: [partition], store, diskAccount: fixture.account, onValidatedRow: async ({ member, rowOrdinal }) => {
        if (member === 'semantic_operands' && rowOrdinal === 598) {
          const owned = await directories(); assert.equal(owned.length, 2);
          for (const name of owned) assert.ok((await fs.readdir(path.join(fixture.stagingRoot, name))).some(child => child.includes('query-index')),
            'both original collectors spilled before the late refusal');
          admittedSpills = true;
        }
      }, afterValidation() { finalChecks = true; } });
    const expected = { 'late-hash': /canonical content hash mismatch/, 'late-source': /Retained semantic source/,
      'late-count': /Semantic count mismatch/, 'late-reference': /Dangling semantic reference/ }[selected];
    await confirmedFailure(operation, expected);
    assert.equal(admittedSpills, true); assert.equal(finalChecks, false); assert.equal(fixture.account.used, before);
    assert.deepEqual(await directories(), []); assert.ok(visited.has('semantic_records'));
  } else {
    const partitions = [];
    for (const digit of ['1', '2', '3', '4']) partitions.push(await fixture.write([semanticNode(0, fixture.source.textLength)], { partitionId: id(digit) }));
    const base = fixture.store(partitions), entered = deferred(), release = deferred(), sawFailure = deferred();
    const failure = Object.freeze(new Error('original sibling canonical read failed')), controller = new AbortController();
    const abortReason = Object.freeze(new Error('original abort while projection owns work'));
    const closed = new Set(), admitted = new Set(); let held = false, settled = false, active = 0;
    const store = { ...base, async *iterateRows(partitionId, member, options) {
      if (member === 'semantic_sources') admitted.add(partitionId);
      active++;
      try {
        if (partitionId === partitions[1].partitionId && member === 'semantic_sources') {
          await entered.promise;
          if (selected === 'observer-drain') { sawFailure.resolve(); throw failure; }
          controller.abort(abortReason); sawFailure.resolve();
        }
        yield* base.iterateRows(partitionId, member, options);
      } finally { active--; closed.add(partitionId + '/' + member); }
    } };
    const before = fixture.account.used;
    const operation = writeValidatedSemanticIndexes({ root: fixture.stagingRoot, generation: fixture.generation,
      partitions, store, diskAccount: fixture.account, signal: controller.signal, async onValidatedRow() {
        if (!held) { held = true; entered.resolve(); await release.promise; }
      } }).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    try {
      await sawFailure.promise; await new Promise(resolve => setImmediate(resolve));
      assert.equal(settled, false); assert.ok(active > 0); assert.equal((await directories()).length, 2);
      assert.equal(admitted.has(partitions[2].partitionId), false, 'no third canonical reader is admitted behind a failure');
    } finally { release.resolve(); }
    const result = await operation;
    assert.ok(errorGraphIncludes(result.error, selected === 'observer-drain' ? failure : abortReason));
    assert.equal(active, 0); assert.ok(closed.size >= 2); assert.equal(fixture.account.used, before);
    assert.deepEqual(await directories(), []);
  }
} catch (error) { failed = true; workError = error; throw error; }
finally { if (failed) observeStorageResource(workError).requireSettled(); await fixture.cleanup(); }
console.log('Validated index fusion ' + selected + ' retains canonical facts, bounded hydration and original settlement.');
