import { resolveMcpRepoContext } from '../helpers.js';

export const runRepositoryQueryTool = async (args, context = {}) => {
  const { runRepositoryQuery, captureRepositoryQueryRequest } = await import('../../../../src/integrations/tooling/repository-query.js');
  args = captureRepositoryQueryRequest(args);
  const { repoPath, userConfig } = resolveMcpRepoContext(args.repoRoot, { includeRuntimeEnv: false });
  return runRepositoryQuery(repoPath === args.repoRoot ? args : { ...args, repoRoot: repoPath }, { signal: context.signal, userConfig });
};
