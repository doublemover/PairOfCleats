/**
 * Append a normalized CLI flag/value pair to an args array.
 *
 * `true` emits `--name`, `false` emits `--no-name`, and other non-null values
 * emit `--name <value>`.
 *
 * @param {string[]} args
 * @param {string} name
 * @param {unknown} value
 * @returns {void}
 */
const pushFlag = (args, name, value) => {
  if (value === undefined || value === null) return;
  if (value === true) {
    args.push(`--${name}`);
  } else if (value === false) {
    args.push(`--no-${name}`);
  } else {
    args.push(`--${name}`, String(value));
  }
};

const hasRawFlag = (rawArgv, flag) => Array.isArray(rawArgv)
  && rawArgv.some((arg) => arg === flag || String(arg).startsWith(`${flag}=`));

const readRawFlagValue = (rawArgv, name) => {
  if (!Array.isArray(rawArgv) || !name) return undefined;
  const flag = `--${name}`;
  for (let i = 0; i < rawArgv.length; i += 1) {
    const token = String(rawArgv[i]);
    if (token === flag) {
      const next = rawArgv[i + 1];
      if (next == null) return undefined;
      if (String(next).startsWith('--')) return undefined;
      return next;
    }
    if (token.startsWith(`${flag}=`)) {
      return token.slice(flag.length + 1);
    }
  }
  return undefined;
};

const pushBooleanStage2Flag = (args, rawArgv, name, value) => {
  const positive = `--${name}`;
  const negative = `--no-${name}`;
  const hasPositive = hasRawFlag(rawArgv, positive);
  const hasNegative = hasRawFlag(rawArgv, negative);
  if (!hasPositive && !hasNegative) return;
  if (value == null) {
    args.push(hasNegative ? negative : positive);
    return;
  }
  pushFlag(args, name, value);
};

const pushValueStage2Flag = (args, rawArgv, name, value) => {
  const flag = `--${name}`;
  if (!hasRawFlag(rawArgv, flag)) return;
  if (value == null) {
    const rawValue = readRawFlagValue(rawArgv, name);
    if (rawValue == null) return;
    args.push(flag, String(rawValue));
    return;
  }
  pushFlag(args, name, value);
};

/**
 * Build normalized raw `index build` CLI args from integration options.
 *
 * @param {object} [options]
 * @returns {string[]}
 */
export const buildRawArgs = (options = {}) => {
  const args = [];
  if (options.mode) args.push('--mode', String(options.mode));
  if (options.quality) args.push('--quality', String(options.quality));
  if (options.stage) args.push('--stage', String(options.stage));
  if (options.dims !== undefined) args.push('--dims', String(options.dims));
  if (options.threads !== undefined) args.push('--threads', String(options.threads));
  if (options.incremental) args.push('--incremental');
  if (options['cache-rebuild'] === true || options.cacheRebuild === true) args.push('--cache-rebuild');
  if (options['stub-embeddings'] || options.stubEmbeddings) args.push('--stub-embeddings');
  if (options.watch) args.push('--watch');
  if (options['watch-poll'] !== undefined) args.push('--watch-poll', String(options['watch-poll']));
  if (options['watch-debounce'] !== undefined) args.push('--watch-debounce', String(options['watch-debounce']));
  if (options.sqlite === true) args.push('--sqlite');
  if (options.sqlite === false) args.push('--no-sqlite');
  if (options['sqlite-batch-size'] !== undefined || options.sqliteBatchSize !== undefined) {
    args.push('--sqlite-batch-size', String(options['sqlite-batch-size'] ?? options.sqliteBatchSize));
  }
  pushFlag(args, 'scheduler', options.scheduler);
  pushFlag(args, 'scheduler-low-resource', options['scheduler-low-resource'] ?? options.schedulerLowResource);
  if (options['scheduler-cpu'] !== undefined || options.schedulerCpu !== undefined) {
    args.push('--scheduler-cpu', String(options['scheduler-cpu'] ?? options.schedulerCpu));
  }
  if (options['scheduler-io'] !== undefined || options.schedulerIo !== undefined) {
    args.push('--scheduler-io', String(options['scheduler-io'] ?? options.schedulerIo));
  }
  if (options['scheduler-mem'] !== undefined || options.schedulerMem !== undefined) {
    args.push('--scheduler-mem', String(options['scheduler-mem'] ?? options.schedulerMem));
  }
  if (options['scheduler-starvation'] !== undefined || options.schedulerStarvation !== undefined) {
    args.push('--scheduler-starvation', String(options['scheduler-starvation'] ?? options.schedulerStarvation));
  }
  const scmAnnotate = options['no-scm-annotate'] === true || options.noScmAnnotate === true
    ? false
    : (options['scm-annotate'] ?? options.scmAnnotate);
  pushFlag(args, 'scm-annotate', scmAnnotate);
  if (options['scm-provider'] || options.scmProvider) {
    args.push('--scm-provider', String(options['scm-provider'] ?? options.scmProvider));
  }
  if (options.model) args.push('--model', String(options.model));
  return args;
};

/**
 * Build search CLI args with consistent boolean flag normalization.
 *
 * @param {object} [params]
 * @returns {string[]}
 */
export const buildSearchArgs = (params = {}) => {
  const args = [];
  pushFlag(args, 'as-of', params.asOf);
  pushFlag(args, 'snapshot', params.snapshot);
  pushFlag(args, 'mode', params.mode);
  pushFlag(args, 'backend', params.backend);
  pushFlag(args, 'ann', params.ann);
  pushFlag(args, 'allow-sparse-fallback', params.allowSparseFallback);
  pushFlag(args, 'allow-unsafe-mix', params.allowUnsafeMix);
  pushFlag(args, 'ann-backend', params.annBackend);
  pushFlag(args, 'json', params.json);
  pushFlag(args, 'explain', params.explain);
  pushFlag(args, 'context', params.context);
  pushFlag(args, 'n', params.n);
  pushFlag(args, 'case', params.case);
  pushFlag(args, 'case-file', params.caseFile);
  pushFlag(args, 'case-tokens', params.caseTokens);
  pushFlag(args, 'path', params.path);
  pushFlag(args, 'file', params.file);
  pushFlag(args, 'ext', params.ext);
  pushFlag(args, 'lang', params.lang);
  if (params.args) args.push(...params.args);
  return args;
};

/**
 * Normalize stage aliases into canonical stage identifiers.
 *
 * @param {string} raw
 * @returns {'stage1'|'stage2'|'stage3'|'stage4'|null}
 */
export const normalizeStage = (raw) => {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value) return null;
  if (value === '1' || value === 'stage1' || value === 'sparse') return 'stage1';
  if (value === '2' || value === 'stage2' || value === 'enrich' || value === 'full') return 'stage2';
  if (value === '3' || value === 'stage3' || value === 'embeddings' || value === 'embed') return 'stage3';
  if (value === '4' || value === 'stage4' || value === 'sqlite' || value === 'ann') return 'stage4';
  return null;
};

/**
 * Build canonical stage2 invocation args from parsed CLI/runtime options.
 *
 * @param {{root:string,argv:object,rawArgv:string[]}} input
 * @returns {string[]}
 */
export const buildStage2Args = ({ root, argv, rawArgv }) => {
  const args = ['--repo', root, '--stage', 'stage2'];
  if (argv.mode && argv.mode !== 'all') args.push('--mode', argv.mode);
  if (argv.quality) args.push('--quality', String(argv.quality));
  pushValueStage2Flag(args, rawArgv, 'dims', argv.dims);
  const stageThreads = Number(argv.threads);
  if (Number.isFinite(stageThreads) && stageThreads > 0) {
    args.push('--threads', String(stageThreads));
  }
  if (argv.incremental) args.push('--incremental');
  const cacheRebuild = argv['cache-rebuild'] === true || rawArgv.includes('--cache-rebuild');
  if (cacheRebuild) args.push('--cache-rebuild');
  if (rawArgv.includes('--stub-embeddings')) args.push('--stub-embeddings');
  if (typeof argv.sqlite === 'boolean') args.push(argv.sqlite ? '--sqlite' : '--no-sqlite');
  pushValueStage2Flag(args, rawArgv, 'sqlite-batch-size', argv['sqlite-batch-size'] ?? argv.sqliteBatchSize);
  pushBooleanStage2Flag(args, rawArgv, 'scheduler', argv.scheduler);
  pushBooleanStage2Flag(
    args,
    rawArgv,
    'scheduler-low-resource',
    argv['scheduler-low-resource'] ?? argv.schedulerLowResource
  );
  pushValueStage2Flag(args, rawArgv, 'scheduler-cpu', argv['scheduler-cpu'] ?? argv.schedulerCpu);
  pushValueStage2Flag(args, rawArgv, 'scheduler-io', argv['scheduler-io'] ?? argv.schedulerIo);
  pushValueStage2Flag(args, rawArgv, 'scheduler-mem', argv['scheduler-mem'] ?? argv.schedulerMem);
  pushValueStage2Flag(
    args,
    rawArgv,
    'scheduler-starvation',
    argv['scheduler-starvation'] ?? argv.schedulerStarvation
  );
  pushBooleanStage2Flag(args, rawArgv, 'scm-annotate', argv['scm-annotate'] ?? argv.scmAnnotate);
  pushValueStage2Flag(args, rawArgv, 'scm-provider', argv['scm-provider'] ?? argv.scmProvider);
  if (argv.model) args.push('--model', String(argv.model));
  return args;
};
