import yargs from 'yargs/yargs';

/**
 * Parse CLI args for build_index.
 * @param {string[]} rawArgs
 * @returns {{argv:object,modes:string[]}}
 */
export function parseBuildArgs(rawArgs) {
  const argv = yargs(rawArgs)
    .parserConfiguration({
      'camel-case-expansion': false,
      'dot-notation': false
    })
    .options({
      mode: { type: 'string', default: 'all' },
      stage: { type: 'string' },
      dims: { type: 'number', default: 384 },
      threads: { type: 'number' },
      incremental: { type: 'boolean', default: false, alias: 'i' },
      'stub-embeddings': { type: 'boolean', default: false },
      watch: { type: 'boolean', default: false },
      'watch-poll': { type: 'number', default: 2000 },
      'watch-debounce': { type: 'number', default: 500 },
      sqlite: { type: 'boolean' },
      'debug-crash': { type: 'boolean', default: false },
      model: { type: 'string' },
      repo: { type: 'string' }
    })
    .help()
    .alias('h', 'help')
    .parse();
  const modes = argv.mode === 'all' ? ['prose', 'code'] : [argv.mode];
  return { argv, modes };
}
