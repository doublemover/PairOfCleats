import { resolveTaskFactory } from '../../../shared/cli/noop-task.js';
import { markBuildPhase, startBuildHeartbeat } from '../../../index/build/build-state.js';
import { SCHEMA_VERSION } from '../schema.js';
import { resolveBundleWorkerAutotune } from './runner/build.js';
import { resolveSqliteBundleWorkerProfilePath } from './runner/config.js';
import { executeSqliteModeBuilds } from './runner/execution-orchestration.js';
import { createRunnerLogger } from './runner/logging.js';
import { normalizeModeArg, normalizeValidateMode } from './runner/options.js';
import { resolveRunnerSelectionPlan } from './runner/selection-planning.js';

export { normalizeValidateMode } from './runner/options.js';

/**
 * Build sqlite indexes without CLI parsing.
 * @param {object} options
 * @param {string} options.root
 * @param {string} [options.mode]
 * @param {boolean} [options.incremental]
 * @param {boolean} [options.compact]
 * @param {string} [options.out]
 * @param {string} [options.indexRoot]
 * @param {string} [options.asOf]
 * @param {string} [options.snapshot]
 * @param {string} [options.codeDir]
 * @param {string} [options.proseDir]
 * @param {string} [options.extractedProseDir]
 * @param {string} [options.recordsDir]
 * @param {string|boolean} [options.validateMode]
 * @param {number} [options.batchSize]
 * @param {string} [options.progress]
 * @param {boolean} [options.verbose]
 * @param {boolean} [options.quiet]
 * @param {string[]} [options.rawArgs]
 * @param {object|null} [options.logger]
 * @param {boolean} [options.emitOutput]
 * @param {boolean} [options.exitOnError]
 * @returns {Promise<{ok:boolean,mode:string,outPath:string,outputPaths:object}>}
 */
export async function buildSqliteIndex(options = {}) {
  const modeArg = normalizeModeArg(options.mode);
  const validateMode = normalizeValidateMode(options.validateMode ?? options.validate);
  const root = options.root || options.runtime?.root || null;
  const argv = {
    repo: root,
    mode: modeArg,
    incremental: options.incremental === true,
    compact: options.compact === true,
    'no-compact': options.compact === true ? false : (options.noCompact === true),
    validate: validateMode,
    out: options.out || null,
    'index-root': options.indexRoot || null,
    'as-of': options.asOf || null,
    snapshot: options.snapshot || null,
    'code-dir': options.codeDir || null,
    'prose-dir': options.proseDir || null,
    'extracted-prose-dir': options.extractedProseDir || null,
    'records-dir': options.recordsDir || null,
    'batch-size': options.batchSize ?? null,
    progress: options.progress || 'auto',
    verbose: options.verbose === true,
    quiet: options.quiet === true
  };
  const parsed = {
    argv,
    emitOutput: options.emitOutput !== false,
    exitOnError: options.exitOnError === true,
    validateMode,
    modeArg,
    rawArgs: Array.isArray(options.rawArgs) ? options.rawArgs : []
  };
  return runBuildSqliteIndexWithConfig(parsed, {
    logger: options.logger || null,
    root,
    runtime: options.runtime || null,
    userConfig: options.userConfig || null,
    envelope: options.envelope || null,
    threadLimits: options.threadLimits || null,
    repoCacheRoot: options.repoCacheRoot || null,
    metricsDir: options.metricsDir || null,
    taskFactory: options.taskFactory || null,
    onFinalize: options.onFinalize || null,
    indexRoot: options.indexRoot || null,
    out: options.out || null,
    codeDir: options.codeDir || null,
    proseDir: options.proseDir || null,
    extractedProseDir: options.extractedProseDir || null,
    recordsDir: options.recordsDir || null,
    emitOutput: options.emitOutput !== false,
    exitOnError: options.exitOnError === true
  });
}

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {}

/**
 * Build sqlite indexes from artifacts or incremental bundles.
 * @param {object} parsed
 * @param {object} [options]
 * @param {object} [options.logger]
 * @param {string} [options.root]
 * @returns {Promise<{ok:boolean,mode:string,outPath:string,outputPaths:object}>}
 */
export async function runBuildSqliteIndexWithConfig(parsed, options = {}) {
  const {
    argv,
    emitOutput,
    exitOnError,
    validateMode,
    modeArg,
    rawArgs: parsedRawArgs
  } = parsed;
  const externalLogger = options.logger && typeof options.logger === 'object'
    ? options.logger
    : null;
  const taskFactory = resolveTaskFactory(options.taskFactory);
  let stopHeartbeat = () => {};
  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    stopHeartbeat();
    if (typeof options.onFinalize === 'function') {
      try {
        options.onFinalize();
      } catch {}
    }
  };
  process.once('exit', finalize);
  const { log, warn, error } = createRunnerLogger({
    emitOutput,
    externalLogger
  });
  const bail = (message, code = 1) => {
    if (message) error(message);
    finalize();
    if (exitOnError) process.exit(code);
    throw new Error(message || 'SQLite index build failed.');
  };
  if (!Database) return bail('better-sqlite3 is required. Run npm install first.');

  try {
    const selection = await resolveRunnerSelectionPlan({
      Database,
      argv,
      modeArg,
      parsedRawArgs,
      options
    });
    if (selection.errorMessage) {
      return bail(selection.errorMessage);
    }
    const {
      modeList,
      outPath,
      modeOutputPaths,
      hasBuildState,
      indexRoot,
      threadLimits,
      incrementalRequested
    } = selection;
    stopHeartbeat = hasBuildState ? startBuildHeartbeat(indexRoot, 'stage4') : () => {};

    if (emitOutput && argv.verbose === true) {
      log(
        `[sqlite] Thread limits (${threadLimits.source}): ` +
        `cpu=${threadLimits.cpuCount}, cap=${threadLimits.maxConcurrencyCap}, ` +
        `files=${threadLimits.fileConcurrency}, imports=${threadLimits.importConcurrency}, ` +
        `io=${threadLimits.ioConcurrency}, cpuWork=${threadLimits.cpuConcurrency}.`
      );
    }
    if (argv.compact && argv['no-compact']) {
      return bail('Cannot use --compact and --no-compact together.');
    }

    if (hasBuildState) {
      await markBuildPhase(indexRoot, 'stage4', 'running');
    }

    await executeSqliteModeBuilds({
      Database,
      argv,
      validateMode,
      emitOutput,
      exitOnError,
      externalLogger,
      taskFactory,
      logger: { log, warn, error },
      schemaVersion: SCHEMA_VERSION,
      bail,
      ...selection
    });

    if (hasBuildState) {
      await markBuildPhase(indexRoot, 'stage4', 'done');
    }

    if (emitOutput && incrementalRequested) {
      const summary = modeList.length > 1 ? 'indexes updated' : 'index updated';
      log(`[sqlite] ${summary}.`);
    }
    return { ok: true, mode: modeArg, outPath, outputPaths: modeOutputPaths };
  } finally {
    finalize();
  }
}

export const sqliteBuildRunnerInternals = Object.freeze({
  resolveSqliteBundleWorkerProfilePath,
  resolveBundleWorkerAutotune
});
