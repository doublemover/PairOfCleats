import { isDirectExecution } from '../shared/direct-execution.js';
import {
  resolveAnnActive,
  resolveProfileCohortModes,
  resolveProfileForState,
  resolveSparseFallbackModesWithoutAnn,
  resolveSparsePreflightMissingTables,
  resolveSparsePreflightModes
} from './cli/preflight.js';

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
  runSearchCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
