import path from 'node:path';
import { startClaimRenewal } from './claim-renewal.js';
import { createLifecycleRegistry } from '../../../src/shared/lifecycle/registry.js';
import { createCorrelationId, normalizeObservability } from '../../../src/shared/observability.js';
import { captureQueueFailureOwnership, createQueueCleanupRecovery, queueCleanupRecoveryError } from '../queue-cleanup.js';

const NOOP_ASYNC = async () => {};
const failureMessage = (error, observations, secondary) => {
  try {
    const message = error?.message;
    return typeof message === 'string' ? message
      : error !== null && ['object', 'function'].includes(typeof error) ? 'Owned execution failed.' : String(error);
  } catch (inspection) {
    secondary.push(inspection);
    const observation = captureQueueFailureOwnership(inspection);
    if (observation.present) observations.push(observation);
    return 'Owned execution failure diagnosis is unreadable.';
  }
};
export const bindClaimedJobExecution = (job) => {
  const parent = normalizeObservability(job.observability, {
    surface: 'service', operation: 'indexer-job', context: { jobId: job.id }
  });
  return { ...job, ...(job.lease ? { lease: { ...job.lease } } : {}),
    ...(job.delivery ? { delivery: { ...job.delivery } } : {}), observability: { ...parent, correlation: {
      ...parent.correlation,
      parentCorrelationId: parent.correlation.correlationId,
      correlationId: createCorrelationId('service-execution')
    } } };
};
const STALE_SWEEP_MIN_INTERVAL_MS = 1000;
const SHUTDOWN_POLL_INTERVAL_MS = 250;
const LEASE_FENCE_ERRORS = new Set(['QUEUE_LEASE_MISMATCH', 'QUEUE_LEASE_VERSION_MISMATCH', 'QUEUE_INVALID_TRANSITION']);
const DEFAULT_SHUTDOWN_STATE = Object.freeze({
  mode: 'running',
  accepting: true,
  stopClaiming: false,
  forceAbort: false,
  deadlineAt: null
});

/**
 * Create queue worker orchestration helpers for job lifecycle and watch-loop
 * draining behavior.
 *
 * @param {{
 *   queueDir:string,
 *   resolvedQueueName:string|null,
 *   staleQueueMaxRetries:number,
 *   admissionPolicy?:object|null,
 *   sloPolicy?:object|null,
 *   monitorBuildProgress:boolean,
 *   startBuildProgressMonitor:(input:{job:{id:string},repoPath:string,stage?:string|null})=>() => Promise<void>,
 *   touchJobHeartbeat:(dirPath:string,jobId:string,queueName?:string|null)=>Promise<unknown>,
 *   requeueStaleJobs:(dirPath:string,queueName?:string|null,options?:object)=>Promise<unknown>,
 *   claimNextJob:(dirPath:string,queueName?:string|null)=>Promise<object|null>,
 *   ensureQueueDir:(dirPath:string)=>Promise<void>,
 *   executeClaimedJob:(input:{job:object,jobLifecycle:ReturnType<typeof createLifecycleRegistry>,logPath:string})=>Promise<{handled:boolean,runResult?:object}>,
 *   finalizeJobRun:(input:{job:object,runResult:object,metrics:{processed:number,succeeded:number,failed:number,retried:number}})=>Promise<void>,
 *   buildDefaultRunResult:()=>{exitCode:number,executionMode:string,daemon:object|null,cancelled:boolean,shutdownMode:string|null},
 *   printPayload:(payload:object)=>void,
 *   summarizeBackpressure?:()=>Promise<object|null>,
 *   describeOperationalEnvelope?:()=>Promise<object|null>,
 *   loadJobReplayState?:(job:object)=>Promise<object|null>,
 *   queueSummary?:()=>Promise<{queued:number,running:number,total:number,done:number,failed:number,retries:number}>,
 *   loadShutdownState?:()=>Promise<{mode:string,accepting:boolean,stopClaiming:boolean,forceAbort:boolean,deadlineAt:string|null}>,
 *   requestShutdownState?:(input:{mode:string,timeoutMs?:number|null,requestedBy?:string,source?:string})=>Promise<object|null>,
 *   updateShutdownWorkerState?:(patch:object)=>Promise<object|null>,
 *   completeShutdownState?:(input:{reason?:string|null})=>Promise<object|null>,
 *   resolveLeasePolicy?:(input:{job:object|null,queueName:string|null})=>{leaseMs:number,renewIntervalMs:number,progressIntervalMs:number,workloadClass:string,maxRenewalGapMs:number,maxConsecutiveRenewalFailures:number},
 *   jobHeartbeatIntervalMs?:number,
 *   shutdownPollIntervalMs?:number
 * }} input
 * @returns {{
 *   processQueueOnce:(metrics:{processed:number,succeeded:number,failed:number,retried:number})=>Promise<boolean>,
 *   runBatch:(concurrency:number)=>Promise<void>,
 *   runWorkLoop:(input:{requestedConcurrency:number,intervalMs:number,watch?:boolean,serviceExecutionMode:string})=>Promise<void>
 * }}
 */
export const createQueueWorker = ({
  queueDir,
  resolvedQueueName,
  staleQueueMaxRetries,
  admissionPolicy = null,
  sloPolicy = null,
  monitorBuildProgress,
  startBuildProgressMonitor,
  touchJobHeartbeat,
  requeueStaleJobs,
  claimNextJob,
  ensureQueueDir,
  executeClaimedJob,
  finalizeJobRun,
  buildDefaultRunResult,
  printPayload,
  summarizeBackpressure = async () => null,
  describeOperationalEnvelope = async () => null,
  loadJobReplayState = async () => null,
  queueSummary = async () => ({ total: 0, queued: 0, running: 0, done: 0, failed: 0, retries: 0 }),
  loadShutdownState = async () => DEFAULT_SHUTDOWN_STATE,
  requestShutdownState = async () => DEFAULT_SHUTDOWN_STATE,
  updateShutdownWorkerState = async () => null,
  completeShutdownState = async () => null,
  resolveLeasePolicy = () => ({
    leaseMs: 5 * 60 * 1000,
    renewIntervalMs: 30 * 1000,
    progressIntervalMs: 30 * 1000,
    workloadClass: 'balanced',
    maxRenewalGapMs: 60 * 1000,
    maxConsecutiveRenewalFailures: 3
  }),
  jobHeartbeatIntervalMs = 30000,
  shutdownPollIntervalMs = SHUTDOWN_POLL_INTERVAL_MS,
  retainJobCleanup = async (...args) => (await import('../queue.js')).retainJobCleanup(...args),
  reconcileJobCleanup = async (...args) => (await import('../queue.js')).reconcileJobCleanup(...args)
}) => {
  let staleSweepPromise = null;
  let lastStaleSweepAtMs = 0;
  const workerOwnerId = `queue-worker:${process.pid}:${Math.random().toString(16).slice(2, 10)}`;
  const activeJobControls = new Set();
  const pendingRetirements = new Set();
  let cleanupRecoveryPromise = null;
  let currentShutdownState = { ...DEFAULT_SHUTDOWN_STATE };
  let shutdownMonitor = null;
  let shutdownRefreshPromise = null;
  let escalatedDeadlineAt = null;

  /**
   * Deduplicate concurrent stale-sweep scans across workers.
   *
   * This keeps queue semantics the same while avoiding repeated lock contention
   * when multiple workers ask for stale requeue checks at the same moment.
   *
   * @returns {Promise<void>}
   */
  const ensureStaleSweep = async () => {
    const now = Date.now();
    if ((now - lastStaleSweepAtMs) < STALE_SWEEP_MIN_INTERVAL_MS) {
      return;
    }
    if (!staleSweepPromise) {
      staleSweepPromise = requeueStaleJobs(queueDir, resolvedQueueName, {
        maxRetries: staleQueueMaxRetries
      }).finally(() => {
        lastStaleSweepAtMs = Date.now();
        staleSweepPromise = null;
      });
    }
    await staleSweepPromise;
  };

  /**
   * Create lifecycle resources for one claimed queue job.
   *
   * @param {{id:string,repo:string,stage?:string|null,logPath?:string|null}} job
   * @param {ReturnType<typeof createLifecycleRegistry>} jobLifecycle
   * @returns {{logPath:string}}
   */
  const startJobLifecycle = (job, jobLifecycle, claimControl) => {
    const leasePolicy = resolveLeasePolicy({ job, queueName: resolvedQueueName });
    startClaimRenewal({ job, ownerId: workerOwnerId,
      leasePolicy: { ...leasePolicy, renewIntervalMs: leasePolicy?.renewIntervalMs ?? jobHeartbeatIntervalMs }, jobLifecycle, claimControl,
      loadReplayState: loadJobReplayState,
      touchHeartbeat: options => touchJobHeartbeat(queueDir, job.id, resolvedQueueName, options) });
    const logPath = job.logPath || path.join(queueDir, 'logs', `${job.id}.log`);
    if (claimControl.leaseLost) return { logPath };
    const stopProgress = monitorBuildProgress
      ? startBuildProgressMonitor({ job, repoPath: job.repo, stage: job.stage, expectRuntimeBinding: true })
      : NOOP_ASYNC;
    jobLifecycle.registerCleanup(() => stopProgress(), { label: 'indexer-service-progress-stop' });
    return { logPath, onRuntimeBinding: stopProgress.bindRuntime };
  };

  const syncWorkerShutdownState = async (status = null) => {
    await updateShutdownWorkerState({
      pid: process.pid,
      ownerId: workerOwnerId,
      status: pendingRetirements.size ? 'cleanup-pending' : status || (activeJobControls.size > 0 ? 'running' : 'idle'),
      activeJobs: [...new Set(Array.from(activeJobControls.values(), control => control.jobId))],
      lastSeenAt: new Date().toISOString()
    });
  };

  const abortActiveJobs = (mode) => {
    for (const jobControl of activeJobControls.values()) {
      if (jobControl.abortController.signal.aborted) continue;
      try {
        jobControl.abortController.abort(new Error(`service shutdown: ${mode}`));
      } catch {}
    }
  };

  const refreshShutdownState = async () => {
    currentShutdownState = await loadShutdownState();
    const deadlineMs = Date.parse(currentShutdownState?.deadlineAt || '');
    if (
      currentShutdownState?.mode !== 'force-stop'
      && !Number.isNaN(deadlineMs)
      && deadlineMs <= Date.now()
      && currentShutdownState?.deadlineAt !== escalatedDeadlineAt
    ) {
      escalatedDeadlineAt = currentShutdownState.deadlineAt;
      currentShutdownState = await requestShutdownState({
        mode: 'force-stop',
        timeoutMs: null,
        requestedBy: workerOwnerId,
        source: 'timeout-escalation'
      });
    }
    if (currentShutdownState?.forceAbort) {
      abortActiveJobs(currentShutdownState.mode);
    }
    await syncWorkerShutdownState(
      currentShutdownState?.mode === 'drain'
        ? 'draining'
        : currentShutdownState?.stopClaiming
          ? 'stopping'
          : null
    );
    return currentShutdownState;
  };

  const performCleanupRecovery = async (metrics = null) => {
    let recovered = 0;
    for (const retirement of [...pendingRetirements]) {
      const { capability, job, claimControl } = retirement;
      try {
        await retainJobCleanup(queueDir, resolvedQueueName, capability);
        await reconcileJobCleanup(queueDir, resolvedQueueName, capability);
      } catch (error) {
        if (error?.queueCleanupRecovery !== capability) {
          const observation = captureQueueFailureOwnership(error);
          if (observation.present && !observation.released()) retirement.observations.push(observation);
        }
        retirement.error = queueCleanupRecoveryError(capability, [error]);
        throw retirement.error;
      }
      // Resource recovery preserves the failed disposer outcome. It never
      // retries work or turns an earlier nominal process exit into job success.
      pendingRetirements.delete(retirement); activeJobControls.delete(claimControl);
      claimControl.cleanupSettled = true;
      claimControl.checkLeaseAuthority?.();
      recovered++;
      try {
        if (!claimControl.leaseLost) {
          const recoveryMetrics = metrics || { processed: 0, succeeded: 0, failed: 0, retried: 0 };
          recoveryMetrics.processed++;
          await finalizeJobRun({ job: { ...job, maxRetries: 0 }, metrics: recoveryMetrics,
            runResult: { ...buildDefaultRunResult(), exitCode: 1, cancelled: false,
              error: 'Original resource cleanup failed; exact owner settlement was subsequently confirmed.' } });
        }
      } catch (error) {
        if (!LEASE_FENCE_ERRORS.has(error?.code)) throw error;
      } finally { await syncWorkerShutdownState(); }
    }
    return { recovered, pending: pendingRetirements.size };
  };
  const recoverPendingCleanup = (metrics = null) => {
    if (!cleanupRecoveryPromise) {
      cleanupRecoveryPromise = performCleanupRecovery(metrics).finally(() => { cleanupRecoveryPromise = null; });
      cleanupRecoveryPromise.catch(() => {});
    }
    return cleanupRecoveryPromise;
  };

  /**
   * Claim and process one queue job, including retries, subprocess execution,
   * heartbeat maintenance, and final completion updates.
   *
   * @param {{processed:number,succeeded:number,failed:number,retried:number}} metrics
   * @returns {Promise<boolean>} true when a job was claimed; false when queue is empty.
   */
  const processQueueOnce = async (metrics, batchState = null) => {
    if (batchState?.failed) return false;
    await recoverPendingCleanup(metrics);
    await ensureStaleSweep();
    if (currentShutdownState?.stopClaiming || batchState?.failed) {
      return false;
    }
    const queueLeasePolicy = resolveLeasePolicy({ job: null, queueName: resolvedQueueName });
    const job = await claimNextJob(queueDir, resolvedQueueName, {
      admissionPolicy,
      sloPolicy,
      ownerId: workerOwnerId,
      leaseMs: queueLeasePolicy?.leaseMs ?? null,
      renewIntervalMs: queueLeasePolicy?.renewIntervalMs ?? null,
      progressIntervalMs: queueLeasePolicy?.progressIntervalMs ?? null
    });
    if (!job) return false;
    // A claim owns one execution correlation, even if two jobs inherit the same
    // request correlation or explicitly resume the same build generation.
    const executionJob = bindClaimedJobExecution(job);
    metrics.processed += 1;
    // Establish ownership before any fallible post-claim setup.
    const jobLifecycle = createLifecycleRegistry({ name: `indexer-service-job:${job.id}` });
    const abortController = new AbortController();
    // A stale recovery may reclaim an ID while its old execution is still
    // draining. The exact control owns one claim, never the reusable job ID.
    const claimControl = { jobId: job.id, abortController, leaseLost: null };
    let execution = {
      handled: false,
      runResult: buildDefaultRunResult()
    };
    let executionFailed = false, executionError, retirement;
    const observations = [], cleanupErrors = [];
    try {
      activeJobControls.add(claimControl);
      if (batchState?.failed) {
        // A claim already in flight still belongs to this batch. Settle its
        // completion policy without starting new work after the fatal lane.
        abortController.abort(batchState.error);
        execution.runResult = {
          ...execution.runResult, exitCode: 130, cancelled: true, shutdownMode: 'cancel'
        };
      } else {
        const { logPath, onRuntimeBinding } = startJobLifecycle(executionJob, jobLifecycle, claimControl);
        await syncWorkerShutdownState();
        claimControl.checkLeaseAuthority?.();
        if (batchState?.failed || claimControl.leaseLost) {
          if (!abortController.signal.aborted) abortController.abort(batchState?.error || claimControl.leaseLost);
          execution.runResult = {
            ...execution.runResult, exitCode: 130, cancelled: true, shutdownMode: 'cancel'
          };
        } else {
          execution = await executeClaimedJob({ job: executionJob, jobLifecycle, logPath,
            abortSignal: abortController.signal, onRuntimeBinding });
        }
      }
    } catch (err) {
      executionFailed = true; executionError = err;
      const observation = captureQueueFailureOwnership(err);
      if (observation.present && !observation.released()) observations.push(observation);
      const message = failureMessage(err, observations, cleanupErrors);
      console.error(`[indexer] job ${job.id} execution failed before completion: ${message}`);
      execution = {
        handled: false,
        runResult: {
          ...buildDefaultRunResult(),
          error: message
        }
      };
    } finally {
      await jobLifecycle.close().catch(err => {
        cleanupErrors.push(err);
        observations.push(captureQueueFailureOwnership(err, { required: true }));
        console.error(`[indexer] job ${job.id} resource cleanup failed: ${failureMessage(err, observations, cleanupErrors)}`);
      });
      if (observations.length) {
        retirement = { job, claimControl, observations, ...createQueueCleanupRecovery({ dirPath: queueDir,
          queueName: resolvedQueueName, job, observations,
          causes: [...(executionFailed ? [executionError] : []), ...cleanupErrors] }) };
        pendingRetirements.add(retirement);
        try { await retainJobCleanup(queueDir, resolvedQueueName, retirement.capability); }
        catch (error) {
          const observation = captureQueueFailureOwnership(error);
          if (observation.present && !observation.released()) observations.push(observation);
          retirement.error = queueCleanupRecoveryError(retirement.capability, [error]);
        }
      } else activeJobControls.delete(claimControl);
      try {
        await syncWorkerShutdownState();
      } catch (err) {
        // Telemetry persistence must not prevent the claimed job's completion.
        console.error(`[indexer] job ${job.id} shutdown state update failed: ${err?.message || err}`);
      }
    }
    if (retirement) throw retirement.error;
    if (claimControl.leaseLost) {
      console.error(`[indexer] job ${job.id} completion skipped after lease loss: ${claimControl.leaseLost.message}`);
      return true;
    }
    if (execution?.handled) {
      // `handled` jobs are completed out-of-band (currently non-retriable failures),
      // so they still count toward failure metrics.
      metrics.failed += 1;
      return true;
    }
    try {
      await finalizeJobRun({
        job,
        runResult: execution?.runResult || buildDefaultRunResult(),
        metrics
      });
    } catch (err) {
      if (
        err?.code === 'QUEUE_LEASE_MISMATCH'
        || err?.code === 'QUEUE_LEASE_VERSION_MISMATCH'
        || err?.code === 'QUEUE_INVALID_TRANSITION'
      ) {
        console.error(`[indexer] job ${job.id} completion skipped: ${err.message}`);
        return true;
      }
      throw err;
    }
    return true;
  };

  /**
   * Drain queue jobs with bounded concurrency for one polling cycle.
   *
   * @param {number} concurrency
   * @returns {Promise<void>}
   */
  const runBatch = async (concurrency) => {
    const metrics = { processed: 0, succeeded: 0, failed: 0, retried: 0 };
    const batchState = { failed: false, error: null };
    const workers = Array.from({ length: concurrency }, async () => {
      try {
        let worked = !currentShutdownState?.stopClaiming;
        while (worked && !currentShutdownState?.stopClaiming && !batchState.failed) {
          worked = await processQueueOnce(metrics, batchState);
        }
      } catch (error) {
        if (!batchState.failed) {
          batchState.failed = true;
          batchState.error = error;
          abortActiveJobs('cancel');
        }
        throw error;
      }
    });
    const settled = await Promise.allSettled(workers);
    if (batchState.failed) {
      const errors = [batchState.error, ...settled
        .filter(result => result.status === 'rejected' && result.reason !== batchState.error)
        .map(result => result.reason)];
      if (errors.length === 1) throw batchState.error;
      throw new AggregateError(errors, 'Queue batch failed; all owned lanes have settled.', { cause: batchState.error });
    }
    if (metrics.processed) {
      const backpressure = await summarizeBackpressure();
      const envelope = await describeOperationalEnvelope();
      printPayload({
        ok: true,
        queue: resolvedQueueName,
        metrics,
        ...(envelope ? { envelope } : {}),
        ...(backpressure ? { backpressure } : {}),
        at: new Date().toISOString()
      });
    }
  };

  /**
   * Run one batch and optional watch loop using queue worker options.
   *
   * @param {{requestedConcurrency:number,intervalMs:number,watch?:boolean,serviceExecutionMode:string}} input
   * @returns {Promise<void>}
   */
  const runWorkLoop = async ({ requestedConcurrency, intervalMs, watch = false, serviceExecutionMode }) => {
    await ensureQueueDir(queueDir);
    await refreshShutdownState();
    const concurrency = serviceExecutionMode === 'daemon' && monitorBuildProgress
      ? 1
      : requestedConcurrency;
    if (concurrency !== requestedConcurrency) {
      console.error(`[indexer] daemon execution enforces concurrency=1 (requested=${requestedConcurrency}).`);
    }
    shutdownMonitor = setInterval(() => {
      if (shutdownRefreshPromise) return;
      shutdownRefreshPromise = refreshShutdownState().catch((err) => {
        console.error(`[indexer] shutdown monitor failed: ${err?.message || err}`);
      }).finally(() => {
        shutdownRefreshPromise = null;
      });
    }, Math.max(100, shutdownPollIntervalMs));
    try {
      while (true) {
        await refreshShutdownState();
        await runBatch(concurrency);
        const summary = await queueSummary();
        if (currentShutdownState?.mode === 'drain' && summary.queued === 0 && summary.running === 0) {
          await completeShutdownState({ reason: 'drain-complete' });
          return;
        }
        if (currentShutdownState?.mode === 'cancel' && activeJobControls.size === 0) {
          await completeShutdownState({ reason: 'cancel-complete' });
          return;
        }
        if (currentShutdownState?.mode === 'force-stop' && activeJobControls.size === 0) {
          await completeShutdownState({ reason: 'force-stop-complete' });
          return;
        }
        if (!watch) return;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    } finally {
      if (shutdownMonitor) {
        clearInterval(shutdownMonitor);
        shutdownMonitor = null;
      }
      await shutdownRefreshPromise;
      await syncWorkerShutdownState('stopped').catch(() => {});
    }
  };

  return {
    processQueueOnce,
    runBatch,
    runWorkLoop,
    recoverPendingCleanup
  };
};
