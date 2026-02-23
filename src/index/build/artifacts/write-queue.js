import { SCHEDULER_QUEUE_NAMES } from '../runtime/scheduler.js';
import { resolveEagerWriteSchedulerTokens } from './write-scheduler-tokens.js';

/**
 * Build a deterministic artifact write queue with optional eager prefetch.
 *
 * Eager entries may start scheduler work before dispatch, but dispatch order
 * remains stable because lane planning still consumes entries by enqueue `seq`.
 *
 * @param {object} input
 * @param {{schedule?:(queueName:string,tokens:object,job:()=>Promise<object|void>)=>Promise<object|void>}|null} [input.scheduler]
 * @param {number} input.massiveWriteIoTokens
 * @param {number} input.massiveWriteMemTokens
 * @param {(estimatedBytes:number|null)=>number} [input.resolveArtifactWriteMemTokens]
 * @param {() => number} [input.now]
 * @param {(input:{estimatedBytes:number|null,laneHint:string|null,massiveWriteIoTokens:number,massiveWriteMemTokens:number,resolveArtifactWriteMemTokens:(estimatedBytes:number|null)=>number})=>object} [input.resolveSchedulerTokens]
 * @returns {{writes:object[],enqueueWrite:(label:string,job:()=>Promise<object|void>,meta?:object)=>void}}
 */
export const createArtifactWriteQueue = ({
  scheduler = null,
  massiveWriteIoTokens,
  massiveWriteMemTokens,
  resolveArtifactWriteMemTokens = () => 0,
  now = Date.now,
  resolveSchedulerTokens = resolveEagerWriteSchedulerTokens
}) => {
  const writes = [];
  let enqueueSeq = 0;

  /**
   * Enqueue one artifact write with optional eager scheduler prefetch.
   *
   * @param {string} label
   * @param {() => Promise<object|void>} job
   * @param {{priority?:number,estimatedBytes?:number,laneHint?:string,eagerStart?:boolean}} [meta]
   * @returns {void}
   */
  const enqueueWrite = (label, job, meta = {}) => {
    const parsedPriority = Number(meta?.priority);
    const priority = Number.isFinite(parsedPriority) ? parsedPriority : 0;
    const parsedEstimatedBytes = Number(meta?.estimatedBytes);
    const estimatedBytes = Number.isFinite(parsedEstimatedBytes) && parsedEstimatedBytes >= 0
      ? parsedEstimatedBytes
      : null;
    const laneHint = typeof meta?.laneHint === 'string' ? meta.laneHint : null;
    const eagerStart = meta?.eagerStart === true;
    let prefetched = null;
    let prefetchStartedAt = null;

    if (eagerStart && typeof job === 'function') {
      prefetchStartedAt = now();
      const tokens = resolveSchedulerTokens({
        estimatedBytes,
        laneHint,
        massiveWriteIoTokens,
        massiveWriteMemTokens,
        resolveArtifactWriteMemTokens
      });
      try {
        prefetched = scheduler?.schedule
          ? scheduler.schedule(SCHEDULER_QUEUE_NAMES.stage2Write, tokens, job)
          : job();
      } catch (error) {
        prefetched = Promise.reject(error);
      }
      // Avoid unhandled-rejection noise for fire-and-forget prefetch.
      Promise.resolve(prefetched).catch(() => {});
    }

    writes.push({
      label,
      priority,
      estimatedBytes,
      laneHint,
      eagerStart,
      prefetched,
      prefetchStartedAt,
      seq: enqueueSeq,
      enqueuedAt: now(),
      job
    });
    enqueueSeq += 1;
  };

  return {
    writes,
    enqueueWrite
  };
};
