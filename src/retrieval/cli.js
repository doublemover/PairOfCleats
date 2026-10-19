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
  runSearchCli().catch(async (err) => {
    const { projectIndexFormatError } = await import('../shared/index-format-error.js');
    const format = projectIndexFormatError(err);
    if (!err?.emitted) console.error(format ? JSON.stringify({ ok: false, code: format.nativeCode, message: err.message, ...format, details: format }) : err?.message || err);
    process.exit(1);
  });
}
