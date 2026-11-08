import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { throwIfAborted } from '../../../src/shared/abort.js';

const PREFIX = '\u001ePOC_ANN:';
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_LINE_BYTES = 32 * 1024;
const targets = new Set(['merged', 'doc', 'code']);
const moduleUrl = new URL('./backend-child.js', import.meta.url).href;
const script = `import { runBackendChild } from ${JSON.stringify(moduleUrl)};
runBackendChild().catch(error => { console.error(error?.stack || String(error)); process.exitCode = 2; });`;
const validResult = value => value && typeof value === 'object' && typeof value.skipped === 'boolean'
  && (value.skipped || Number.isSafeInteger(value.count) && value.count >= 0);

/** Serialize native jobs under the caller's CPU/memory admission. A crash never
 * retries its started variant or silently switches execution into the parent;
 * only unstarted siblings acquire a fresh child. Completed receipts survive. */
export const runIsolatedBackendJobs = async ({ backend, jobs, signal = null, ownershipId = null,
  spawn = spawnSubprocess, onChildStart = null, recordFailure = null }) => {
  if (!['hnsw', 'lancedb'].includes(backend) || !Array.isArray(jobs) || jobs.length > 3
    || new Set(jobs.map(job => job.target)).size !== jobs.length
    || jobs.some(job => !targets.has(job.target) || !job.payload || Object.hasOwn(job.payload, 'vectors')
      || typeof job.payload.vectorsPath !== 'string')) throw new TypeError('Invalid bounded native backend jobs.');
  const results = {}, work = { childStarts: 0, completedVariants: 0, crashedVariants: 0 };
  const diagnostic = (target, error) => {
    if (!recordFailure) return error.diagnosticEvidence;
    try { return recordFailure({ backend, target, ...error }); }
    catch (failure) { return { written: false, evidencePath: null,
      writeError: { code: failure.code || 'ERR_ANN_DIAGNOSTIC_WRITE', message: failure.message } }; }
  };
  let remaining = [...jobs];
  while (remaining.length) {
    throwIfAborted(signal);
    const input = JSON.stringify({ backend, jobs: remaining });
    if (Buffer.byteLength(input) > MAX_REQUEST_BYTES) throw new RangeError('ANN child request exceeds its byte allowance.');
    const selected = new Set(remaining.map(job => job.target));
    let pending = '', active = null, protocolError = null;
    const receive = chunk => {
      if (protocolError) return;
      pending += chunk;
      // Ordinary native diagnostic lines are discarded; protocol records are
      // bounded independently of the subprocess owner's bounded output tail.
      for (let newline; (newline = pending.indexOf('\n')) >= 0;) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (Buffer.byteLength(line) > MAX_LINE_BYTES) { protocolError = new Error('ANN child line exceeds its allowance.'); return; }
        const marker = line.indexOf(PREFIX);
        if (marker < 0) continue;
        try {
          const record = JSON.parse(line.slice(marker + PREFIX.length));
          if (!selected.has(record.target) || results[record.target]) throw new Error('ANN child returned an unselected or repeated target.');
          if (record.type === 'start' && active === null) active = record.target;
          else if (record.type === 'result' && active === record.target && validResult(record.result)) {
            results[record.target] = record.result; active = null;
          } else throw new Error('ANN child returned an invalid execution record.');
        } catch (error) { protocolError = error; return; }
      }
      if (Buffer.byteLength(pending) > MAX_LINE_BYTES) { pending = ''; protocolError = new Error('ANN child line exceeds its allowance.'); }
    };
    work.childStarts++; onChildStart?.({ backend, targets: [...selected] });
    let outcome = null, failure = null;
    try {
      outcome = await spawn(process.execPath, ['--input-type=module', '-e', script], { input, signal,
        env: process.env, stdio: ['pipe', 'pipe', 'pipe'], outputMode: 'string', maxOutputBytes: 1024 * 1024,
        captureStdout: false, captureStderr: true, rejectOnNonZeroExit: false, onStdout: receive,
        ownershipId, cleanupScope: ownershipId, name: `embeddings-${backend}` });
    } catch (error) {
      // The supervisor's abort may carry an unreaped ownership lease. Preserve
      // that exact error rather than replacing it with a generic AbortError.
      if (signal?.aborted || error.cacheOwnershipPending) throw error;
      failure = error; outcome = error.result || null;
    }
    throwIfAborted(signal);
    for (const job of remaining) {
      const error = results[job.target]?.error;
      if (error && !error.diagnosticEvidence) error.diagnosticEvidence = diagnostic(job.target, error);
    }
    if (pending.trim() && !protocolError) protocolError = new Error('ANN child returned an incomplete terminal line.');
    if (outcome?.exitCode === 0 && !failure && !protocolError && active === null
      && remaining.every(job => results[job.target])) break;
    const message = String(protocolError?.message || failure?.message || outcome?.stderr || 'Native backend child ended before completing its jobs.').slice(-8192);
    const unresolved = remaining.filter(job => !results[job.target]);
    // If no start was observed, the child failed during startup/import. There
    // is no evidence that another identical startup would help; fail all jobs.
    const failedTargets = active ? [active] : unresolved.map(job => job.target);
    for (const target of failedTargets) {
      results[target] = { skipped: true, reason: 'isolate failed', error: { code: failure?.code || 'ERR_ANN_CHILD_FAILED', message,
        exitCode: outcome?.exitCode ?? null, signal: outcome?.signal ?? null,
        ...(failure?.diagnosticEvidence ? { diagnosticEvidence: failure.diagnosticEvidence } : {}) } };
      results[target].error.diagnosticEvidence ||= diagnostic(target, results[target].error);
      work.crashedVariants++;
    }
    if (protocolError || failure?.cacheOwnershipPending) {
      for (const job of remaining) results[job.target] = { skipped: true, reason: 'isolate failed',
        error: { code: 'ERR_ANN_CHILD_PROTOCOL', message, diagnosticEvidence: diagnostic(job.target,
          { code: 'ERR_ANN_CHILD_PROTOCOL', message }) } };
      if (failure?.cacheOwnershipPending) throw failure;
    }
    remaining = remaining.filter(job => !results[job.target]);
  }
  work.completedVariants = Object.values(results).filter(result => result.reason !== 'isolate failed').length;
  return { results, work };
};
