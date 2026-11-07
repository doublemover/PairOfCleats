import { SEARCH_OPTIONS, SEARCH_ALIASES } from '../../src/retrieval/cli-options.js';

/** Read the running checker's canonical option definitions, never execute a
 * source file selected through the documentation root argument.
 */
export const collectSearchOptionFlags = (options = SEARCH_OPTIONS, aliases = SEARCH_ALIASES) => {
  const keys = options && typeof options === 'object' && !Array.isArray(options) ? Object.keys(options) : [];
  const invalid = message => Object.assign(new Error(message), { code: 'ERR_SEARCH_OPTION_INVENTORY' });
  if (!keys.length) throw invalid('Canonical search option inventory is unexpectedly empty.');
  const flags = new Set(keys.map(key => `--${key}`));
  for (const [alias, target] of Object.entries(aliases)) {
    if (!keys.includes(target) && target !== 'help') throw invalid(`Unknown canonical search alias target: ${target}`);
    flags.add(`--${target}`);
    flags.add(`${alias.length === 1 ? '-' : '--'}${alias}`);
  }
  return flags;
};
