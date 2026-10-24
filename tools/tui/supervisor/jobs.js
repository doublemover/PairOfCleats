import path from 'node:path';
import { assertTuiControlReason } from '../../../src/contracts/validators/tui-request.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { clampInt } from '../../../src/shared/limits.js';
import { getTuiWorkspaceRoot } from '../../../src/shared/env/tui.js';
import { collectJobArtifacts } from './artifacts.js';
import { applyProgressContextEnv } from './progress-context.js';
import { createJobStreamDecoder } from './progress-decoder.js';
import {
  nowIso,
  resolveCapturedResult,
  resolveResultPolicy,
  resolveRetryPolicy,
  resolveRunRequest
} from './request-utils.js';
import { createJobWatchdogController, resolveWatchdogPolicy } from './watchdog.js';
import { captureOwnedCleanup, ownedCleanupIsPending, combineOwnedErrors } from '../operator/settle-owned.js';

/**
 * Build and expose job lifecycle operations for the supervisor runtime.
 *
 * @param {{
 *  state:{jobs:Map<string,object>,shuttingDown?:boolean},
 *  runId:string,
 *  root:string,
 *  emit:(event:string,payload?:object,options?:{jobId?:string|null,critical?:boolean})=>void,
 *  emitLog:(jobId:string|null,level:'info'|'warn'|'error',message:string,extra?:object)=>void,
 *  buildFlowSnapshot:(input?:{includeChunked?:boolean})=>object
 * }} input
 * @returns {{
 *  startJob:(request:object)=>Promise<void>,
 *  startOperation:(request:object,execute:Function,options?:object)=>Promise<void>,
 *  cancelJob:(jobId:string,reason?:string)=>boolean,
 *  cleanupFinalizedJob:(jobId:string)=>void,
 *  failJobInvalidRequest:(jobId:string,error:Error|string)=>void
 * }}
 */
export const createJobController = ({ state, runId, root, emit, emitLog, buildFlowSnapshot,
  beginArtifactJob = null, captureArtifactInventory = null, assertWorkAdmission = null }) => {
  const assertAcceptingWork = ({ allowPending = false } = {}) => {
    if (state.shuttingDown) throw Object.assign(new Error('Supervisor is shutting down.'),
      { code: 'ERR_TUI_SHUTTING_DOWN' });
    for (const job of state.jobs.values()) {
      if (!allowPending && ownedCleanupIsPending(job.resourceError)) {
        const original = job.resourceError;
        throw Object.assign(new Error('An owned job still has unconfirmed resource cleanup.', { cause: original }), {
          code: 'ERR_TUI_RESOURCE_PENDING', cacheOwnershipPending: true,
          cacheOwnershipReleased: () => !ownedCleanupIsPending(original)
        });
      }
      cleanupFinalizedJob(job.id, job);
    }
  };
  const retainPendingResource = (job, error) => {
    if (!captureOwnedCleanup(error).present) return;
    job.resourceError = job.resourceError && job.resourceError !== error
      ? combineOwnedErrors(job.resourceError, [error]) : error;
    job.cleanupPending = () => ownedCleanupIsPending(job.resourceError);
  };
  /**
   * Return one tracked job by id.
   *
   * @param {string|null} jobId
   * @returns {object|null}
   */
  const getJob = (jobId) => (typeof jobId === 'string' ? state.jobs.get(jobId) : null);

  /**
   * Remove completed job from in-memory registry.
   *
   * @param {string} jobId
   * @returns {void}
   */
  const cleanupFinalizedJob = (jobId, expectedJob = null) => {
    const job = getJob(jobId);
    if (!job || !job.finalized || (expectedJob && job !== expectedJob)
      || (job.settlement && job.settled !== true) || ownedCleanupIsPending(job.resourceError)) return;
    state.jobs.delete(jobId);
  };

  /**
   * Finalize job state once and emit terminal `job:end` event.
   *
   * @param {object} job
   * @param {object} payload
   * @returns {void}
   */
  const finalizeJob = (job, payload) => {
    if (job.finalized) return;
    job.finalized = true;
    job.status = payload.status;
    emit('job:end', job.internal ? payload : { ...payload,
      attempts: job.attempts, maxAttempts: job.retryPolicy.maxAttempts,
      retries: Math.max(0, job.attempts - 1), cancelReason: job.cancelReason,
      timedOut: job.timedOut === true, totalDurationMs: Math.max(0, Date.now() - job.startedAt)
    }, { jobId: job.id });
  };

  /**
   * Emit job artifact inventory without failing the parent run path.
   *
   * @param {object} job
   * @param {object} request
   * @param {{cwd?:string}} [options]
   * @returns {Promise<void>}
   */
  const emitArtifacts = async (job, request, { cwd } = {}) => {
    try {
      if (ownedCleanupIsPending(job.resourceError)) throw job.resourceError;
      assertWorkAdmission?.({ kind: 'artifacts', request });
      const artifacts = await collectJobArtifacts({ request, cwd });
      const inventory = job.artifactGeneration && captureArtifactInventory
        ? await captureArtifactInventory({ sourceJobId: job.id, generation: job.artifactGeneration, artifacts })
        : { artifacts };
      if (getJob(job.id) !== job) return;
      emit('job:artifacts', {
        ...inventory,
        artifactsIndexed: true,
        source: 'supervisor'
      }, { jobId: job.id });
    } catch (error) {
      if (getJob(job.id) !== job) return;
      emit('job:artifacts', {
        artifacts: [],
        artifactsIndexed: false,
        source: 'supervisor',
        nonFatal: true,
        error: {
          message: error?.message || String(error),
          code: 'ARTIFACT_INDEX_FAILED'
        }
      }, { jobId: job.id });
    }
  };

  /**
   * Accept and schedule one `job:run` request lifecycle.
   *
   * The returned promise resolves once the run attempt loop is scheduled. Final
   * completion is emitted asynchronously via `job:end`.
   *
   * @param {object} request
   * @returns {Promise<void>}
   */
  const startJob = async (request, { beforeRun = null, afterRun = null, execute = null } = {}) => {
    assertAcceptingWork();
    assertWorkAdmission?.({ kind: 'job', request });
    const jobId = String(request?.jobId || '').trim();
    if (!jobId) {
      throw new Error('job:run requires jobId.');
    }
    if (state.jobs.has(jobId)) {
      throw Object.assign(new Error(`job already exists: ${jobId}`), { code: 'ERR_TUI_JOB_EXISTS' });
    }
    const title = String(request?.title || 'Job').trim() || 'Job';
    const retryPolicy = resolveRetryPolicy(request);
    const resultPolicy = resolveResultPolicy(request);
    const timeoutMs = clampInt(request?.timeoutMs, 0, 24 * 60 * 60 * 1000, 0);
    const deadlineMs = clampInt(request?.deadlineMs, 0, Number.MAX_SAFE_INTEGER, 0);
    const watchdogPolicy = resolveWatchdogPolicy(request);
    const job = {
      id: jobId,
      title,
      seq: 0,
      status: 'accepted',
      abortController: new AbortController(),
      cancelReason: null,
      pid: null,
      startedAt: Date.now(),
      attempts: 0,
      retryPolicy,
      timedOut: false,
      finalized: false
    };
    job.artifactGeneration = beginArtifactJob?.(jobId) ?? null;
    state.jobs.set(jobId, job);

    const completeAttempt = async payload => {
      if (afterRun && !ownedCleanupIsPending(job.resourceError)) {
        try {
          const observation = await afterRun({ payload, signal: job.abortController.signal });
          if (Buffer.byteLength(JSON.stringify(observation) || '') > 1024 * 1024) throw new Error('Oversized workflow observation.');
          Object.assign(payload, observation);
        } catch (error) {
          retainPendingResource(job, error);
          payload.workflow = { observed: false, errorCode: String(error.code || 'ERR_TUI_WORKFLOW_OBSERVATION') };
          if (ownedCleanupIsPending(job.resourceError)) {
            payload.status = payload.status === 'cancelled' ? 'cancelled' : 'failed';
            payload.error = { code: 'ERR_TUI_RESOURCE_PENDING', message: 'Workflow resource cleanup remains unconfirmed.' };
          }
        }
      }
      if (job.nativeTaskStarted) emit('task:end', { taskId: 'native-owner', status: payload.status,
        message: payload.workflow?.maintenance?.pending === true || ownedCleanupIsPending(job.resourceError)
          ? 'Owned execution ended with unconfirmed resource cleanup; admission remains fenced.'
          : 'Owned workflow execution settled.' }, { jobId });
      finalizeJob(job, payload);
    };

    emit('job:start', {
      command: Array.isArray(request?.argv) ? request.argv : [],
      cwd: request?.cwd ? path.resolve(String(request.cwd)) : (getTuiWorkspaceRoot() || process.cwd()),
      title,
      requested: {
        progressMode: request?.progressMode || 'jsonl',
        resultPolicy,
        retry: retryPolicy,
        watchdog: watchdogPolicy
      }
    }, { jobId });

    const waitForRetry = async attempt => {
      if (job.nativeTaskStarted) {
        emit('task:end', { taskId: 'native-owner', status: 'failed',
          message: 'This execution attempt failed; a retry remains a separate attempt.' }, { jobId });
        job.nativeTaskStarted = false;
      }
      const signal = job.abortController.signal;
      if (signal.aborted) return false;
      const taskId = 'supervisor:retry';
      emit('task:start', { taskId, status: 'running', stage: 'retry', state: 'waiting',
        message: `Waiting to start attempt ${attempt + 1}/${retryPolicy.maxAttempts}.` }, { jobId });
      if (retryPolicy.delayMs > 0) await new Promise(resolve => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, retryPolicy.delayMs);
        signal.addEventListener('abort', finish, { once: true });
        if (signal.aborted) finish();
      });
      emit('task:end', { taskId, status: signal.aborted ? 'cancelled' : 'done', stage: 'retry',
        state: signal.aborted ? 'cancelled' : 'ready', message: signal.aborted
          ? 'Retry wait cancelled; no replacement execution was started.' : 'Retry wait elapsed.' }, { jobId });
      return !signal.aborted;
    };
    const cancelRetryPayload = payload => Object.assign(payload, { status: 'cancelled',
      terminationReason: 'cancelled', exitCode: 130,
      error: { code: job.cancelReason || 'CANCELLED', message: 'Retry cancelled before replacement execution.' } });

    /**
     * Run one attempt of the configured command with stream decoding and watchdogs.
     *
     * @param {number} attempt
     * @returns {Promise<object>}
     */
    const runAttempt = async (attempt) => {
      job.attempts = attempt;
      job.timedOut = false;
      let attemptOpen = true;
      const ownsAttempt = () => attemptOpen && !job.finalized && getJob(jobId) === job && job.attempts === attempt;
      const { command, args, cwd } = resolveRunRequest(request, { root });
      const envPatch = request?.envPatch && typeof request.envPatch === 'object' ? request.envPatch : {};
      const env = applyProgressContextEnv({
        ...process.env,
        ...envPatch
      }, {
        runId,
        jobId
      });
      let lastActivityAt = Date.now();

      const timeoutFromDeadline = deadlineMs > 0
        ? Math.max(1, deadlineMs - Date.now())
        : 0;
      const effectiveTimeoutMs = timeoutMs > 0 && timeoutFromDeadline > 0
        ? Math.min(timeoutMs, timeoutFromDeadline)
        : (timeoutMs > 0 ? timeoutMs : timeoutFromDeadline || undefined);

      /**
       * Mark most recent child-process output/activity timestamp.
       *
       * @returns {void}
       */
      const markActivity = () => {
        if (ownsAttempt()) lastActivityAt = Date.now();
      };
      const stdoutDecoder = createJobStreamDecoder({
        job,
        jobId,
        stream: 'stdout',
        maxLineBytes: resultPolicy.maxBytes,
        markActivity,
        emit,
        emitLog
      });
      const stderrDecoder = createJobStreamDecoder({
        job,
        jobId,
        stream: 'stderr',
        maxLineBytes: resultPolicy.maxBytes,
        markActivity,
        emit,
        emitLog
      });
      const startedAt = Date.now();
      const watchdog = createJobWatchdogController({
        job,
        jobId,
        watchdogPolicy,
        getLastActivityAt: () => lastActivityAt,
        emit,
        emitLog,
        buildFlowSnapshot,
        nowIso
      });
      watchdog.start();

      try {
        if (beforeRun) await beforeRun({ signal: job.abortController.signal });
        job.abortController.signal.throwIfAborted();
        // Only trusted workflow owners can supply this callback. Protocol JSON
        // continues to select canonical argv and can never supply executable code.
        const spawnOptions = {
          cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          captureStdout: resultPolicy.captureStdout !== 'none',
          captureStderr: false,
          maxOutputBytes: resultPolicy.maxBytes,
          rejectOnNonZeroExit: false,
          signal: job.abortController.signal,
          timeoutMs: effectiveTimeoutMs,
          onSpawn: (child) => {
            if (!ownsAttempt()) return;
            job.pid = child?.pid || null;
            job.status = 'running';
            markActivity();
            emit('job:spawn', {
              pid: job.pid,
              spawnedAt: nowIso()
            }, { jobId });
          },
          onStdout: (chunk) => { if (ownsAttempt()) stdoutDecoder.push(chunk); },
          onStderr: (chunk) => { if (ownsAttempt()) stderrDecoder.push(chunk); }
        };
        const result = execute
          ? await execute({ signal: job.abortController.signal, env, cwd, jobId,
            onSpawn: spawnOptions.onSpawn, onStdout: spawnOptions.onStdout, onStderr: spawnOptions.onStderr, onActivity: payload => {
              if (!ownsAttempt()) return;
              job.status = 'running';
              markActivity();
              if (!job.nativeTaskStarted) {
                job.nativeTaskStarted = true;
                emit('task:start', { taskId: 'native-owner', status: 'running', ...payload }, { jobId });
              } else emit('task:progress', { taskId: 'native-owner', status: 'running', ...payload }, { jobId });
            } })
          : await spawnSubprocess(command, args, spawnOptions);

        attemptOpen = false;
        stdoutDecoder.flush();
        stderrDecoder.flush();

        const cancelled = job.abortController.signal.aborted;
        job.timedOut = job.cancelReason === 'watchdog_timeout';
        const status = cancelled
          ? 'cancelled'
          : (result.exitCode === 0 && !result.signal ? 'done' : 'failed');
        const payload = {
          status,
          terminationReason: job.timedOut ? 'timeout' : cancelled ? 'cancelled' : result.signal ? 'signal' : 'exit',
          exitCode: cancelled ? 130 : (result.exitCode ?? null),
          signal: result.signal || null,
          durationMs: Math.max(0, Date.now() - startedAt),
          ...resolveCapturedResult(result.stdout, resultPolicy, result.outputCapture?.stdout),
          error: status === 'failed'
            ? {
              message: `job failed with exit code ${result.exitCode ?? 'unknown'}`,
              code: 'JOB_FAILED'
            }
            : null
        };

        if (status === 'failed' && attempt < retryPolicy.maxAttempts) {
          watchdog.stop();
          emitLog(jobId, 'warn', `attempt ${attempt} failed; retrying (${attempt + 1}/${retryPolicy.maxAttempts})`, {
            attempt,
            maxAttempts: retryPolicy.maxAttempts
          });
          if (await waitForRetry(attempt)) return runAttempt(attempt + 1);
          cancelRetryPayload(payload);
        }

        await completeAttempt(payload);
        await emitArtifacts(job, request, { cwd });
      } catch (error) {
        attemptOpen = false;
        retainPendingResource(job, error);
        job.timedOut = error?.code === 'SUBPROCESS_TIMEOUT' || job.cancelReason === 'watchdog_timeout';
        const cancelled = job.abortController.signal.aborted || error?.name === 'AbortError';
        const cancelReason = job.cancelReason || String(job.abortController.signal.reason || '');
        const payload = {
          status: cancelled ? 'cancelled' : 'failed',
          terminationReason: job.timedOut ? 'timeout' : cancelled ? 'cancelled' : 'spawn-error',
          exitCode: cancelled ? 130 : null,
          signal: null,
          durationMs: Math.max(0, Date.now() - startedAt),
          result: null,
          resultState: resultPolicy.captureStdout === 'none' ? 'disabled' : 'incomplete',
          resultCapture: error?.result?.outputCapture?.stdout || null,
          error: {
            message: error?.message || String(error),
            code: ownedCleanupIsPending(job.resourceError)
              ? error?.code === 'ERR_TUI_BACKEND_OWNERSHIP_PENDING' ? 'ERR_TUI_BACKEND_OWNERSHIP_PENDING' : 'ERR_TUI_RESOURCE_PENDING'
              : cancelled ? (cancelReason || 'CANCELLED') : beforeRun ? (error.code || 'SPAWN_FAILED') : 'SPAWN_FAILED'
          }
        };
        if (!cancelled && !ownedCleanupIsPending(job.resourceError) && attempt < retryPolicy.maxAttempts) {
          watchdog.stop();
          emitLog(jobId, 'warn', `attempt ${attempt} failed; retrying (${attempt + 1}/${retryPolicy.maxAttempts})`, {
            attempt,
            maxAttempts: retryPolicy.maxAttempts,
            error: payload.error.message
          });
          if (await waitForRetry(attempt)) return runAttempt(attempt + 1);
          cancelRetryPayload(payload);
        }
        await completeAttempt(payload);
        await emitArtifacts(job, request, { cwd });
      } finally {
        attemptOpen = false;
        watchdog.stop();
      }
      return null;
    };

    job.settlement = runAttempt(1).catch(async (error) => {
      retainPendingResource(job, error);
      if (job.finalized) return;
      finalizeJob(job, {
        status: 'failed',
        terminationReason: 'invalid-request',
        exitCode: null,
        signal: null,
        durationMs: Math.max(0, Date.now() - job.startedAt),
        result: null,
        error: {
          message: error?.message || String(error),
          code: 'INVALID_REQUEST'
        }
      });
      await emitArtifacts(job, request, {
        cwd: request?.cwd ? path.resolve(String(request.cwd)) : (getTuiWorkspaceRoot() || process.cwd())
      });
    }).finally(() => {
      job.settled = true;
      job.status = job.status === 'cancelled' ? 'cancelled' : (job.status || 'done');
      cleanupFinalizedJob(jobId, job);
    });
    // Keep the original promise for shutdown observation without creating an
    // unhandled rejection while the interactive supervisor is still running.
    job.settlement.catch(() => {});
  };

  /**
   * Cancel one running job and propagate abort reason.
   *
   * @param {string} jobId
   * @param {string} [reason]
   * @returns {boolean}
   */
  const cancelJob = (jobId, reason = 'cancel_requested') => {
    assertTuiControlReason(reason);
    const job = getJob(jobId);
    if (!job) return false;
    if (job.finalized) {
      cleanupFinalizedJob(jobId);
      return true;
    }
    job.status = 'cancelling';
    job.cancelReason = reason;
    emitLog(jobId, 'info', `cancelling job (${reason})`, { reason });
    job.abortController.abort(reason);
    return true;
  };

  /**
   * Mark one tracked job as failed due to invalid request and emit terminal event.
   *
   * @param {string} jobId
   * @param {Error|string} error
   * @returns {void}
   */
  const failJobInvalidRequest = (jobId, error) => {
    const job = getJob(jobId);
    if (!job) return;
    finalizeJob(job, {
      status: 'failed',
      terminationReason: 'invalid-request',
      exitCode: null,
      signal: null,
      durationMs: 0,
      result: null,
      error: {
        message: error?.message || String(error),
        code: 'INVALID_REQUEST'
      }
    });
    cleanupFinalizedJob(jobId);
  };

  /** Run an internal operation through the same cancellation/shutdown registry.
   * Parameters and raw errors deliberately never enter progress/event logs.
   * An atomic save that already completed remains successful on late abort.
   */
  const startOperation = async ({ jobId, method }, execute,
    { timeoutMs = 15000, title = 'Settings', isCommitted = data => data?.saved === true } = {}) => {
    assertAcceptingWork({ allowPending: ['status', 'describe', 'services', 'stop-service'].includes(method) });
    assertWorkAdmission?.({ kind: 'operation', method });
    if (typeof jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(jobId)) {
      throw new Error('Internal operation requires a bounded jobId.');
    }
    if (state.jobs.has(jobId)) throw new Error('Job already exists.');
    const job = { id: jobId, seq: 0, status: 'accepted', abortController: new AbortController(),
      cancelReason: null, startedAt: Date.now(), finalized: false, internal: true };
    state.jobs.set(jobId, job);
    emit('job:start', { title, internal: true }, { jobId });
    const timer = setTimeout(() => {
      job.timedOut = true;
      cancelJob(jobId, 'operation_timeout');
    }, timeoutMs);
    const finish = payload => finalizeJob(job, { internal: true, durationMs: Date.now() - job.startedAt,
      signal: null, ...payload });
    job.settlement = Promise.resolve().then(() => execute({ signal: job.abortController.signal, operationJobId: jobId, operationOwner: job, onSpawn: child => {
      emit('job:spawn', { pid: child.pid, internal: true }, { jobId });
    } })).then(data => {
      const committed = isCommitted(data);
      if (job.abortController.signal.aborted && !committed) {
        finish({ status: job.timedOut ? 'failed' : 'cancelled', exitCode: null, result: null,
          error: { code: job.timedOut ? 'ERR_TUI_OPERATION_TIMEOUT' : 'ABORT_ERR' } });
      } else if (Buffer.byteLength(JSON.stringify(data) ?? '') > 1024 * 1024) {
        finish({ status: 'failed', exitCode: null, result: null, error: { code: 'ERR_TUI_OPERATION_OUTPUT' } });
      } else {
        finish({ status: 'done', exitCode: 0, resultState: 'complete', result: { method, data } });
      }
    }).catch(error => {
      retainPendingResource(job, error);
      const aborted = job.abortController.signal.aborted;
      finish({ status: aborted && !job.timedOut ? 'cancelled' : 'failed', exitCode: null, result: null,
        error: { code: ownedCleanupIsPending(job.resourceError) ? 'ERR_TUI_RESOURCE_PENDING'
          : job.timedOut ? 'ERR_TUI_OPERATION_TIMEOUT' : aborted ? 'ABORT_ERR'
            : String(error?.code ?? 'ERR_TUI_OPERATION_FAILED').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 80) } });
    }).finally(() => { job.settled = true; clearTimeout(timer); cleanupFinalizedJob(jobId, job); });
    job.settlement.catch(() => {});
  };

  return {
    startJob,
    startOperation,
    cancelJob,
    cleanupFinalizedJob,
    failJobInvalidRequest
  };
};
