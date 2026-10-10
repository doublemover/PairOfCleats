import { runRuntimeEvidenceLookup, runRuntimeFamilyDiscovery } from '../../../../src/integrations/tooling/runtime-evidence.js';
import { resolveMcpRepoContext } from '../helpers.js';
const run = (runner, args, context) => {
  const { repoPath, userConfig } = resolveMcpRepoContext(args.repoRoot, { includeRuntimeEnv: false });
  return runner({ ...args, repoRoot: repoPath }, { signal: context.signal, userConfig });
};
export const runRuntimeEvidenceTool = (args, context = {}) => run(runRuntimeEvidenceLookup, args, context);
export const runRuntimeFamiliesTool = (args, context = {}) => run(runRuntimeFamilyDiscovery, args, context);
