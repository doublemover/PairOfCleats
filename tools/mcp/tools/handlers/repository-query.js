import { resolveMcpRepoContext } from '../helpers.js';

export const runRepositoryQueryTool = async (args, context = {}) => {
  const { repoPath, userConfig } = resolveMcpRepoContext(args.repoRoot, { includeRuntimeEnv: false });
  const { runRepositoryQuery } = await import('../../../../src/integrations/tooling/repository-query.js');
  return runRepositoryQuery({ ...args, repoRoot: repoPath }, { signal: context.signal, userConfig });
};
