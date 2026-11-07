import { applyAdjacencyDelta } from './adjacency-delta.js';
import { finiteViewFields, captureFiniteViewJson } from './finite-input.js';
import { isAbortError } from '../../../shared/abort.js';
import { isSemanticJsonBudgetError } from '../canonical-json-bounds.js';

/** Code-owned unary operators share capture/replay/atomic admission. Original
 * input and output authority stays inside each operator's private owner. */
export const createFiniteUnaryTransition = ({ getState, fail, hash, build, readBudget }) => (handle, value, options = {}) => {
  const state = getState(handle), batch = captureFiniteViewJson(value, state.limits.retainedBytes, fail);
  finiteViewFields(batch, ['batchId', 'expectedRootId', 'input'], [], fail);
  if (typeof batch.batchId !== 'string' || !batch.batchId.length || batch.batchId.length > 128) throw fail('Invalid finite-view batch identity.');
  const digest = hash(batch), previous = state.ledger.find(entry => entry.batchId === batch.batchId);
  if (previous) {
    if (previous.digest !== digest) throw fail('Finite-view replay changed content.');
    return { status: 'replayed', consumed: false, view: handle };
  }
  if (batch.expectedRootId !== handle.rootId) throw fail('Finite-view transition has the wrong original base.');
  if (state.ledger.length >= 128) return { status: 'checkpoint-required', consumed: false, view: handle };
  const { signal = null } = options;
  if (signal?.aborted) return { status: 'cancelled', consumed: false, view: handle };
  try {
    const next = applyAdjacencyDelta(state.input, batch.input, { signal, maxWork: Math.min(state.limits.work, state.limits.inputSupports * 4) });
    if (!next.consumed) {
      if (!['cancelled', 'work-budget', 'retention-budget', 'checkpoint-required'].includes(next.status)) throw fail('Original input replay is not a new finite-view transition.');
      return { status: next.status, consumed: false, view: handle };
    }
    const view = build({ ...state, input: next.view, ledger: [...state.ledger, { batchId: batch.batchId, digest }] }, signal);
    return { status: 'materialized-private', consumed: true, view, maintenance: 'full-affected-view-recomputation', publication: 'not-attempted' };
  } catch (error) {
    if (isAbortError(error)) return { status: 'cancelled', consumed: false, view: handle };
    if (isSemanticJsonBudgetError(error)) return { status: 'retention-budget', consumed: false, view: handle, limit: 'retainedBytes' };
    const allowance = readBudget(error);
    if (allowance) return { status: allowance.limit === 'work' ? 'work-budget' : 'retention-budget', consumed: false, view: handle, limit: allowance.limit };
    throw error;
  }
};
