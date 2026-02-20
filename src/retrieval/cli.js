import { fileURLToPath } from 'node:url';
import { runSearchCli } from './cli/run-search.js';
import {
  resolveAnnActive,
  resolveProfileCohortModes,
  resolveProfileForState,
  resolveSparseFallbackModesWithoutAnn,
  resolveSparsePreflightMissingTables,
  resolveSparsePreflightModes
} from './cli/preflight.js';

export {
  resolveAnnActive,
  resolveProfileCohortModes,
  resolveProfileForState,
  resolveSparseFallbackModesWithoutAnn,
  resolveSparsePreflightMissingTables,
  resolveSparsePreflightModes,
  runSearchCli
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSearchCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
