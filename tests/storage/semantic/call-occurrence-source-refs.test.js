import assert from 'node:assert/strict';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createCallOccurrenceRefJoin } from '../../../src/index/semantic/call-occurrence-refs.js';

const source = createSemanticSourceSnapshot({ bytes: Buffer.from('alpha(); beta();'), repositoryNamespace: 'fixture',
  path: 'src/calls.scala', language: 'scala' }).manifest;
const partitionId = 'sy1:' + 'a'.repeat(64);
const detail = (start, end) => ({ source: 'tree-sitter', coordinateSystem: 'utf16', start, end,
  semanticRecordRef: { partitionId: 'sy1:' + 'b'.repeat(64), localId: 999 } });
const first = detail(0, 7), second = detail(9, 15), foreign = detail(0, 7), uncertain = detail(1, 6);
const chunks = [{ file: source.path, codeRelations: { callDetails: [first, second, uncertain] } },
  { file: 'other-source.scala', codeRelations: { callDetails: [foreign] } }];
const join = createCallOccurrenceRefJoin({ chunks, source, partitionId });
join.observe({ id: 0, kind: 'expression', span: [0, 7], data: { invocationKind: 'call' } });
join.observe({ id: 1, kind: 'expression', span: [9, 15], data: { invocationKind: null } });
assert.deepEqual(join.finish(), { eligible: 3, linked: 1, ambiguous: 0, unavailable: 2 });
assert.deepEqual(first.semanticRecordRef, { partitionId, localId: 0 }, 'local ID zero remains a valid invocation');
assert.equal(second.semanticRecordRef, undefined, 'non-invocation or stale reference does not acquire authority');
assert.equal(uncertain.semanticRecordRef, undefined, 'overlap cannot stand in for the exact occurrence span');
assert.equal(foreign.semanticRecordRef.localId, 999, 'one source join cannot mutate another source');
const conflict = detail(0, 7);
const ambiguous = createCallOccurrenceRefJoin({ chunks: [{ file: source.path, codeRelations: { callDetails: [conflict] } }], source, partitionId });
for (const id of [0, 1, 0]) ambiguous.observe({ id, kind: 'expression', span: [0, 7], data: { invocationKind: 'call' } });
assert.equal(ambiguous.finish().ambiguous, 1);
assert.equal(conflict.semanticRecordRef, undefined, 'ambiguous retained invocation spans never select an arbitrary node');
const mapped = detail(0, 7), mappedJoin = createCallOccurrenceRefJoin({ chunks: [{ file: source.path, codeRelations: { callDetails: [mapped] } }],
  source: { ...source, mapping: { quality: 'exact' } }, partitionId });
mappedJoin.observe({ id: 0, kind: 'expression', span: [0, 7], data: { invocationKind: 'call' } });
assert.equal(mappedJoin.finish().eligible, 0, 'mapped coordinates require their existing explicit adapter');
console.log('source-qualified call occurrence reference join test passed');
