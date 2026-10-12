import { runSemanticTrace } from '../../../../src/integrations/tooling/semantic-trace.js';
import { resolveMcpRepoContext } from '../helpers.js';

export const runSemanticTraceTool = async (args, context = {}) => {
  const { repoPath, userConfig } = resolveMcpRepoContext(args.repoRoot, { includeRuntimeEnv: false });
  return runSemanticTrace({ ...args, repoRoot: repoPath }, { signal: context.signal, userConfig });
};
