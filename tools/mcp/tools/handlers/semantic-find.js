import { runSemanticFind } from '../../../../src/integrations/tooling/semantic-find.js';
import { resolveMcpRepoContext } from '../helpers.js';

export const runSemanticFindTool = async (args, context = {}) => {
  const { repoPath, userConfig } = resolveMcpRepoContext(args.repoRoot, { includeRuntimeEnv: false });
  return runSemanticFind({ ...args, repoRoot: repoPath }, { signal: context.signal, userConfig });
};
