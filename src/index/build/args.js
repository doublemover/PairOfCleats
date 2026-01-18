import { createCli } from '../../shared/cli.js';
import { INDEX_BUILD_OPTIONS, validateBuildArgs } from '../../shared/cli-options.js';

/**
 * Parse CLI args for build_index.
 * @param {string[]} rawArgs
 * @returns {{argv:object,modes:string[]}}
 */
export function parseBuildArgs(rawArgs) {
  const argv = createCli({
    scriptName: 'build-index',
    argv: ['node', 'build-index.js', ...rawArgs],
    usage: 'usage: build-index [options]',
    options: INDEX_BUILD_OPTIONS
  }).parse();
  validateBuildArgs(argv);
  const modeRaw = argv.mode || 'all';
  const normalized = String(modeRaw).trim().toLowerCase();
  const mode = normalized === 'both' ? 'all' : normalized;
  argv.mode = mode;
  const modes = mode === 'all'
    ? ['code', 'prose', 'extracted-prose', 'records']
    : (mode === 'prose' ? ['prose', 'extracted-prose'] : [mode]);
  return { argv, modes };
}
