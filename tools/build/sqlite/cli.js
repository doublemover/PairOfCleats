import { createCli } from '../../../src/shared/cli.js';

export const normalizeValidateMode = (value) => {
  if (value === false || value == null) return 'off';
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === 'true') return 'smoke';
  if (['off', 'false', '0', 'no'].includes(normalized)) return 'off';
  if (['full', 'integrity'].includes(normalized)) return 'full';
  if (['auto', 'adaptive'].includes(normalized)) return 'auto';
  return 'smoke';
};

export const parseBuildSqliteArgs = (rawArgs, options = {}) => {
  const emitOutput = options.emitOutput !== false;
  const exitOnError = options.exitOnError !== false;
  const argv = createCli({
    scriptName: 'build-sqlite-index',
    argv: ['node', 'tools/build/sqlite-index.js', ...(rawArgs || [])],
    options: {
      'code-dir': { type: 'string' },
      'prose-dir': { type: 'string' },
      'extracted-prose-dir': { type: 'string' },
      'records-dir': { type: 'string' },
      out: { type: 'string' },
      mode: { type: 'string', default: 'all' },
      repo: { type: 'string' },
      incremental: { type: 'boolean', default: false },
      compact: { type: 'boolean', default: false },
      'no-compact': { type: 'boolean', default: false },
      validate: { type: 'string', default: 'smoke' },
      'index-root': { type: 'string' },
      progress: { type: 'string', default: 'auto' },
      verbose: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false }
    }
  }).parse();
  const validateMode = normalizeValidateMode(argv.validate);
  const modeArg = (argv.mode || 'all').toLowerCase();
  return {
    argv,
    emitOutput,
    exitOnError,
    validateMode,
    modeArg,
    rawArgs: rawArgs || []
  };
};
