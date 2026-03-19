import path from 'node:path';
import { createLifecycleRegistry } from '../../../src/shared/lifecycle/registry.js';

const NOOP_ASYNC = async () => {};
const STALE_SWEEP_MIN_INTERVAL_MS = 1000;

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
 *   buildDefaultRunResult:()=>{exitCode:number,executionMode:string,daemon:object|null},
 *   printPayload:(payload:object)=>void,
 *   resolveLeasePolicy?:(input:{job:object|null,queueName:string|null})=>{leaseMs:number,renewIntervalMs:number,progressIntervalMs:number,workloadClass:string,maxRenewalGapMs:number,maxConsecutiveRenewalFailures:number},
 *   jobHeartbeatIntervalMs?:number
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
  resolveLeasePolicy = () => ({
    leaseMs: 5 * 60 * 1000,
    renewIntervalMs: 30 * 1000,
    progressIntervalMs: 30 * 1000,
    workloadClass: 'balanced',
    maxRenewalGapMs: 60 * 1000,
    maxConsecutiveRenewalFailures: 3
  }),
  jobHeartbeatIntervalMs = 30000
}) => {
  let staleSweepPromise = null;
  let lastStaleSweepAtMs = 0;
  const workerOwnerId = `queue-worker:${process.pid}:${Math.random().toString(16).slice(2, 10)}`;

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
      void touchJobHeartbeat(queueDir, job.id, resolvedQueueName, {
        ownerId: workerOwnerId,
        expectedLeaseVersion: job?.lease?.version ?? null,
        leaseMs: leasePolicy?.leaseMs ?? null,
        renewIntervalMs: leasePolicy?.renewIntervalMs ?? null,
        progressIntervalMs: leasePolicy?.progressIntervalMs ?? null,
        minIntervalMs: renewalIntervalMs,
        progress: {
          kind: 'renewal',
          note: `workload=${leasePolicy?.workloadClass || 'balanced'}`
        }
      }).then(() => {
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
    return { jobLifecycle, logPath };
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
    const queueLeasePolicy = resolveLeasePolicy({ job: null, queueName: resolvedQueueName });
    const job = await claimNextJob(queueDir, resolvedQueueName, {
      ownerId: workerOwnerId,
      leaseMs: queueLeasePolicy?.leaseMs ?? null,
      renewIntervalMs: queueLeasePolicy?.renewIntervalMs ?? null,
      progressIntervalMs: queueLeasePolicy?.progressIntervalMs ?? null
    });
    if (!job) return false;
    metrics.processed += 1;
    const { jobLifecycle, logPath } = startJobLifecycle(job);
    let execution = {
      handled: false,
      runResult: buildDefaultRunResult()
    };
    try {
      execution = await executeClaimedJob({ job, jobLifecycle, logPath });
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
      let worked = true;
      while (worked) {
        worked = await processQueueOnce(metrics);
      }
    });
    await Promise.all(workers);
    if (metrics.processed) {
      printPayload({
        ok: true,
        queue: resolvedQueueName,
        metrics,
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
    const concurrency = serviceExecutionMode === 'daemon' && monitorBuildProgress
      ? 1
      : requestedConcurrency;
    if (concurrency !== requestedConcurrency) {
      console.error(`[indexer] daemon execution enforces concurrency=1 (requested=${requestedConcurrency}).`);
    }
    await runBatch(concurrency);
    if (watch) {
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        await runBatch(concurrency);
      }
    }
  };

  return {
    processQueueOnce,
    runBatch,
    runWorkLoop
  };
};
