/**
 * Throughput/benchmark metrics contract surface for bench tooling.
 *
 * This module intentionally re-exports stable helpers and schema constants so
 * benchmark runners/reporters can consume a single import path while keeping
 * implementation files split by concern.
 */
export {
  formatDuration,
  formatGb,
  formatLoc,
  stripMaxOldSpaceFlag,
  getRecommendedHeapMb,
  formatMetricSummary
} from './metrics/format.js';

/**
 * Stage timing and throughput ledger schema contracts shared by benchmark
 * producers and downstream regression analyzers.
 */
export {
  STAGE_TIMING_SCHEMA_VERSION,
  STAGE_TIMING_STAGE_KEYS,
  STAGE_TIMING_BREAKDOWN_KEYS,
  THROUGHPUT_LEDGER_SCHEMA_VERSION,
  THROUGHPUT_LEDGER_MODALITY_KEYS,
  THROUGHPUT_LEDGER_STAGE_KEYS,
  createEmptyStageTimingProfile,
  mergeStageTimingProfile,
  finalizeStageTimingProfile,
  buildStageTimingProfileForTask,
  isValidThroughputLedger,
  buildThroughputLedgerForTask
} from './metrics/stage-ledger.js';

/**
 * Throughput diff/regression helpers used by report generation.
 */
export {
  THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION,
  getBestHitRate,
  computeLowHitSeverity,
  computeThroughputLedgerRegression
} from './metrics/regression.js';

/**
 * Source sizing metrics used for build-rate normalization.
 */
export {
  buildLineStats,
  validateEncodingFixtures
} from './metrics/line-stats.js';

export { formatDurationMs } from '../../../src/shared/time-format.js';
