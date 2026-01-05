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
  if (!Object.prototype.hasOwnProperty.call(mergedOptions, 'profile')) {
    mergedOptions.profile = {
      type: 'string',
      describe: 'Profile name from profiles/*.json'
    };
  }
  const parser = yargs(hideBin(argv))
    .scriptName(name)
    .parserConfiguration(DEFAULT_PARSER_CONFIG)
    .strict(false)
    .help()
    .alias('h', 'help')
    .wrap(100);
  if (usage) parser.usage(usage);
  if (Object.keys(mergedOptions).length) parser.options(mergedOptions);
  if (Object.keys(aliases).length) parser.alias(aliases);
  parser.middleware((args) => {
    if (args.profile) {
      process.env.PAIROFCLEATS_PROFILE = String(args.profile).trim();
    }
  });
  return parser;
}
