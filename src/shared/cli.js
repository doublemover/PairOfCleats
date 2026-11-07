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
  const mergedOptions = { ...options };
  const parser = yargs(hideBin(argv))
    .scriptName(name)
    .parserConfiguration(DEFAULT_PARSER_CONFIG)
    .strict(false)
    .help()
    .alias('h', 'help')
    .wrap(100);
  // A metadata request must terminate before a permissive leaf can perform work.
  // Respect an explicitly declared command-specific short option.
  const ownsShortVersion = Object.hasOwn(options, 'v') || Object.hasOwn(aliases, 'v')
    || Object.values(options).some(value => [value?.alias].flat().includes('v'))
    || Object.values(aliases).some(value => [value].flat().includes('v'));
  parser.version();
  if (!ownsShortVersion) parser.alias('v', 'version');
  if (usage) parser.usage(usage);
  if (Object.keys(mergedOptions).length) parser.options(mergedOptions);
  if (Object.keys(aliases).length) parser.alias(aliases);
  return parser;
}
