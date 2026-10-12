import { resolveMcpRepoContext } from '../helpers.js';
import { runSemanticEnrichment } from '../../../../src/integrations/tooling/semantic-enrichment.js';
export const runSemanticEnrichmentTool = (args, context = {}) => {
  const { repoPath, userConfig } = resolveMcpRepoContext(args.repoRoot, { includeRuntimeEnv: false });
  return runSemanticEnrichment({ ...args, repoRoot: repoPath }, { signal: context.signal, userConfig });
};
