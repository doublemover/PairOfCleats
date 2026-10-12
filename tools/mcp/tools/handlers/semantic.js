import { runSemanticDetail } from '../../../../src/integrations/tooling/semantic-detail.js';
import { resolveMcpRepoContext } from '../helpers.js';

export const runSemanticDetailTool = async (args, context = {}) => {
  const { repoPath, userConfig } = resolveMcpRepoContext(args.repoRoot, { includeRuntimeEnv: false });
  return runSemanticDetail({ ...args, repoRoot: repoPath }, { signal: context.signal, userConfig });
};
