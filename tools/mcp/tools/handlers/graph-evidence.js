import { resolveMcpRepoContext } from '../helpers.js';
export const runGraphEvidenceTool = async (args, context = {}) => {
  const { runGraphEvidence } = await import('../../../../src/integrations/tooling/graph-evidence.js');
  const { repoPath, userConfig } = resolveMcpRepoContext(args.repoRoot, { includeRuntimeEnv: false });
  return runGraphEvidence({ ...args, repoRoot: repoPath }, { signal: context.signal, userConfig });
};
