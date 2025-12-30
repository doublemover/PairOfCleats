import os from 'node:os';
import minimist from 'minimist';

/**
 * Parse CLI args for build_index.
 * @param {string[]} rawArgs
 * @returns {{argv:object,modes:string[]}}
 */
export function parseBuildArgs(rawArgs) {
  const argv = minimist(rawArgs, {
    boolean: ['incremental', 'stub-embeddings', 'watch'],
    string: ['model', 'watch-poll', 'watch-debounce'],
    alias: { i: 'incremental' },
    default: {
      mode: 'all',
      dims: 512,
      threads: os.cpus().length,
      incremental: false,
      'stub-embeddings': false,
      watch: false,
      'watch-poll': 2000,
      'watch-debounce': 500
    }
  });
  const modes = argv.mode === 'all' ? ['prose', 'code'] : [argv.mode];
  return { argv, modes };
}
