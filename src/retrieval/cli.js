import { isDirectExecution } from '../shared/direct-execution.js';
import {
  resolveAnnActive,
  resolveProfileCohortModes,
  resolveProfileForState,
  resolveSparseFallbackModesWithoutAnn,
  resolveSparsePreflightMissingTables,
  resolveSparsePreflightModes
} from './cli/preflight.js';

// Process-local capability for coordinator-owned per-mode work, never a CLI flag.
export const INTERNAL_EXACT_SEARCH_MODE = Symbol('coordinator-exact-search-mode');

export async function runSearchCli(rawArgs = process.argv.slice(2), options = {}) {
  const { runSearchCli: runSearchCliImpl } = await import('./cli/run-search/plan-runner.js');
  return runSearchCliImpl(rawArgs, options);
}

export {
  resolveAnnActive,
  resolveProfileCohortModes,
  resolveProfileForState,
  resolveSparseFallbackModesWithoutAnn,
  resolveSparsePreflightMissingTables,
  resolveSparsePreflightModes
};

if (isDirectExecution(import.meta.url)) {
  runSearchCli().catch(async (err) => {
    const { projectIndexFormatError } = await import('../shared/index-format-error.js');
    const format = projectIndexFormatError(err);
    if (!err?.emitted) console.error(format ? JSON.stringify({ ok: false, code: format.nativeCode, message: err.message, ...format, details: format }) : err?.message || err);
    process.exit(1);
  });
}
