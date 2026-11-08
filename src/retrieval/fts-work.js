import { performance } from 'node:perf_hooks';
import { addStorageFailureContext } from '../shared/storage/operation-error.js';
import { FTS_WORK_POLICY_VERSION } from './fts-work-policy.js';

class FtsDeadline extends Error {}

/** This bounds dispatch between synchronous calls. SQLite stepping/sorting and
 * user functions cannot be interrupted by a JavaScript timer on this thread. */
export const createFtsWork = ({ timeBudgetMs, chunkSize, now = () => performance.now(), throwIfAborted = null }) => {
  const started = now(), phases = {};
  let cursorSteps = 0, batches = 0, rowsScanned = 0;
  let operationFailure, failurePhase = null;
  const elapsed = () => Math.max(0, now() - started);
  const expired = () => elapsed() >= timeBudgetMs;
  const run = (phase, action, cleanup = false) => {
    if (!cleanup) {
      throwIfAborted?.();
      if (expired()) throw new FtsDeadline('FTS cooperative dispatch allowance exhausted.');
    }
    const start = now();
    try { return action(); }
    catch (error) { operationFailure = error; failurePhase = phase; throw error; }
    finally { phases[phase] = (phases[phase] || 0) + Math.max(0, now() - start); }
  };
  const collect = ({ openCursor, rowLimit, qualifyBatch }) => {
    const rows = [];
    let cursor, failure, failed = false, done = false, termination = 'complete';
    try {
      cursor = run('sql', openCursor);
      while (!done && rowsScanned < rowLimit) {
        const batch = [];
        while (batch.length < chunkSize && rowsScanned < rowLimit && !expired()) {
          const step = run('sql', () => { cursorSteps++; return cursor.next(); });
          if (step.done) { done = true; break; }
          rowsScanned++; batch.push(step.value);
        }
        if (batch.length) {
          batches++;
          // Qualification owns its own dispatch checks. An already observed
          // eligible row may finish pure projection after a call overruns.
          const qualified = qualifyBatch(batch);
          for (const row of qualified) rows.push(row);
        }
        if (done) break;
        if (expired()) { termination = 'deadline'; break; }
      }
      if (termination !== 'deadline' && !done && rowsScanned >= rowLimit) termination = 'row-cap';
    } catch (error) {
      if (error instanceof FtsDeadline) termination = 'deadline';
      else { failure = error; failed = true; }
    } finally {
      if (cursor) {
        try {
          const closed = run('cleanup', () => cursor.return(), true);
          if (closed?.done !== true) throw new Error('FTS cursor return did not confirm closure.');
        } catch (cleanup) {
          const pending = addStorageFailureContext(cleanup, { cacheOwnershipPending: true });
          failure = failed ? addStorageFailureContext(failure, {}, pending, { secondaryPresent: true }) : pending;
          failed = true;
        }
      }
    }
    if (failed) throw failure;
    throwIfAborted?.();
    return { rows, termination };
  };
  return { run, collect, isQueryFailure: error => failurePhase === 'sql' && operationFailure === error, snapshot: () => {
    const elapsedMs = elapsed();
    return { policyVersion: FTS_WORK_POLICY_VERSION, mechanism: 'cooperative-dispatch', hardDeadline: false,
      nativeInterruption: false, scope: 'candidate-sql-metadata-terms-scoring-cleanup',
      timeBudgetMs, chunkSize, cursorSteps, batches, rowsScanned, elapsedMs,
      overrunMs: Math.max(0, elapsedMs - timeBudgetMs), phases: { ...phases } };
  } };
};
