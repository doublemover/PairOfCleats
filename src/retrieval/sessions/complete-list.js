import { createRrfFrontier } from './rrf-frontier.js';

/**
 * Opt-in reference adapter for already-admitted complete lists, never ANN top-L.
 * Lists are copied, so subsequent caller mutation cannot alter the admitted world.
 * This small adapter is intentionally in-memory; it does not claim native/spill support.
 */
export const openCompleteListRrfSession = ({ target, lists, maxRetainedBytes,
  maxListBytes = 8 * 1024 * 1024, release = () => {} }) => {
  const frontier = createRrfFrontier({ target, maxRetainedBytes });
  if (!Number.isSafeInteger(maxListBytes) || maxListBytes < 1 || typeof release !== 'function') {
    throw new TypeError('Invalid complete-list allowance or release callback.');
  }
  const preparation = { inputRows: 0, copiedIdBytes: 0 };
  // Admission precedes copying. The caller retains lease ownership on any error.
  for (const channel of frontier.target.channels) {
    const list = lists?.[channel.id];
    if (!Array.isArray(list) || list.length > Math.floor(maxListBytes / 16)) {
      throw new TypeError('Complete-list input exceeds its separate preparation allowance.');
    }
    for (const id of list) {
      if (typeof id !== 'string' || !id.length || id.length > 4096 || Buffer.byteLength(id) > 4096) {
        throw new TypeError('Invalid or oversized complete-list identity.');
      }
      preparation.inputRows++;
      preparation.copiedIdBytes += 16 + Buffer.byteLength(id);
      if (preparation.copiedIdBytes > maxListBytes) throw new TypeError('Complete-list preparation allowance exceeded.');
    }
  }
  const copied = frontier.target.channels.map(channel => {
    const list = lists?.[channel.id];
    if (!Array.isArray(list) || list.some(id => typeof id !== 'string' || !id.length)
      || new Set(list).size !== list.length) {
      throw Object.assign(new Error('Complete channel lists require unique source-incarnation IDs.'),
        { code: 'ERR_RETRIEVAL_FRONTIER_CONTRACT' });
    }
    return list.slice();
  });
  const offsets = copied.map(() => 0);
  const done = copied.map(() => false);
  let nextChannel = 0;
  let closed = false;
  let released = false;
  const releaseOnce = () => {
    if (!released) { released = true; release(); }
  };
  return Object.freeze({
    targetId: frontier.targetId,
    advance({ workBudget = 1, pageSize = 10, signal, continuation = null, targetId = frontier.targetId } = {}) {
      if (closed) throw new Error('Retrieval session is closed.');
      if (!Number.isSafeInteger(workBudget) || workBudget < 0
        || !Number.isSafeInteger(pageSize) || pageSize < 0) throw new TypeError('Invalid work/page budget.');
      if (continuation != null) frontier.assertContinuation(continuation, targetId);
      else if (targetId !== frontier.targetId) throw new Error('Incompatible retrieval target.');
      let work = 0;
      let pauseReason = null;
      while (work < workBudget && !done.every(Boolean)) {
        if (signal?.aborted) { pauseReason = 'cancelled'; break; }
        const index = nextChannel;
        nextChannel = (nextChannel + 1) % copied.length;
        if (done[index]) continue;
        const list = copied[index];
        const offset = offsets[index];
        const ids = offset < list.length ? [list[offset]] : [];
        const exhausted = offset + ids.length === list.length;
        const accepted = frontier.append({ channelId: frontier.target.channels[index].id,
          expectedDepth: offset, ids, exhausted });
        if (!accepted.accepted) { pauseReason = accepted.reason; break; }
        offsets[index] += ids.length;
        done[index] = exhausted;
        work++;
      }
      if (signal?.aborted) pauseReason = 'cancelled';
      const result = pauseReason === 'cancelled'
        ? { ...frontier.receipt(), hits: [] } : frontier.takeCertified(pageSize);
      return { ...result, state: pauseReason ? 'paused' : result.state,
        reason: pauseReason, work, preparation: { ...preparation }, resumability: 'same-owner-only' };
    },
    setCapacity: frontier.setCapacity,
    inspect: frontier.inspect,
    close() {
      if (!closed) {
        closed = true;
        for (const list of copied) list.length = 0;
        frontier.close();
        releaseOnce();
      }
    }
  });
};
