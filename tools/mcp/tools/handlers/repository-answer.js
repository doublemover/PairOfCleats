import { resolveMcpRepoContext } from '../helpers.js';

export const runRepositoryAnswerTool = async (args, context = {}) => {
  const { runRepositoryAnswer, captureRepositoryAnswerRequest } = await import('../../../../src/integrations/tooling/repository-answer.js');
  args = captureRepositoryAnswerRequest(args);
  if (args.mode === 'inspect') return runRepositoryAnswer(args, { signal: context.signal });
  const { repoPath, userConfig } = resolveMcpRepoContext(args.mode === 'retained' ? args.repoRoot : args.query?.repoRoot, { includeRuntimeEnv: false });
  if (args.mode === 'retained') return runRepositoryAnswer({ ...args, repoRoot: repoPath }, { signal: context.signal, userConfig });
  return runRepositoryAnswer(repoPath === args.query.repoRoot ? args : { ...args, query: { ...args.query, repoRoot: repoPath } }, { signal: context.signal, userConfig });
};
