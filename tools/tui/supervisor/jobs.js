import path from 'node:path';
import { spawnSubprocess } from '../../../src/shared/subprocess.js';
import { applyProgressContextEnv } from '../../../src/shared/progress.js';
import { clampInt } from '../../../src/shared/limits.js';
import { collectJobArtifacts } from './artifacts.js';
import { createJobStreamDecoder } from './progress-decoder.js';
import {
  nowIso,
  parseResultFromStdout,
  resolveResultPolicy,
  resolveRetryPolicy,
  resolveRunRequest,
  sleep
} from './request-utils.js';
import { createJobWatchdogController, resolveWatchdogPolicy } from './watchdog.js';

/**
 * Build and expose job lifecycle operations for the supervisor runtime.
 *
 * @param {{
 *  state:{jobs:Map<string,object>},
 *  runId:string,
 *  root:string,
 *  emit:(event:string,payload?:object,options?:{jobId?:string|null,critical?:boolean})=>void,
 *  emitLog:(jobId:string|null,level:'info'|'warn'|'error',message:string,extra?:object)=>void,
 *  buildFlowSnapshot:(input?:{includeChunked?:boolean})=>object
 * }} input
 * @returns {{
 *  startJob:(request:object)=>Promise<void>,
 *  cancelJob:(jobId:string,reason?:string)=>boolean,
 *  cleanupFinalizedJob:(jobId:string)=>void,
 *  failJobInvalidRequest:(jobId:string,error:Error|string)=>void
 * }}
 */
export const createJobController = ({ state, runId, root, emit, emitLog, buildFlowSnapshot }) => {
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
  const cleanupFinalizedJob = (jobId) => {
    const job = getJob(jobId);
    if (!job || !job.finalized) return;
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
    emit('job:end', payload, { jobId: job.id });
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
      const artifacts = await collectJobArtifacts({ request, cwd });
      emit('job:artifacts', {
        artifacts,
        artifactsIndexed: true,
        source: 'supervisor'
      }, { jobId: job.id });
    } catch (error) {
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
  const startJob = async (request) => {
    const jobId = String(request?.jobId || '').trim();
    if (!jobId) {
      throw new Error('job:run requires jobId.');
    }
    if (state.jobs.has(jobId)) {
      throw new Error(`job already exists: ${jobId}`);
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
      finalized: false
    };
    state.jobs.set(jobId, job);

    emit('job:start', {
      command: Array.isArray(request?.argv) ? request.argv : [],
      cwd: request?.cwd ? path.resolve(String(request.cwd)) : process.cwd(),
      title,
      requested: {
        progressMode: request?.progressMode || 'jsonl',
        resultPolicy,
        retry: retryPolicy,
        watchdog: watchdogPolicy
      }
    }, { jobId });

    /**
     * Run one attempt of the configured command with stream decoding and watchdogs.
     *
     * @param {number} attempt
     * @returns {Promise<object>}
     */
    const runAttempt = async (attempt) => {
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
        lastActivityAt = Date.now();
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
        const result = await spawnSubprocess(command, args, {
          cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          rejectOnNonZeroExit: false,
          signal: job.abortController.signal,
          timeoutMs: effectiveTimeoutMs,
          onSpawn: (child) => {
            job.pid = child?.pid || null;
            job.status = 'running';
            markActivity();
            emit('job:spawn', {
              pid: job.pid,
              spawnedAt: nowIso()
            }, { jobId });
          },
          onStdout: (chunk) => stdoutDecoder.push(chunk),
          onStderr: (chunk) => stderrDecoder.push(chunk)
        });

        stdoutDecoder.flush();
        stderrDecoder.flush();

        const cancelled = job.abortController.signal.aborted;
        const status = cancelled
          ? 'cancelled'
          : (result.exitCode === 0 ? 'done' : 'failed');
        const payload = {
          status,
          exitCode: cancelled ? 130 : (result.exitCode ?? null),
          signal: result.signal || null,
          durationMs: Math.max(0, Date.now() - startedAt),
          result: parseResultFromStdout(result.stdout, resultPolicy),
          error: status === 'failed'
            ? {
              message: `job failed with exit code ${result.exitCode ?? 'unknown'}`,
              code: 'JOB_FAILED'
            }
            : null
        };

        if (status === 'failed' && attempt < retryPolicy.maxAttempts) {
          emitLog(jobId, 'warn', `attempt ${attempt} failed; retrying (${attempt + 1}/${retryPolicy.maxAttempts})`, {
            attempt,
            maxAttempts: retryPolicy.maxAttempts
          });
          if (retryPolicy.delayMs > 0) {
            await sleep(retryPolicy.delayMs);
          }
          return runAttempt(attempt + 1);
        }

        finalizeJob(job, payload);
        await emitArtifacts(job, request, { cwd });
      } catch (error) {
        const cancelled = job.abortController.signal.aborted || error?.name === 'AbortError';
        const cancelReason = job.cancelReason || String(job.abortController.signal.reason || '');
        const payload = {
          status: cancelled ? 'cancelled' : 'failed',
          exitCode: cancelled ? 130 : null,
          signal: null,
          durationMs: Math.max(0, Date.now() - startedAt),
          result: null,
          error: {
            message: error?.message || String(error),
            code: cancelled ? (cancelReason || 'CANCELLED') : 'SPAWN_FAILED'
          }
        };
        if (!cancelled && attempt < retryPolicy.maxAttempts) {
          emitLog(jobId, 'warn', `attempt ${attempt} failed; retrying (${attempt + 1}/${retryPolicy.maxAttempts})`, {
            attempt,
            maxAttempts: retryPolicy.maxAttempts,
            error: payload.error.message
          });
          if (retryPolicy.delayMs > 0) {
            await sleep(retryPolicy.delayMs);
          }
          return runAttempt(attempt + 1);
        }
        finalizeJob(job, payload);
        await emitArtifacts(job, request, { cwd });
      } finally {
        watchdog.stop();
      }
      return null;
    };

    runAttempt(1).catch(async (error) => {
      if (job.finalized) return;
      finalizeJob(job, {
        status: 'failed',
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
        cwd: request?.cwd ? path.resolve(String(request.cwd)) : process.cwd()
      });
    }).finally(() => {
      job.status = job.status === 'cancelled' ? 'cancelled' : (job.status || 'done');
      cleanupFinalizedJob(jobId);
    });
  };

  /**
   * Cancel one running job and propagate abort reason.
   *
   * @param {string} jobId
   * @param {string} [reason]
   * @returns {boolean}
   */
  const cancelJob = (jobId, reason = 'cancel_requested') => {
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

  return {
    startJob,
    cancelJob,
    cleanupFinalizedJob,
    failJobInvalidRequest
  };
};
