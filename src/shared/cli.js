import path from 'node:path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

const DEFAULT_PARSER_CONFIG = {
  'camel-case-expansion': false,
  'dot-notation': false
};

/**
 * Create a configured yargs instance for CLI tools.
 * @param {{argv?:string[],scriptName?:string,usage?:string,options?:object,aliases?:object}} input
 * @returns {import('yargs').Argv}
 */
export function createCli(input = {}) {
  const {
    argv = process.argv,
    scriptName,
    usage,
    options = {},
    aliases = {}
  } = input;
  const name = scriptName || path.basename(argv[1] || 'cli');
  const parser = yargs(hideBin(argv))
    .scriptName(name)
    .parserConfiguration(DEFAULT_PARSER_CONFIG)
    .strict(false)
    .help()
    .alias('h', 'help')
    .wrap(100);
  if (usage) parser.usage(usage);
  if (Object.keys(options).length) parser.options(options);
  if (Object.keys(aliases).length) parser.alias(aliases);
  return parser;
}
