import path from 'node:path';
import { createBuildRuntime } from '../../../../index/build/runtime.js';
import { markBuildPhase, updateBuildState } from '../../../../index/build/build-state.js';
import { isAbortError, throwIfAborted } from '../../../../shared/abort.js';
import { SCHEDULER_QUEUE_NAMES } from '../../../../index/build/runtime/scheduler.js';
import { getCurrentBuildInfo, getIndexDir } from '../../../../../tools/shared/dict-utils.js';
import { buildSqliteIndex } from '../sqlite.js';
import { teardownRuntime } from '../runtime.js';
import { markFailedPhases, toPhaseFailureDetail } from './phase-failures.js';
import { dedupeModeList } from './modes.js';
import { createSqliteDirResolver, resolveSqliteModeList } from './sqlite-paths.js';
import { runPromotionPhase } from './promotion.js';

/**
 * Execute SQLite materialization stage and optional promotion.
 *
 * Stage transition contract:
 * 1. Mark `stage4` running before any sqlite materialization begins.
 * 2. Mark `stage4` done and update build state only after sqlite writes succeed.
 * 3. Run `promote` transition under global lock unless explicit `--index-root` requests skip.
 * 4. On failure, mark any active phase as failed before rethrowing.
 *
 * @param {object} input
 * @param {string} input.root
 * @param {object} input.argv
 * @param {string[]} input.rawArgv
 * @param {object} input.policy
 * @param {object|null} input.userConfig
 * @param {string[]} input.sqliteModes
 * @param {boolean} input.shouldBuildSqlite
 * @param {boolean} input.includeSqlite
 * @param {{current?:{advance?:(state:object)=>void}}} input.overallProgressRef
 * @param {(line:string)=>void} input.log
 * @param {AbortSignal|null} input.abortSignal
 * @param {(stage:string,status:'ok'|'error'|'aborted',started:bigint)=>void} input.recordIndexMetric
 * @param {object} input.options
 * @param {object} input.sqliteLogger
 * @returns {Promise<object>}
 */
export const runSqliteStage = async ({
  root,
  argv,
  rawArgv,
  policy,
  userConfig,
  sqliteModes,
  shouldBuildSqlite,
  includeSqlite,
  overallProgressRef,
  log,
  abortSignal,
  recordIndexMetric,
  options,
  sqliteLogger
}) => {
  const started = process.hrtime.bigint();
  const recordOk = (result) => {
    recordIndexMetric('stage4', 'ok', started);
    return result;
  };
  let runtime = null;
  try {
    throwIfAborted(abortSignal);
    if (!shouldBuildSqlite) {
      log('SQLite disabled; skipping stage4.');
      return recordOk({ modes: sqliteModes, sqlite: { skipped: true }, repo: root, stage: 'stage4' });
    }

    // Throughput: preserve caller-facing `modes` while avoiding duplicate execution work.
    const executionSqliteModes = dedupeModeList(sqliteModes);
    if (!executionSqliteModes.length) {
      return recordOk({ modes: sqliteModes, sqlite: null, repo: root, stage: 'stage4' });
    }

    const explicitIndexRoot = argv['index-root'] ? path.resolve(argv['index-root']) : null;
    const buildInfo = explicitIndexRoot
      ? null
      : getCurrentBuildInfo(root, userConfig, { mode: executionSqliteModes[0] || null });
    if (!explicitIndexRoot && !buildInfo?.buildRoot) {
      throw new Error('Missing current build for SQLite stage. Run stage2 first or pass --index-root.');
    }
    const runtimeIndexRoot = explicitIndexRoot
      || buildInfo?.buildRoots?.[executionSqliteModes[0]]
      || buildInfo?.buildRoot
      || null;
    runtime = await createBuildRuntime({
      root,
      argv: { ...argv, stage: 'stage4' },
      rawArgv,
      policy,
      indexRoot: runtimeIndexRoot
    });
    const scheduleSqlite = (fn) => (runtime?.scheduler?.schedule
      ? runtime.scheduler.schedule(SCHEDULER_QUEUE_NAMES.stage4Sqlite, { cpu: 1, io: 1 }, fn)
      : fn());
    const resolveSqliteDirs = createSqliteDirResolver({ root, userConfig, getIndexDir });
    const stage4PhaseState = { running: false, done: false };
    const promotePhaseState = { running: false, done: false };
    try {
      await markBuildPhase(runtime.buildRoot, 'stage4', 'running');
      stage4PhaseState.running = true;
      let sqliteResult = null;
      const sqliteModeList = resolveSqliteModeList(executionSqliteModes);
      for (const mode of sqliteModeList) {
        throwIfAborted(abortSignal);
        const indexRoot = explicitIndexRoot
          || buildInfo?.buildRoots?.[mode]
          || buildInfo?.buildRoot
          || runtime?.buildRoot
          || null;
        if (!indexRoot) {
          throw new Error(`Missing index root for SQLite stage (mode=${mode}).`);
        }
        const sqliteDirs = resolveSqliteDirs(indexRoot);
        sqliteResult = await scheduleSqlite(() => buildSqliteIndex(root, {
          mode,
          incremental: argv.incremental === true,
          batchSize: argv['sqlite-batch-size'],
          indexRoot,
          out: sqliteDirs.sqliteOut,
          runtime,
          codeDir: sqliteDirs.codeDir,
          proseDir: sqliteDirs.proseDir,
          extractedProseDir: sqliteDirs.extractedProseDir,
          recordsDir: sqliteDirs.recordsDir,
          emitOutput: options.emitOutput !== false,
          exitOnError: false,
          logger: sqliteLogger
        }));
      }
      await markBuildPhase(runtime.buildRoot, 'stage4', 'done');
      stage4PhaseState.done = true;
      await updateBuildState(runtime.buildRoot, { stage: 'stage4' });
      const shouldPromote = !(explicitIndexRoot && argv.stage === 'stage4');
      await runPromotionPhase({
        shouldPromote,
        runtime,
        stage: 'stage4',
        modes: sqliteModes,
        log,
        markPhase: markBuildPhase,
        phaseState: promotePhaseState,
        compatibilityKey: runtime.compatibilityKey || null,
        skipDetail: 'skipped promotion for explicit stage4 --index-root',
        onSkipped: () => {
          log('[build] stage4 ran against explicit --index-root; skipping current.json promotion.');
        }
      });
      if (includeSqlite && overallProgressRef?.current?.advance) {
        for (const modeItem of executionSqliteModes) {
          overallProgressRef.current.advance({ message: `${modeItem} sqlite` });
        }
      }
      return recordOk({ modes: sqliteModes, sqlite: sqliteResult, repo: root, stage: 'stage4' });
    } catch (err) {
      const phaseFailureDetail = toPhaseFailureDetail(err);
      await markFailedPhases({
        buildRoot: runtime?.buildRoot,
        markPhase: markBuildPhase,
        phaseFailureDetail,
        phases: [
          { name: 'promote', running: promotePhaseState.running, done: promotePhaseState.done },
          { name: 'stage4', running: stage4PhaseState.running, done: stage4PhaseState.done }
        ]
      });
      throw err;
    }
  } catch (err) {
    if (isAbortError(err)) {
      recordIndexMetric('stage4', 'aborted', started);
      throw err;
    }
    recordIndexMetric('stage4', 'error', started);
    throw err;
  } finally {
    if (runtime) {
      await teardownRuntime(runtime);
    }
  }
};
