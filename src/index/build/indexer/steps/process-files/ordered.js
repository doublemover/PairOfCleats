import { createTimeoutError, runWithTimeout } from '../../../../../shared/promise-timeout.js';
import { createSeqLedger, STAGE1_SEQ_STATE } from './ordering.js';

const TERMINAL_SUCCESS = STAGE1_SEQ_STATE.TERMINAL_SUCCESS;
const TERMINAL_SKIP = STAGE1_SEQ_STATE.TERMINAL_SKIP;
const TERMINAL_FAIL = STAGE1_SEQ_STATE.TERMINAL_FAIL;
const TERMINAL_CANCEL = STAGE1_SEQ_STATE.TERMINAL_CANCEL;
const COMMITTED = STAGE1_SEQ_STATE.COMMITTED;

const TERMINAL_SET = new Set([
  TERMINAL_SUCCESS,
  TERMINAL_SKIP,
  TERMINAL_FAIL,
  TERMINAL_CANCEL
]);

const estimateEnvelopeBytes = (result) => {
  if (!result || typeof result !== 'object') return 0;
  const metadata = result.postingsPayload;
  if (metadata && typeof metadata === 'object') {
    const bytes = Number(metadata.bytes);
    if (Number.isFinite(bytes) && bytes >= 0) {
      return Math.max(0, Math.floor(bytes));
    }
  }
  try {
    return Buffer.byteLength(JSON.stringify(result), 'utf8');
  } catch {
    return 0;
  }
};

const ensureExpectedSeqs = (options = {}) => {
  if (Array.isArray(options.expectedIndices) && options.expectedIndices.length) {
    return Array.from(
      new Set(
        options.expectedIndices
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
          .map((value) => Math.floor(value))
      )
    ).sort((a, b) => a - b);
  }
  const expectedCount = Number.isFinite(options.expectedCount)
    ? Math.max(0, Math.floor(options.expectedCount))
    : 0;
  const startIndex = Number.isFinite(options.startIndex)
    ? Math.floor(options.startIndex)
    : 0;
  const expectedSeqs = [];
  for (let i = 0; i < expectedCount; i += 1) {
    expectedSeqs.push(startIndex + i);
  }
  return expectedSeqs;
};

const createStage1IllegalTransitionError = ({ seq, message, cause }) => {
  const err = new Error(`Stage1 commit cursor transition failed for seq=${seq}: ${message}`);
  err.code = 'STAGE1_COMMIT_CURSOR_TRANSITION';
  err.retryable = false;
  err.meta = {
    seq,
    message,
    cause: cause?.message || String(cause || '')
  };
  return err;
};

const coercePositiveIntOr = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(1, Math.floor(fallback));
  return Math.max(1, Math.floor(parsed));
};

const coerceNonNegativeIntOr = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(parsed));
};

/**
 * Replay commit journal records into deterministic cursor state.
 *
 * @param {{seq:number,recordType:string,terminalOutcome?:string}[]} records
 * @param {{expectedSeqs?:number[]}} [input]
 * @returns {{nextCommitSeq:number,committedSeqs:number[],terminalOutcomes:Record<string,string>}}
 */
export const replayCommitJournal = (records = [], { expectedSeqs = [] } = {}) => {
  const ordered = Array.isArray(records)
    ? records
      .filter((record) => record && typeof record === 'object' && Number.isFinite(record.seq))
      .map((record) => ({
        seq: Math.floor(record.seq),
        recordType: String(record.recordType || ''),
        terminalOutcome: typeof record.terminalOutcome === 'string' ? record.terminalOutcome : null
      }))
    : [];

  const committed = new Set();
  const terminalBySeq = new Map();
  for (const record of ordered) {
    if (record.recordType === 'terminal') {
      const prior = terminalBySeq.get(record.seq);
      if (prior && prior !== record.terminalOutcome) {
        const err = new Error(`Conflicting terminal outcomes for seq=${record.seq}.`);
        err.code = 'STAGE1_COMMIT_JOURNAL_CONFLICT';
        throw err;
      }
      terminalBySeq.set(record.seq, record.terminalOutcome || 'unknown');
      continue;
    }
    if (record.recordType === 'commit') {
      committed.add(record.seq);
    }
  }

  const expected = Array.isArray(expectedSeqs) && expectedSeqs.length
    ? expectedSeqs.slice().sort((a, b) => a - b)
    : Array.from(committed).sort((a, b) => a - b);
  const first = expected.length ? expected[0] : 0;
  let nextCommitSeq = first;
  while (committed.has(nextCommitSeq)) {
    nextCommitSeq += 1;
  }

  return {
    nextCommitSeq,
    committedSeqs: Array.from(committed).sort((a, b) => a - b),
    terminalOutcomes: Object.fromEntries(
      Array.from(terminalBySeq.entries()).map(([seq, outcome]) => [String(seq), outcome])
    )
  };
};

/**
 * Create hard-cutover Stage1 commit-cursor appender.
 *
 * Gap recovery is intentionally removed. Progress is legal only when the
 * contiguous terminal run at `nextCommitSeq` exists.
 *
 * @param {(result:any,state:any,shardMeta:any,context?:{signal?:AbortSignal|null,orderIndex?:number|null,phase?:string})=>Promise<void>} handleFileResult
 * @param {any} state
 * @param {object} [options]
 * @returns {{
 *   enqueue:(orderIndex:number,result:any,shardMeta:any)=>Promise<void>,
 *   skip:(orderIndex:number,reasonCode?:number)=>Promise<void>,
 *   fail:(orderIndex:number,reasonCode?:number)=>Promise<void>,
 *   cancel:(orderIndex:number,reasonCode?:number)=>Promise<void>,
 *   noteDispatched:(orderIndex:number,ownerId?:number)=>void,
 *   noteInFlight:(orderIndex:number,ownerId?:number)=>void,
 *   heartbeat:(orderIndex:number,ownerId:number)=>boolean,
 *   reclaimExpiredLeases:()=>number[],
 *   peekNextIndex:()=>number,
 *   snapshot:()=>object,
 *   waitForCapacity:(input?:number|{orderIndex?:number,bypassWindow?:number,signal?:AbortSignal|null,timeoutMs?:number,stallPollMs?:number,onStall?:(snapshot:object)=>void})=>Promise<void>,
 *   abort:(err:any)=>void,
 *   drain:()=>Promise<void>,
 *   assertCompletion:()=>void,
 *   journal:()=>object[]
 * }}
 */
export const buildOrderedAppender = (handleFileResult, state, options = {}) => {
  const logFn = typeof options.log === 'function' ? options.log : null;
  const onJournalRecord = typeof options.onJournalRecord === 'function' ? options.onJournalRecord : null;
  const flushTimeoutMs = coerceNonNegativeIntOr(options.flushTimeoutMs, 0);
  const maxPendingBeforeBackpressure = coercePositiveIntOr(options.maxPendingBeforeBackpressure, 256);
  const maxPendingBytes = coercePositiveIntOr(options.maxPendingBytes, 256 * 1024 * 1024);
  const commitLagHard = coercePositiveIntOr(options.commitLagHard, Math.max(16, maxPendingBeforeBackpressure * 2));
  const resumeHysteresisRatio = Math.max(0.1, Math.min(0.95, Number(options.resumeHysteresisRatio) || 0.7));
  const flushAbortSignal = options.signal && typeof options.signal.aborted === 'boolean'
    ? options.signal
    : null;

  const expectedSeqs = ensureExpectedSeqs(options);
  const seqLedger = createSeqLedger({
    expectedSeqs,
    leaseTimeoutMs: coercePositiveIntOr(options.leaseTimeoutMs, 60000)
  });

  const envelopeBySeq = new Map();
  const commitJournal = [];
  const capacityWaiters = [];

  let aborted = false;
  let abortError = null;
  let flushing = null;
  let flushRequested = false;
  let bufferedBytes = 0;
  let maxSeenSeq = expectedSeqs.length ? expectedSeqs[0] - 1 : -1;
  let flushActiveSeq = null;
  let flushActiveStartedAt = 0;
  let drainRunCount = 0;
  let drainCommitCount = 0;
  let drainLastErrorCode = null;
  let drainPhase = 'idle';

  const emitLog = (message, meta = null) => {
    if (!logFn) return;
    try {
      if (logFn.length >= 2) logFn(message, meta);
      else logFn(message);
    } catch {}
  };

  const appendJournal = (record) => {
    const normalized = {
      runId: options.runId || null,
      timestampMs: Date.now(),
      ...record
    };
    commitJournal.push(normalized);
    if (onJournalRecord) {
      try {
        onJournalRecord(normalized);
      } catch {}
    }
  };

  const ensureEnvelope = (seq) => {
    const normalizedSeq = Math.floor(Number(seq));
    let envelope = envelopeBySeq.get(normalizedSeq);
    if (envelope) return envelope;
    let resolve;
    let reject;
    const done = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    envelope = {
      seq: normalizedSeq,
      terminalState: null,
      reasonCode: 0,
      result: null,
      shardMeta: null,
      bytes: 0,
      resolved: false,
      resolve,
      reject,
      done,
      createdAt: Date.now()
    };
    envelopeBySeq.set(normalizedSeq, envelope);
    return envelope;
  };

  const settleWaiter = (waiter, settleFn) => {
    if (!waiter || waiter.settled) return;
    waiter.settled = true;
    if (waiter.timeout) {
      try { clearTimeout(waiter.timeout); } catch {}
      waiter.timeout = null;
    }
    if (waiter.stallTimer) {
      try { clearInterval(waiter.stallTimer); } catch {}
      waiter.stallTimer = null;
    }
    if (waiter.signal && waiter.abortHandler) {
      try { waiter.signal.removeEventListener('abort', waiter.abortHandler); } catch {}
      waiter.abortHandler = null;
    }
    try {
      settleFn(waiter);
    } catch {}
  };

  const removeWaiter = (waiter) => {
    const index = capacityWaiters.indexOf(waiter);
    if (index >= 0) capacityWaiters.splice(index, 1);
  };

  const snapshot = () => {
    const ledger = seqLedger.snapshot();
    const pendingCount = envelopeBySeq.size;
    const nextCommitSeq = ledger.nextCommitSeq;
    const headState = Number.isFinite(nextCommitSeq)
      ? seqLedger.getState(nextCommitSeq)
      : STAGE1_SEQ_STATE.UNUSED;
    const headEnvelope = Number.isFinite(nextCommitSeq)
      ? (envelopeBySeq.get(nextCommitSeq) || null)
      : null;
    const commitLag = Number.isFinite(maxSeenSeq) && Number.isFinite(nextCommitSeq)
      ? Math.max(0, maxSeenSeq - nextCommitSeq)
      : 0;
    return {
      aborted,
      drainRunCount,
      drainCommitCount,
      drainLastErrorCode,
      drainPhase,
      flushingActive: Boolean(flushing),
      nextIndex: nextCommitSeq,
      nextCommitSeq,
      headState,
      headTerminalState: headEnvelope?.terminalState ?? null,
      maxSeenSeq,
      commitLag,
      seenCount: ledger.terminalCount,
      expectedCount: ledger.totalSeqCount,
      terminalCount: ledger.terminalCount,
      committedCount: ledger.committedCount,
      totalSeqCount: ledger.totalSeqCount,
      inFlightCount: ledger.inFlightCount,
      dispatchedCount: ledger.dispatchedCount,
      pendingCount,
      pendingBytes: bufferedBytes,
      maxPendingBeforeBackpressure,
      maxPendingBytes,
      commitLagHard,
      flushActive: flushActiveStartedAt > 0
        ? {
          orderIndex: flushActiveSeq,
          startedAt: new Date(flushActiveStartedAt).toISOString(),
          elapsedMs: Math.max(0, Date.now() - flushActiveStartedAt)
        }
        : null
    };
  };

  const releaseEnvelope = (seq) => {
    const envelope = envelopeBySeq.get(seq);
    if (!envelope) return null;
    envelopeBySeq.delete(seq);
    bufferedBytes = Math.max(0, bufferedBytes - (Number(envelope.bytes) || 0));
    return envelope;
  };

  const resolveCapacityWaiters = () => {
    if (!capacityWaiters.length) return;
    if (aborted) {
      const error = abortError || new Error('Ordered appender aborted.');
      while (capacityWaiters.length) {
        settleWaiter(capacityWaiters.shift(), (entry) => entry.reject(error));
      }
      return;
    }
    const stateSnapshot = snapshot();
    const commitLagRelease = Math.max(1, Math.floor(commitLagHard * resumeHysteresisRatio));
    const countRelease = Math.max(1, Math.floor(maxPendingBeforeBackpressure * resumeHysteresisRatio));
    const bytesRelease = Math.max(1, Math.floor(maxPendingBytes * resumeHysteresisRatio));

    const canResolveGlobal = (
      stateSnapshot.pendingCount <= countRelease
      && stateSnapshot.pendingBytes <= bytesRelease
      && stateSnapshot.commitLag <= commitLagRelease
    );

    const unresolved = [];
    for (const waiter of capacityWaiters) {
      if (!waiter || waiter.settled) continue;
      const bypass = Number.isFinite(waiter.orderIndex)
        && Number.isFinite(stateSnapshot.nextCommitSeq)
        && waiter.orderIndex <= (stateSnapshot.nextCommitSeq + (waiter.bypassWindow || 0));
      if (canResolveGlobal || bypass) {
        settleWaiter(waiter, (entry) => entry.resolve());
      } else {
        unresolved.push(waiter);
      }
    }
    capacityWaiters.length = 0;
    capacityWaiters.push(...unresolved);
  };

  const waitForCapacity = (input = null) => {
    if (aborted) {
      return Promise.reject(abortError || new Error('Ordered appender aborted.'));
    }

    let orderIndex = null;
    let bypassWindow = 0;
    let signal = null;
    let timeoutMs = 0;
    let stallPollMs = 0;
    let onStall = null;

    if (Number.isFinite(input)) {
      orderIndex = Math.floor(Number(input));
    } else if (input && typeof input === 'object') {
      if (Number.isFinite(input.orderIndex)) orderIndex = Math.floor(Number(input.orderIndex));
      if (Number.isFinite(input.bypassWindow)) bypassWindow = Math.max(0, Math.floor(Number(input.bypassWindow)));
      if (input.signal && typeof input.signal.aborted === 'boolean') signal = input.signal;
      if (Number.isFinite(Number(input.timeoutMs))) timeoutMs = Math.max(0, Math.floor(Number(input.timeoutMs)));
      if (Number.isFinite(Number(input.stallPollMs))) stallPollMs = Math.max(0, Math.floor(Number(input.stallPollMs)));
      if (typeof input.onStall === 'function') onStall = input.onStall;
    }

    if (signal?.aborted) {
      const reason = signal.reason;
      return Promise.reject(
        reason instanceof Error
          ? reason
          : Object.assign(new Error('Ordered capacity wait aborted.'), {
            code: 'ORDERED_CAPACITY_WAIT_ABORTED',
            retryable: false,
            meta: { reason }
          })
      );
    }

    const stateSnapshot = snapshot();
    const withinBypassWindow = Number.isFinite(orderIndex)
      && Number.isFinite(stateSnapshot.nextCommitSeq)
      && orderIndex <= (stateSnapshot.nextCommitSeq + bypassWindow);
    const blockedByCount = stateSnapshot.pendingCount > maxPendingBeforeBackpressure;
    const blockedByBytes = stateSnapshot.pendingBytes > maxPendingBytes;
    const blockedByLag = stateSnapshot.commitLag > commitLagHard;
    if (withinBypassWindow || (!blockedByCount && !blockedByBytes && !blockedByLag)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        settled: false,
        orderIndex,
        bypassWindow,
        startedAt: Date.now(),
        timeout: null,
        stallTimer: null,
        signal,
        abortHandler: null,
        stallCount: 0
      };

      if (timeoutMs > 0) {
        waiter.timeout = setTimeout(() => {
          const err = new Error(
            `Ordered capacity wait timed out after ${timeoutMs}ms (pending=${snapshot().pendingCount}, bytes=${snapshot().pendingBytes}).`
          );
          err.code = 'ORDERED_CAPACITY_WAIT_TIMEOUT';
          err.retryable = false;
          err.meta = {
            timeoutMs,
            orderIndex,
            bypassWindow,
            snapshot: snapshot()
          };
          removeWaiter(waiter);
          settleWaiter(waiter, (entry) => entry.reject(err));
        }, timeoutMs);
      }

      if (signal) {
        waiter.abortHandler = () => {
          const reason = signal.reason;
          const err = reason instanceof Error
            ? reason
            : Object.assign(new Error('Ordered capacity wait aborted.'), {
              code: 'ORDERED_CAPACITY_WAIT_ABORTED',
              retryable: false,
              meta: { reason }
            });
          removeWaiter(waiter);
          settleWaiter(waiter, (entry) => entry.reject(err));
        };
        signal.addEventListener('abort', waiter.abortHandler, { once: true });
      }

      if (stallPollMs > 0 && onStall) {
        waiter.stallTimer = setInterval(() => {
          if (waiter.settled) return;
          waiter.stallCount += 1;
          try {
            onStall({
              stallCount: waiter.stallCount,
              elapsedMs: Math.max(0, Date.now() - waiter.startedAt),
              pending: snapshot().pendingCount,
              nextIndex: snapshot().nextCommitSeq,
              snapshot: snapshot()
            });
          } catch {}
        }, stallPollMs);
        waiter.stallTimer.unref?.();
      }

      capacityWaiters.push(waiter);
    });
  };

  const transitionToTerminal = (seq, terminalState, { ownerId = 0, reasonCode = 0 } = {}) => {
    const current = seqLedger.getState(seq);
    try {
      if (current === STAGE1_SEQ_STATE.UNSEEN) {
        seqLedger.transition(seq, STAGE1_SEQ_STATE.DISPATCHED, { ownerId });
      }
      const afterDispatch = seqLedger.getState(seq);
      if (afterDispatch === STAGE1_SEQ_STATE.DISPATCHED) {
        seqLedger.transition(seq, STAGE1_SEQ_STATE.IN_FLIGHT, { ownerId });
      }
      const inFlightState = seqLedger.getState(seq);
      if (inFlightState === STAGE1_SEQ_STATE.IN_FLIGHT || inFlightState === STAGE1_SEQ_STATE.DISPATCHED) {
        seqLedger.transition(seq, terminalState, { ownerId, reasonCode });
      } else if (TERMINAL_SET.has(inFlightState)) {
        // Retry path may have already terminalized this seq in rare races.
      } else if (inFlightState === COMMITTED) {
        return;
      } else {
        throw createStage1IllegalTransitionError({
          seq,
          message: `state=${inFlightState} terminal=${terminalState}`
        });
      }
    } catch (error) {
      if (error?.code === 'STAGE1_SEQ_ILLEGAL_TRANSITION') {
        throw createStage1IllegalTransitionError({ seq, message: 'illegal transition', cause: error });
      }
      throw error;
    }
  };

  const resolveTerminalStateForDrain = (seq, envelope = null) => {
    let stateCode = seqLedger.getState(seq);
    if (TERMINAL_SET.has(stateCode) || stateCode === COMMITTED) {
      return stateCode;
    }
    const terminalState = envelope?.terminalState;
    if (!TERMINAL_SET.has(terminalState)) {
      return stateCode;
    }
    transitionToTerminal(seq, terminalState, {
      ownerId: 0,
      reasonCode: Number.isFinite(Number(envelope?.reasonCode))
        ? Math.floor(Number(envelope.reasonCode))
        : 0
    });
    stateCode = seqLedger.getState(seq);
    return stateCode;
  };

  const applyEnvelope = async (envelope, phase = 'ordered_commit') => {
    if (!envelope || envelope.terminalState !== TERMINAL_SUCCESS || !envelope.result) return;
    const orderIndex = envelope.seq;
    const apply = () => handleFileResult(envelope.result, state, envelope.shardMeta, {
      signal: flushAbortSignal,
      orderIndex,
      phase
    });
    if (flushTimeoutMs > 0) {
      await runWithTimeout(
        () => apply(),
        {
          timeoutMs: flushTimeoutMs,
          signal: flushAbortSignal,
          errorFactory: () => createTimeoutError({
            message: `Ordered commit timed out while writing seq ${orderIndex}.`,
            code: 'ORDERED_FLUSH_TIMEOUT',
            retryable: false,
            meta: {
              orderIndex,
              timeoutMs: flushTimeoutMs
            }
          })
        }
      );
      return;
    }
    await apply();
  };

  const drain = () => {
    if (flushing) {
      flushRequested = true;
      return flushing;
    }
    const drainPromise = (async () => {
      drainRunCount += 1;
      drainPhase = 'scan';
      try {
        while (!aborted) {
          drainPhase = 'scan';
          const ledger = seqLedger.snapshot();
          if (ledger.committedCount >= ledger.totalSeqCount) break;
          const nextSeq = ledger.nextCommitSeq;
          const nextState = resolveTerminalStateForDrain(nextSeq, envelopeBySeq.get(nextSeq) || null);
          if (!TERMINAL_SET.has(nextState)) break;

          const batch = [];
          let cursor = nextSeq;
          drainPhase = `batch:${nextSeq}`;
          while (!aborted) {
            const existingEnvelope = envelopeBySeq.get(cursor) || null;
            const stateCode = resolveTerminalStateForDrain(cursor, existingEnvelope);
            if (!TERMINAL_SET.has(stateCode)) break;
            const envelope = existingEnvelope || ensureEnvelope(cursor);
            envelope.terminalState = envelope.terminalState || stateCode;
            batch.push({ seq: cursor, stateCode, envelope });
            cursor += 1;
          }

          if (!batch.length) break;

          for (const item of batch) {
            drainPhase = `commit:${item.seq}`;
            flushActiveSeq = item.seq;
            flushActiveStartedAt = Date.now();
            if (item.stateCode === TERMINAL_SUCCESS) {
              drainPhase = `apply:${item.seq}`;
              await applyEnvelope(item.envelope, 'ordered_commit');
            }
            drainPhase = `journal:${item.seq}`;
            appendJournal({
              seq: item.seq,
              recordType: 'commit',
              terminalOutcome: item.stateCode === TERMINAL_SUCCESS
                ? 'success'
                : item.stateCode === TERMINAL_SKIP
                  ? 'skip'
                  : item.stateCode === TERMINAL_CANCEL
                    ? 'cancel'
                    : 'fail'
            });
            seqLedger.transition(item.seq, COMMITTED);
            drainCommitCount += 1;
            const settled = releaseEnvelope(item.seq) || item.envelope;
            if (!settled.resolved) {
              settled.resolved = true;
              settled.resolve();
            }
            drainPhase = `committed:${item.seq}`;
            flushActiveSeq = null;
            flushActiveStartedAt = 0;
          }
          resolveCapacityWaiters();
        }
      } catch (err) {
        drainLastErrorCode = typeof err?.code === 'string' ? err.code : (err?.name || 'ERROR');
        abort(err);
        throw err;
      }
    })();
    flushing = drainPromise;
    drainPromise
      .finally(() => {
        drainPhase = 'idle';
        if (flushing === drainPromise) {
          flushing = null;
        }
        flushActiveSeq = null;
        flushActiveStartedAt = 0;
        if (flushRequested && !aborted) {
          flushRequested = false;
          drain().catch(() => {});
        }
      })
      .catch(() => {});
    return drainPromise;
  };

  const setTerminalEnvelope = (seq, terminalState, { result = null, shardMeta = null, reasonCode = 0 } = {}) => {
    if (!Number.isFinite(seq)) {
      return Promise.reject(new Error(`Invalid ordered seq value: ${seq}`));
    }
    const normalizedSeq = Math.floor(seq);
    if (normalizedSeq > maxSeenSeq) maxSeenSeq = normalizedSeq;

    const envelope = ensureEnvelope(normalizedSeq);
    if (envelope.terminalState != null && envelope.terminalState !== terminalState) {
      return Promise.reject(
        createStage1IllegalTransitionError({
          seq: normalizedSeq,
          message: `duplicate terminal state prior=${envelope.terminalState} next=${terminalState}`
        })
      );
    }

    if (result && terminalState === TERMINAL_SUCCESS) {
      const bytes = estimateEnvelopeBytes(result);
      bufferedBytes = Math.max(0, bufferedBytes - envelope.bytes) + bytes;
      envelope.bytes = bytes;
      envelope.result = result;
      envelope.shardMeta = shardMeta;
    }
    envelope.terminalState = terminalState;
    envelope.reasonCode = Math.floor(Number(reasonCode) || 0);

    transitionToTerminal(normalizedSeq, terminalState, {
      ownerId: 0,
      reasonCode
    });

    appendJournal({
      seq: normalizedSeq,
      recordType: 'terminal',
      terminalOutcome: terminalState === TERMINAL_SUCCESS
        ? 'success'
        : terminalState === TERMINAL_SKIP
          ? 'skip'
          : terminalState === TERMINAL_CANCEL
            ? 'cancel'
            : 'fail'
    });

    resolveCapacityWaiters();
    drain().catch(() => {});
    return envelope.done;
  };

  const noteDispatched = (orderIndex, ownerId = 0) => {
    const seq = Math.floor(Number(orderIndex));
    if (!Number.isFinite(seq)) return;
    const stateCode = seqLedger.getState(seq);
    if (stateCode === STAGE1_SEQ_STATE.UNSEEN || stateCode === TERMINAL_FAIL) {
      seqLedger.transition(seq, STAGE1_SEQ_STATE.DISPATCHED, { ownerId, nowMs: Date.now() });
    }
  };

  const noteInFlight = (orderIndex, ownerId = 0) => {
    const seq = Math.floor(Number(orderIndex));
    if (!Number.isFinite(seq)) return;
    const stateCode = seqLedger.getState(seq);
    if (stateCode === STAGE1_SEQ_STATE.UNSEEN) {
      seqLedger.transition(seq, STAGE1_SEQ_STATE.DISPATCHED, { ownerId, nowMs: Date.now() });
    }
    if (seqLedger.getState(seq) === STAGE1_SEQ_STATE.DISPATCHED) {
      seqLedger.transition(seq, STAGE1_SEQ_STATE.IN_FLIGHT, { ownerId, nowMs: Date.now() });
    }
  };

  const heartbeat = (orderIndex, ownerId) => seqLedger.heartbeat(Math.floor(Number(orderIndex)), ownerId, Date.now());

  const reclaimExpiredLeases = () => {
    const reclaimed = seqLedger.reclaimExpiredLeases(Date.now());
    if (reclaimed.length) {
      for (const seq of reclaimed) {
        appendJournal({
          seq,
          recordType: 'terminal',
          terminalOutcome: 'fail',
          reasonCode: 910
        });
      }
      drain().catch(() => {});
    }
    return reclaimed;
  };

  const abort = (err) => {
    if (aborted) return;
    aborted = true;
    abortError = err instanceof Error ? err : new Error(String(err || 'Ordered appender aborted.'));
    while (capacityWaiters.length) {
      settleWaiter(capacityWaiters.shift(), (entry) => entry.reject(abortError));
    }
    for (const envelope of envelopeBySeq.values()) {
      if (envelope.resolved) continue;
      envelope.resolved = true;
      try { envelope.reject(abortError); } catch {}
    }
    envelopeBySeq.clear();
    bufferedBytes = 0;
  };

  const assertCompletion = () => {
    seqLedger.assertCompletion();
    const stateSnapshot = snapshot();
    if (stateSnapshot.pendingCount !== 0) {
      const err = new Error(
        `Stage1 ordered appender invariant failed: pending=${stateSnapshot.pendingCount}.`
      );
      err.code = 'STAGE1_ORDERED_PENDING_INVARIANT';
      err.retryable = false;
      err.meta = stateSnapshot;
      throw err;
    }
  };

  return {
    enqueue(orderIndex, result, shardMeta) {
      return setTerminalEnvelope(orderIndex, TERMINAL_SUCCESS, {
        result,
        shardMeta,
        reasonCode: 0
      });
    },
    skip(orderIndex, reasonCode = 0) {
      return setTerminalEnvelope(orderIndex, TERMINAL_SKIP, {
        reasonCode
      });
    },
    fail(orderIndex, reasonCode = 1) {
      return setTerminalEnvelope(orderIndex, TERMINAL_FAIL, {
        reasonCode
      });
    },
    cancel(orderIndex, reasonCode = 2) {
      return setTerminalEnvelope(orderIndex, TERMINAL_CANCEL, {
        reasonCode
      });
    },
    noteDispatched,
    noteInFlight,
    heartbeat,
    reclaimExpiredLeases,
    peekNextIndex() {
      return snapshot().nextCommitSeq;
    },
    snapshot,
    waitForCapacity,
    abort,
    drain,
    assertCompletion,
    journal() {
      return commitJournal.slice();
    }
  };
};
