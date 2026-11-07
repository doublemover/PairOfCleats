import path from 'node:path';
import { buildSearchArgs } from './args.js';

/** One argv owner for core execution and federation policy admission. */
export const buildCoreSearchInvocation = (repoRoot, params = {}) => {
  const root = repoRoot ? path.resolve(repoRoot) : params.root ? path.resolve(params.root) : null;
  if (params.argsMode != null && !['additional', 'complete'].includes(params.argsMode)) throw new TypeError('argsMode must be additional or complete.');
  if (params.args != null && !Array.isArray(params.args)) throw new TypeError('Search args must be an array.');
  const namedArgs = buildSearchArgs({ ...params, args: [] });
  const rawArgs = params.argsMode === 'complete' ? (params.args || []).slice() : [...namedArgs, ...(params.args || [])];
  const query = typeof params.query === 'string' ? params.query : '';
  if (query) rawArgs.push('--', query);
  return { root, rawArgs };
};
