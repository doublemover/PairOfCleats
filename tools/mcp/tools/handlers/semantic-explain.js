import { runSemanticExplain } from '../../../../src/integrations/tooling/semantic-explain.js';
import { resolveMcpRepoContext } from '../helpers.js';

export const runSemanticExplainTool = async (args, context = {}) => {
  const { repoPath, userConfig } = resolveMcpRepoContext(args.repoRoot, { includeRuntimeEnv: false });
  return runSemanticExplain({ ...args, repoRoot: repoPath }, { signal: context.signal, userConfig });
};
