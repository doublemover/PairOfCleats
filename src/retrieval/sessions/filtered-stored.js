import { randomUUID } from 'node:crypto';
import { rankDenseVectors } from '../rankers.js';
import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';

/**
 * Opt-in deterministic probe then complete eligible-scan rescue. Uses the actual
 * stored-vector scalar backend; native probe scores never substitute its target.
 * The caller supplies a pinned immutable index lease and complete eligibility.
 */
export const openFilteredStoredVectorSession = ({ target, idx, embedding, eligibleRows, snapshotLease,
  probe = null, maxRows = 65536 }) => {
  if (!target || target.scoreTarget !== 'stored-dot-scalar-v1' || target.eligibility !== 'complete-confirmed'
    || !['repositoryId', 'generationId', 'rowMapId', 'representationId', 'queryId', 'eligibleDomainId']
      .every(name => typeof target[name] === 'string' && target[name].length > 0 && target[name].length <= 4096)
    || !Array.isArray(eligibleRows) || !Number.isSafeInteger(maxRows) || maxRows < 1 || eligibleRows.length > maxRows
    || !Array.isArray(embedding) || !embedding.length || embedding.some(value => !Number.isFinite(value))
    || idx?.denseVec?.dims !== embedding.length || typeof snapshotLease?.assertActive !== 'function'
    || typeof snapshotLease?.release !== 'function' || probe !== null && typeof probe !== 'function') {
    throw new TypeError('Pinned complete eligibility and exact stored-score target required.');
  }
  const targetId = semanticHash('pairofcleats.filtered-stored-session.v1', { target, embedding, eligibleRows });
  snapshotLease.assertActive(target);
  const rows = eligibleRows.map(row => ({ ...row }));
  const byId = new Map(), identities = new Set();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.rowId) || row.rowId < 0 || byId.has(row.rowId)
      || typeof row.id !== 'string' || !row.id.length || row.id.length > 4096 || identities.has(row.id)) {
      throw new TypeError('Unique row and source-incarnation identities required.');
    }
    byId.set(row.rowId, row); identities.add(row.id);
  }
  const query = embedding.slice(), frozenTarget = JSON.parse(canonicalSemanticJson(target));
  const scores = new Map(), continuation = randomUUID();
  const counters = { probeCalls: 0, probeWork: 0, eligibilityChecks: 0, rejectedProbeIds: 0,
    scoresComputed: 0, scoresReused: 0, exactRowsVisited: 0, coordinatesScored: 0 };
  let offset = 0, probed = false, closed = false, active = false, failure = null;
  const probeFailures = [];
  const score = (ids, signal) => {
    if (!ids.length) return;
    snapshotLease.assertActive(frozenTarget);
    const metrics = {};
    let hits;
    try { hits = rankDenseVectors(idx, query, ids.length, new Set(ids), { signal, metrics }); }
    finally {
      counters.scoresComputed += metrics.vectorsScored || 0;
      counters.coordinatesScored += metrics.coordinatesScored || 0;
    }
    if (hits.length !== ids.length || hits.some(hit => !Number.isFinite(hit.sim))) {
      throw new Error('Authoritative stored score unavailable for an admitted eligible row.');
    }
    for (const hit of hits) scores.set(hit.idx, hit.sim);
  };
  return Object.freeze({ targetId,
    async advance({ workBudget = 128, topK = 10, signal, cursor = continuation, expectedTargetId = targetId } = {}) {
      if (closed || active) throw new Error(closed ? 'Filtered session closed.' : 'Filtered session already advancing.');
      if (cursor !== continuation || expectedTargetId !== targetId) throw new Error('Incompatible filtered continuation.');
      if (!Number.isSafeInteger(workBudget) || workBudget < 0 || workBudget > 4096
        || !Number.isSafeInteger(topK) || topK < 0 || topK > 1024) throw new TypeError('Invalid filtered work/result allowance.');
      active = true;
      let reason = null, used = 0;
      try {
        snapshotLease.assertActive(frozenTarget);
        if (signal?.aborted) reason = 'cancelled';
        if (!reason && !failure && !probed && probe && workBudget > 0) {
          probed = true; counters.probeCalls++;
          try {
            const found = await probe({ target: structuredClone(frozenTarget), maxWork: workBudget, signal });
            if (!Array.isArray(found?.ids) || found.ids.length > workBudget
              || !Number.isSafeInteger(found.actualWork) || found.actualWork < 0) throw new Error('Unqualified native probe work receipt.');
            counters.probeWork += found.actualWork;
            used += found.actualWork;
            if (found.actualWork > workBudget) throw new Error('Native probe exceeded its granted work slice.');
            if (signal?.aborted) reason = 'cancelled';
            if (!reason) {
              const admitted = [];
              for (const id of new Set(found.ids)) {
                counters.eligibilityChecks++;
                if (!byId.has(id)) { counters.rejectedProbeIds++; continue; }
                if (scores.has(id)) counters.scoresReused++;
                else if (used + admitted.length < workBudget) admitted.push(id);
              }
              score(admitted, signal); used += admitted.length;
            }
          } catch (error) {
            if (signal?.aborted || error?.name === 'AbortError') reason = 'cancelled';
            else probeFailures.push({ message: String(error.message).slice(0, 512) });
          }
        }
        if (!reason && !failure) {
          snapshotLease.assertActive(frozenTarget);
          const ids = [];
          let next = offset;
          while (next < rows.length && used < workBudget) {
            const row = rows[next++]; used++; counters.exactRowsVisited++;
            if (scores.has(row.rowId)) counters.scoresReused++;
            else ids.push(row.rowId);
          }
          score(ids, signal);
          offset = next;
        }
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') reason = 'cancelled';
        else failure = String(error.message).slice(0, 512);
      } finally { active = false; }
      const complete = !failure && offset === rows.length;
      const hits = [...scores].map(([rowId, sim]) => ({ id: byId.get(rowId).id, rowId, sim,
        scoreStatus: 'exact-stored', orderStatus: complete ? 'certified' : 'provisional' }))
        .sort((a, b) => b.sim - a.sim || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, topK);
      return { targetId, continuation, hits, counters: { ...counters }, workUsed: used,
        state: failure ? 'failed' : reason ? 'paused' : complete ? 'exhausted' : 'running',
        reason: failure || reason, probeFailures: structuredClone(probeFailures),
        eligibleEnumerationComplete: complete, rankingTarget: 'stored-dot-scalar-v1',
        originalVectorExactness: 'not-claimed', semanticClosure: 'not-implied',
        nextExactOffset: offset, remainingEligibleRows: rows.length - offset,
        resumability: failure ? 'failed' : 'same-owner-only', nativeFrontierReuse: false };
    },
    close() {
      if (active) throw new Error('Wait for the active slice to settle before closing.');
      if (!closed) { closed = true; rows.length = 0; byId.clear(); identities.clear(); scores.clear(); snapshotLease.release(); }
    }
  });
};
