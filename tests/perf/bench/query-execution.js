import { runWithSettledConcurrency } from '../../../src/shared/concurrency/run-with-queue.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { createSearchWorkerPool, classifyQueryBackend } from './query-runtime.js';

/** Execute the admitted stages through the existing grouped pool and queue.
 * Closing a stage owns its workers before any sibling stage can be allocated. */
export const executeBenchQueryPlan = async ({ plan, tasks, runTask, workerOptions = {},
  createPool = createSearchWorkerPool, sampleParentRss = () => process.memoryUsage().rss,
  processTreeSampler = null } = {}) => {
  if (plan?.status !== 'admitted') throw Object.assign(new Error(`Benchmark query resource plan is unsupported: ${plan?.reason}`),
    { code: 'ERR_BENCH_QUERY_PLAN_UNSUPPORTED', plan });
  const stagesByClass = new Map(plan.stages.flatMap(stage => Object.keys(stage.sizeByBackend).map(key => [key, stage])));
  if (tasks.some(task => !stagesByClass.has(classifyQueryBackend(task.backend)))) throw new Error('Query task lacks an admitted resource stage.');
  const observed = { submitted: 0, completed: 0, failed: 0, activeReservations: 0, peakActiveReservations: 0,
    peakRunningQueries: 0, peakLiveWorkerProcesses: 0, peakKnownProcessRssBytes: null,
    rssScope: 'sampled-benchmark-parent-and-known-query-workers', processTreeRssPeakBytes: null,
    descendantRssCoverage: 'unavailable', incompleteRssSamples: 0, activeByBackend: {}, peakActiveByBackend: {},
    submittedByBackend: {}, completedByBackend: {}, runningByBackend: {}, peakRunningByBackend: {}, stagesCompleted: 0 };
  const live = new Map(), running = new Map();
  const sample = () => {
    const parent = sampleParentRss(), workers = [...live.values()];
    if (!Number.isFinite(parent) || workers.some(value => !Number.isFinite(value))) { observed.incompleteRssSamples++; return; }
    const value = workers.reduce((sum, rss) => sum + rss, parent);
    if (Number.isFinite(value)) observed.peakKnownProcessRssBytes = Math.max(observed.peakKnownProcessRssBytes ?? 0, value);
  };
  const onEvent = event => {
    processTreeSampler?.observeEvent(event);
    const pid = event?.pid;
    if (Number.isSafeInteger(pid) && pid > 0) {
      if (event.type === 'process-start') live.set(pid, null);
      if (event.type === 'run-start' && !running.has(pid)) {
        const backend = event.meta?.backend || 'unknown';
        running.set(pid, backend); if (!live.has(pid)) live.set(pid, null);
        observed.runningByBackend[backend] = (observed.runningByBackend[backend] || 0) + 1;
        observed.peakRunningByBackend[backend] = Math.max(observed.peakRunningByBackend[backend] || 0, observed.runningByBackend[backend]);
      }
      if (Number.isFinite(event.rssBytes) && event.rssBytes >= 0) live.set(pid, event.rssBytes);
      if (['run-complete', 'stalled', 'process-close'].includes(event.type) && running.has(pid)) {
        const backend = running.get(pid); observed.runningByBackend[backend]--; running.delete(pid);
      }
      if (event.type === 'process-close') live.delete(pid);
      observed.peakRunningQueries = Math.max(observed.peakRunningQueries, running.size);
      observed.peakLiveWorkerProcesses = Math.max(observed.peakLiveWorkerProcesses, live.size);
      sample();
    }
    workerOptions.onEvent?.(event);
  };
  sample();
  let failure, failed = false;
  const retainFailure = error => {
    failure = failed ? addStorageFailureContext(failure, {}, error, { secondaryPresent: true }) : error;
    failed = true;
  };
  try {
    for (const [stageIndex, stage] of plan.stages.entries()) {
      const selected = tasks.filter(task => stagesByClass.get(classifyQueryBackend(task.backend)) === stage);
      if (!selected.length) continue;
      let pool = null;
      try {
        await processTreeSampler?.beginPhase(`query-stage-${stageIndex}`);
        pool = createPool({ ...workerOptions, size: stage.effectiveConcurrency, sizeByBackend: stage.sizeByBackend,
          maxRunsPerWorkerByBackend: plan.backendMaxRunsPerWorker, onEvent });
        await runWithSettledConcurrency(selected, stage.effectiveConcurrency, async task => {
          const backend = task.backend;
          observed.submitted++; observed.activeReservations++;
          observed.submittedByBackend[backend] = (observed.submittedByBackend[backend] || 0) + 1;
          observed.activeByBackend[backend] = (observed.activeByBackend[backend] || 0) + 1;
          observed.peakActiveReservations = Math.max(observed.peakActiveReservations, observed.activeReservations);
          observed.peakActiveByBackend[backend] = Math.max(observed.peakActiveByBackend[backend] || 0, observed.activeByBackend[backend]);
          try {
            await runTask(task, pool);
            observed.completed++; observed.completedByBackend[backend] = (observed.completedByBackend[backend] || 0) + 1;
          } catch (error) { observed.failed++; throw error; }
          finally { observed.activeReservations--; observed.activeByBackend[backend]--; }
        });
      } catch (error) {
        retainFailure(error);
      } finally {
        try { await pool?.close(); } catch (error) { retainFailure(error); }
        try { await processTreeSampler?.endPhase(); } catch (error) { retainFailure(error); }
      }
      if (failed) break;
      observed.stagesCompleted++;
    }
  } catch (error) { retainFailure(error); }
  try {
    const measurement = await processTreeSampler?.finish();
    if (measurement) {
      observed.processTreeMemory = measurement;
      observed.processTreeRssPeakBytes = measurement.sampledPeakBytes;
      observed.processTreeRssPeakIsLowerBound = measurement.peakIsLowerBound;
      observed.processTreeRssScope = 'observed-owned-descendants-excluding-observer';
      observed.descendantRssCoverage = measurement.status;
    }
  } catch (error) { retainFailure(error); }
  if (failed) throw addStorageFailureContext(failure, { benchmarkQueryObservation: observed });
  return observed;
};
