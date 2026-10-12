import { coercePositiveIntMinOne } from '../../../src/shared/number-coerce.js';
import { SCHEDULER_QUEUE_NAMES } from '../../../src/index/build/runtime/scheduler.js';

/** Missing FD telemetry does not override the existing static descriptor budget. */
export const resolveEmbeddingFdCap = ({ schedulerStats, staticFdCap }) => {
  const live = coercePositiveIntMinOne(schedulerStats?.adaptive?.fd?.tokenCap);
  const baseline = coercePositiveIntMinOne(staticFdCap);
  return live == null ? baseline : baseline == null ? live : Math.min(live, baseline);
};

/** Embedding file admission consumes scheduler pressure; it does not own its sampler. */
export const createEmbeddingFileAdmission = ({ scheduler, staticFdCap, baseConcurrency,
  ceiling = baseConcurrency, adaptive = true, config = {}, now = Date.now }) => {
  const settings = config || {};
  const number = (value, fallback) => value != null && Number.isFinite(Number(value)) ? Number(value) : fallback;
  const ratio = (value, fallback) => Math.max(0, Math.min(1, number(value, fallback)));
  const stepMs = Math.max(100, Math.floor(number(settings.adaptiveFileParallelismStepMs, 500)));
  const rssLow = ratio(settings.adaptiveFileParallelismRssLow, 0.6);
  const rssHigh = Math.max(rssLow, ratio(settings.adaptiveFileParallelismRssHigh, 0.88));
  const gcLow = ratio(settings.adaptiveFileParallelismGcLow, 0.2);
  const gcHigh = Math.max(gcLow, ratio(settings.adaptiveFileParallelismGcHigh, 0.45));
  const base = coercePositiveIntMinOne(baseConcurrency) || 1;
  const maximum = coercePositiveIntMinOne(ceiling) || base;
  let current = Math.min(base, maximum);
  let adjustments = 0;
  let lastPressureAdjust = -Infinity;
  const apply = (next) => {
    if (next !== current) { current = next; adjustments++; }
    return current;
  };
  return {
    resolve: () => {
      const stats = scheduler?.stats?.();
      const fdCap = resolveEmbeddingFdCap({ schedulerStats: stats, staticFdCap });
      const hardCeiling = fdCap == null ? maximum : Math.min(maximum, fdCap);
      // Hard resource limits take precedence over the adaptive switch and timer.
      apply(Math.min(current, hardCeiling));
      if (!adaptive) return apply(Math.min(base, hardCeiling));
      if (now() - lastPressureAdjust < stepMs) return current;
      const memory = stats?.adaptive?.signals?.memory;
      const rss = number(memory?.rssUtilization, NaN);
      const gc = number(memory?.gcPressureScore, NaN);
      const backlog = Math.max(0, Number(stats?.queues?.[SCHEDULER_QUEUE_NAMES.embeddingsCompute]?.pending) || 0)
        + Math.max(0, Number(stats?.queues?.[SCHEDULER_QUEUE_NAMES.embeddingsIo]?.pending) || 0);
      let next = current;
      if (rss >= rssHigh || gc >= gcHigh) next = Math.max(1, current - 1);
      else if (backlog > 0 && rss <= rssLow && gc <= gcLow) next = Math.min(hardCeiling, current + 1);
      if (next !== current) { apply(next); lastPressureAdjust = now(); }
      return current;
    },
    stats: () => ({ current, adjustments })
  };
};
