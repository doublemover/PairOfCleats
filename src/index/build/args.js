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
    options: INDEX_BUILD_OPTIONS
  }).parse();
  validateBuildArgs(argv);
  const modes = argv.mode === 'all'
    ? ['prose', 'code', 'extracted-prose']
    : [argv.mode];
  return { argv, modes };
}
