import { runRuntimeEvidenceLookup, runRuntimeFamilyDiscovery } from '../../../../src/integrations/tooling/runtime-evidence.js';
import { resolveMcpRepoContext } from '../helpers.js';
import { runRuntimeCaptureComparison, runRuntimeDerivedClaimLookup } from '../../../../src/integrations/tooling/runtime-claims.js';
const run = (runner, args, context) => {
  const { repoPath, userConfig } = resolveMcpRepoContext(args.repoRoot, { includeRuntimeEnv: false });
  return runner({ ...args, repoRoot: repoPath }, { signal: context.signal, userConfig });
};
export const runRuntimeEvidenceTool = (args, context = {}) => run(runRuntimeEvidenceLookup, args, context);
export const runRuntimeFamiliesTool = (args, context = {}) => run(runRuntimeFamilyDiscovery, args, context);
export const runRuntimeCompareTool = (args, context = {}) => run(runRuntimeCaptureComparison, args, context);
export const runRuntimeClaimsTool = (args, context = {}) => run(runRuntimeDerivedClaimLookup, args, context);
