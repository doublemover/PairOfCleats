import { normalizeSchedulerMaxPending } from '../../../src/shared/concurrency/scheduler-core-policy.js';
import { SCHEDULER_QUEUE_NAMES } from '../../../src/index/build/runtime/scheduler.js';

/** Use scheduler's null/unlimited contract for both initial and adaptive admission. */
export const createEmbeddingWriterAdmission = ({ scheduler, indexingConfig = {}, now = Date.now }) => {
  const initialStats = scheduler?.stats?.();
  const queueLimit = (stats) => normalizeSchedulerMaxPending(
    stats?.queues?.[SCHEDULER_QUEUE_NAMES.embeddingsIo]?.maxPending
  );
  const ioTokens = Math.max(1, Number(initialStats?.tokens?.io?.total) || 1);
  const defaultLimit = Math.max(1, Math.min(4, ioTokens * 2));
  const schedulerLimit = queueLimit(initialStats);
  const initialLimit = schedulerLimit == null ? defaultLimit : Math.min(defaultLimit, schedulerLimit);
  const ceiling = Math.max(initialLimit, Math.min(16, initialLimit * 2));
  const floor = Math.max(1, Math.ceil(initialLimit * 0.5));
  const config = indexingConfig?.embeddings || {};
  const stepMs = Number.isFinite(Number(config.writerAdaptiveStepMs))
    ? Math.max(100, Math.floor(Number(config.writerAdaptiveStepMs))) : 500;
  const rssLow = Number.isFinite(Number(config.writerAdaptiveRssLow))
    ? Math.max(0, Math.min(1, Number(config.writerAdaptiveRssLow))) : 0.62;
  const rssHigh = Number.isFinite(Number(config.writerAdaptiveRssHigh))
    ? Math.max(rssLow, Math.min(1, Number(config.writerAdaptiveRssHigh))) : 0.9;
  let limit = initialLimit;
  let lastAdjust = -Infinity;
  let reason = schedulerLimit != null && schedulerLimit < defaultLimit ? 'scheduler' : 'default';
  return {
    initialLimit,
    resolve: () => {
      if (now() - lastAdjust < stepMs) return limit;
      const stats = scheduler?.stats?.();
      const cap = queueLimit(stats);
      const effectiveCeiling = cap == null ? ceiling : Math.min(ceiling, cap);
      const effectiveFloor = Math.min(floor, effectiveCeiling);
      limit = Math.max(effectiveFloor, Math.min(limit, effectiveCeiling));
      reason = cap != null && cap <= limit ? 'scheduler' : 'default';
      const memory = stats?.adaptive?.signals?.memory;
      if (memory?.rssUtilization == null || memory?.gcPressureScore == null) return limit;
      const rss = Number(memory.rssUtilization), gc = Number(memory.gcPressureScore);
      if (!Number.isFinite(rss) || !Number.isFinite(gc)) return limit;
      if (rss >= rssHigh || gc >= 0.4) {
        limit = Math.max(effectiveFloor, limit - 1);
        reason = 'memory-pressure';
        lastAdjust = now();
      } else if (rss <= rssLow && gc <= 0.2) {
        limit = Math.min(effectiveCeiling, limit + 1);
        reason = cap != null && limit >= cap ? 'scheduler' : 'low-pressure';
        lastAdjust = now();
      }
      return limit;
    },
    stats: () => ({ reason, limit, initialLimit })
  };
};
