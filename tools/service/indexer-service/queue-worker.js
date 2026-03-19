import path from 'node:path';
import { createLifecycleRegistry } from '../../../src/shared/lifecycle/registry.js';

const NOOP_ASYNC = async () => {};
const STALE_SWEEP_MIN_INTERVAL_MS = 1000;
const SHUTDOWN_POLL_INTERVAL_MS = 250;
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
  shutdownPollIntervalMs = SHUTDOWN_POLL_INTERVAL_MS
}) => {
  let staleSweepPromise = null;
  let lastStaleSweepAtMs = 0;
  const workerOwnerId = `queue-worker:${process.pid}:${Math.random().toString(16).slice(2, 10)}`;
  const activeJobControls = new Map();
  let currentShutdownState = { ...DEFAULT_SHUTDOWN_STATE };
  let shutdownMonitor = null;
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
   * @returns {{jobLifecycle:ReturnType<typeof createLifecycleRegistry>,logPath:string}}
   */
  const startJobLifecycle = (job) => {
    const jobLifecycle = createLifecycleRegistry({
      name: `indexer-service-job:${job.id}`
    });
    const abortController = new AbortController();
    const leasePolicy = resolveLeasePolicy({ job, queueName: resolvedQueueName });
    const renewalIntervalMs = Number.isFinite(Number(leasePolicy?.renewIntervalMs))
      ? Math.max(250, Math.trunc(Number(leasePolicy.renewIntervalMs)))
      : jobHeartbeatIntervalMs;
    const renewalState = {
      inFlight: false,
      consecutiveFailures: 0,
      lastSuccessAt: Date.now()
    };
    const heartbeat = setInterval(() => {
      if (renewalState.inFlight) return;
      renewalState.inFlight = true;
      void (async () => {
        const replayState = await loadJobReplayState(job);
        return await touchJobHeartbeat(queueDir, job.id, resolvedQueueName, {
          ownerId: workerOwnerId,
          expectedLeaseVersion: job?.lease?.version ?? null,
          leaseMs: leasePolicy?.leaseMs ?? null,
          renewIntervalMs: leasePolicy?.renewIntervalMs ?? null,
          progressIntervalMs: leasePolicy?.progressIntervalMs ?? null,
          minIntervalMs: renewalIntervalMs,
          replayState,
          progress: {
            kind: 'renewal',
            note: `workload=${leasePolicy?.workloadClass || 'balanced'}`
          }
        });
      })().then(() => {
        renewalState.consecutiveFailures = 0;
        renewalState.lastSuccessAt = Date.now();
      }).catch((err) => {
        renewalState.consecutiveFailures += 1;
        const gapMs = Date.now() - renewalState.lastSuccessAt;
        const failureLimit = Number.isFinite(Number(leasePolicy?.maxConsecutiveRenewalFailures))
          ? Math.max(1, Math.trunc(Number(leasePolicy.maxConsecutiveRenewalFailures)))
          : 3;
        if (renewalState.consecutiveFailures <= failureLimit || gapMs >= (leasePolicy?.maxRenewalGapMs ?? renewalIntervalMs)) {
          console.error(`[indexer] job ${job.id} lease renewal failed: ${err?.message || err}`);
        }
      }).finally(() => {
        renewalState.inFlight = false;
      });
    }, renewalIntervalMs);
    jobLifecycle.registerTimer(heartbeat, { label: 'indexer-service-job-heartbeat' });
    const logPath = job.logPath || path.join(queueDir, 'logs', `${job.id}.log`);
    const stopProgress = monitorBuildProgress
      ? startBuildProgressMonitor({ job, repoPath: job.repo, stage: job.stage })
      : NOOP_ASYNC;
    jobLifecycle.registerCleanup(() => stopProgress(), { label: 'indexer-service-progress-stop' });
    return { jobLifecycle, logPath, abortController };
  };

  const syncWorkerShutdownState = async (status = null) => {
    await updateShutdownWorkerState({
      pid: process.pid,
      ownerId: workerOwnerId,
      status: status || (activeJobControls.size > 0 ? 'running' : 'idle'),
      activeJobs: Array.from(activeJobControls.keys()),
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

  /**
   * Claim and process one queue job, including retries, subprocess execution,
   * heartbeat maintenance, and final completion updates.
   *
   * @param {{processed:number,succeeded:number,failed:number,retried:number}} metrics
   * @returns {Promise<boolean>} true when a job was claimed; false when queue is empty.
   */
  const processQueueOnce = async (metrics) => {
    await ensureStaleSweep();
    if (currentShutdownState?.stopClaiming) {
      return false;
    }
    const queueLeasePolicy = resolveLeasePolicy({ job: null, queueName: resolvedQueueName });
    const job = await claimNextJob(queueDir, resolvedQueueName, {
      ownerId: workerOwnerId,
      leaseMs: queueLeasePolicy?.leaseMs ?? null,
      renewIntervalMs: queueLeasePolicy?.renewIntervalMs ?? null,
      progressIntervalMs: queueLeasePolicy?.progressIntervalMs ?? null
    });
    if (!job) return false;
    metrics.processed += 1;
    const { jobLifecycle, logPath, abortController } = startJobLifecycle(job);
    activeJobControls.set(job.id, { abortController });
    await syncWorkerShutdownState();
    let execution = {
      handled: false,
      runResult: buildDefaultRunResult()
    };
    try {
      execution = await executeClaimedJob({ job, jobLifecycle, logPath, abortSignal: abortController.signal });
    } catch (err) {
      const message = err?.message || String(err);
      console.error(`[indexer] job ${job.id} execution failed before completion: ${message}`);
      execution = {
        handled: false,
        runResult: {
          ...buildDefaultRunResult(),
          error: message
        }
      };
    } finally {
      await jobLifecycle.close().catch(() => {});
      activeJobControls.delete(job.id);
      await syncWorkerShutdownState();
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
    const workers = Array.from({ length: concurrency }, async () => {
      let worked = !currentShutdownState?.stopClaiming;
      while (worked && !currentShutdownState?.stopClaiming) {
        worked = await processQueueOnce(metrics);
      }
    });
    await Promise.all(workers);
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
      void refreshShutdownState().catch((err) => {
        console.error(`[indexer] shutdown monitor failed: ${err?.message || err}`);
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
      await syncWorkerShutdownState('stopped').catch(() => {});
    }
  };

  return {
    processQueueOnce,
    runBatch,
    runWorkLoop
  };
};
