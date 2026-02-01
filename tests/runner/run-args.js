import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

export const parseArgs = () => {
  const parser = yargs(hideBin(process.argv))
    .scriptName('pairofcleats test')
    .parserConfiguration({
      'camel-case-expansion': false,
      'dot-notation': false,
      'populate--': true
    })
    .usage('pairofcleats test [selectors...] [options] [-- <pass-through args>]')
    .option('lane', { type: 'string', array: true, default: [] })
    .option('tag', { type: 'string', array: true, default: [] })
    .option('exclude-tag', { type: 'string', array: true, default: [] })
    .option('match', { type: 'string', array: true, default: [] })
    .option('exclude', { type: 'string', array: true, default: [] })
    .option('list', { type: 'boolean', default: false })
    .option('list-lanes', { type: 'boolean', default: false })
    .option('list-tags', { type: 'boolean', default: false })
    .option('config', { type: 'string', default: '' })
    .option('no-color', { type: 'boolean', default: false })
    .option('jobs', { type: 'number' })
    .option('retries', { type: 'number' })
    .option('timeout-ms', { type: 'number' })
    .option('allow-timeouts', { type: 'boolean', default: false })
    .option('fail-fast', { type: 'boolean', default: false })
    .option('quiet', { type: 'boolean', default: false })
    .option('json', { type: 'boolean', default: false })
    .option('junit', { type: 'string', default: '' })
    .option('log-dir', { type: 'string', default: '' })
    .option('timings-file', { type: 'string', default: '' })
    .option('node-options', { type: 'string', default: '' })
    .option('max-old-space-mb', { type: 'number' })
    .option('pairofcleats-threads', { type: 'number' })
    .help()
    .alias('h', 'help')
    .strictOptions()
    .exitProcess(false)
    .fail((msg, err, y) => {
      const message = msg || err?.message;
      if (message) console.error(message);
      y.showHelp();
      process.exit(2);
    });
  return parser.parse();
};
