import assert from 'node:assert/strict';
import { mergeIndexInput } from '../../../src/index/build/piece-assembly/merge.js';

const fixture = () => ({ state: { chunks: [], docLengths: [], totalTokens: 0 }, mergeState: {
  usedChunkUids: new Set(), mergedCallSites: [], mergedTokenPostings: new Map(), mergedFieldPostings: new Map(),
  mergedFieldDocLengths: new Map(), mergedPhrasePostings: new Map(), mergedChargramPostings: new Map()
} });
const relations = target => ({ callLinks: [{ to: { resolved: { chunkUid: target } } }],
  usageLinks: [{ ref: { resolved: { chunkUid: target } } }], callDetails: [{ targetChunkUid: target }] });
const piece = order => ({ chunkMeta: order.map(uid => ({ chunkUid: uid, metaV2: { chunkUid: uid },
  codeRelations: relations(uid === 'A' ? 'B' : 'A') })), tokenPostings: { docLengths: order.map(() => 1) },
  callSites: [{ callerChunkUid: 'A', targetChunkUid: 'B' }],
  riskFlows: [{ source: { chunkUid: 'A' }, sink: { chunkUid: 'B' }, path: { chunkUids: ['A', 'B'] },
    evidence: { callSitesByStep: [[{ targetChunkUid: 'B', details: { targetChunkUid: 'B' } }]] } }] });
for (const order of [['A', 'B'], ['B', 'A']]) {
  const { state, mergeState } = fixture();
  mergeIndexInput({ input: piece(order), dir: 'first', state, mergeState });
  mergeIndexInput({ input: piece(order), dir: 'second', state, mergeState });
  for (const chunk of state.chunks.slice(2)) {
    const expected = chunk.chunkUid === 'A:ord2' ? 'B:ord2' : 'A:ord2';
    assert.equal(chunk.metaV2.chunkUid, chunk.chunkUid);
    assert.equal(chunk.codeRelations.callLinks[0].to.resolved.chunkUid, expected);
    assert.equal(chunk.codeRelations.usageLinks[0].ref.resolved.chunkUid, expected);
    assert.equal(chunk.codeRelations.callDetails[0].targetChunkUid, expected);
  }
  assert.deepEqual(mergeState.mergedCallSites[1], { callerChunkUid: 'A:ord2', targetChunkUid: 'B:ord2' });
  const flow = state.riskFlows[1];
  assert.deepEqual(flow.path.chunkUids, ['A:ord2', 'B:ord2']);
  assert.equal(flow.evidence.callSitesByStep[0][0].details.targetChunkUid, 'B:ord2');
  assert.equal(flow.source.chunkUid, 'A:ord2');
  assert.equal(flow.sink.chunkUid, 'B:ord2');
  const self = { chunkMeta: [{ chunkUid: 'A', codeRelations: relations('A') }], tokenPostings: { docLengths: [1] } };
  mergeIndexInput({ input: self, dir: 'self', state, mergeState });
  assert.equal(state.chunks.at(-1).codeRelations.callDetails[0].targetChunkUid, 'A:ord3');
}
for (const chunkMeta of [[{ chunkUid: 'A' }, { chunkUid: 'A' }], [{ chunkUid: 'A', metaV2: { chunkUid: 'B' } }]]) {
  const { state, mergeState } = fixture(), before = structuredClone({ state, mergeState });
  assert.throws(() => mergeIndexInput({ input: { chunkMeta, fileList: ['must-not-enter-state.js'] }, dir: 'ambiguous', state, mergeState }),
    /Ambiguous duplicate|Conflicting chunk UID/);
  assert.deepEqual({ state, mergeState }, before, 'identity ambiguity fails before mutating any merged state');
}
console.log('Complete piece UID maps bind forward, backward, cyclic, self and sidecar references independently of input order.');
