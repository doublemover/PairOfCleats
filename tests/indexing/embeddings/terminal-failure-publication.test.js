import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { publishEmbeddingFailure } from '../../../tools/build/embeddings/publication.js';
import { errorGraphIncludes, errorGraphSome } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: the actual terminal publication owner and real state writer.
// Independent pending receipt/inspection failures must survive frozen work.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['primary-only', 'receipt-failure', 'receipt-result', 'state-read-failure', 'state-write-failure',
  'reference-failure', 'observation-failure', 'falsey-primary', 'async-state'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'terminal-embedding-'));
let settled = false, prepared = false, receiptCalls = 0;
const primary = selected === 'falsey-primary' ? null : Object.freeze(new Error('Original mode failure.'));
const secondary = Object.freeze(Object.assign(new Error('Independent publication owner.'), {
  cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, secondary); return settled; }
}));
const receiptValue = Object.freeze({ cacheOwnershipPending: true, cacheOwnershipReleased: () => settled });
const receipts = {
  async fail(error, mode, { writer }) {
    assert.equal(this, receipts); assert.equal(error, primary); assert.equal(mode, 'code'); assert.deepEqual(writer, { drained: true });
    receiptCalls++;
    if (selected === 'receipt-failure') throw secondary;
    if (selected === 'receipt-result') return receiptValue;
  },
  reference(mode) { assert.equal(this, receipts); assert.equal(mode, 'code'); if (selected === 'reference-failure') throw secondary; return 'original-attempt'; },
  observation(mode) { assert.equal(this, receipts); assert.equal(mode, 'code'); if (selected === 'observation-failure') throw secondary; return { status: 'failed' }; }
};
try {
  let statePath = path.join(root, 'index_state.json');
  if (selected === 'state-write-failure') {
    const blocked = path.join(root, 'blocked'); await fs.writeFile(blocked, 'original sentinel'); statePath = path.join(blocked, 'index_state.json');
  }
  const result = await publishEmbeddingFailure({ primary, mode: 'code', statePath, runtimeReceipts: receipts,
    writer: { drained: true }, prepareState: async () => {
      prepared = true;
      if (selected === 'state-read-failure') throw secondary;
      if (selected === 'async-state') await Promise.resolve();
      return { mode: 'code', embeddings: { ready: false, pending: false }, extensions: { original: 'retained' } };
    } });
  assert.equal(receiptCalls, 1); assert.equal(prepared, true, 'failed receipt publication cannot discard independent terminal-state work');
  if (['primary-only', 'falsey-primary', 'async-state'].includes(selected)) assert.equal(result, primary);
  else {
    assert.equal(errorGraphIncludes(result, primary), true, 'the exact frozen/falsey work failure remains reachable');
    if (selected === 'state-write-failure') {
      assert.equal(errorGraphSome(result, value => value instanceof Error && value !== primary), true);
      assert.equal(await fs.readFile(path.join(root, 'blocked'), 'utf8'), 'original sentinel');
    } else {
      if (selected !== 'receipt-result') assert.equal(errorGraphIncludes(result, secondary), true);
      assert.equal(result.cacheOwnershipReleased(), false);
      settled = true; assert.equal(result.cacheOwnershipReleased(), true);
    }
  }
  if (['state-read-failure', 'state-write-failure', 'reference-failure', 'observation-failure'].includes(selected)) {
    if (selected !== 'state-write-failure') await assert.rejects(fs.stat(statePath), { code: 'ENOENT' });
  } else {
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    assert.equal(state.embeddings.ready, false); assert.equal(state.embeddings.pending, false);
    assert.equal(state.extensions.original, 'retained'); assert.equal(state.extensions.runtimeAttemptId, 'original-attempt');
    assert.deepEqual(state.extensions.runtimeEmbeddingObservation, { status: 'failed' });
  }
} finally { settled = true; await fs.rm(root, { recursive: true, force: true }); }
console.log(`Embedding terminal failure publication: ${selected}`);
