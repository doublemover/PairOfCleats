export { prepareImportResolutionFsMeta } from './import-resolution/fs-meta.js';
export { createFsExistsIndex } from './import-resolution/fs-exists-index.js';
export { resolveImportLinks } from './import-resolution/engine.js';
export { createExpectedArtifactsIndex } from './import-resolution/expected-artifacts-index.js';
export { createImportBuildContext } from './import-resolution/build-context/index.js';
export {
  createImportResolutionBudgetPolicy,
  createImportResolutionSpecifierBudgetState
} from './import-resolution/budgets.js';
export { createImportResolutionStageTracker } from './import-resolution/stage-pipeline.js';
export {
  assertUnresolvedDecision,
  createUnresolvedDecision,
  IMPORT_DISPOSITIONS,
  IMPORT_FAILURE_CAUSES,
  IMPORT_REASON_CODES,
  IMPORT_RESOLUTION_STATES,
  IMPORT_RESOLVER_STAGES,
  normalizeUnresolvedDecision,
  resolveDecisionFromReasonCode,
  validateResolutionDecision
} from './import-resolution/reason-codes.js';
export { matchGeneratedExpectationSpecifier } from './import-resolution/specifier-hints.js';
export {
  aggregateImportResolutionGraphPayloads,
  DEFAULT_GATE_EXCLUDED_IMPORTER_SEGMENTS
} from './import-resolution/replay-harness.js';
