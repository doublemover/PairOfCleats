/**
 * Retrieval CLI public surface for orchestrating one-shot or federated search runs.
 * This barrel intentionally re-exports stable entrypoints used by command handlers.
 */
export { runSearchCli } from './run-search/plan-runner.js';
export { createBackendContextWithTracking } from './run-search/backend-context.js';
export { createRunSearchTelemetry } from './run-search/telemetry.js';
export {
  emitMissingQueryAndThrow,
  extractPositionalQuery,
  extractWorkspacePath,
  parseCliArgsOrThrow,
  runFederatedIfRequested
} from './run-search/options.js';
