import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBuildSqliteArgs } from './cli.js';
import { createDisplay } from '../../src/shared/cli/display.js';
import { createTempPath } from './temp-path.js';
import { updateSqliteState } from './index-state.js';
import { getEnvConfig } from '../../src/shared/env.js';
import { resolveThreadLimits } from '../../src/shared/threads.js';
import { markBuildPhase, resolveBuildStatePath, startBuildHeartbeat } from '../../src/index/build/build-state.js';
import {
  getIndexDir,
  getModelConfig,
  getRepoCacheRoot,
  loadUserConfig,
  resolveIndexRoot,
  resolveRepoRoot,
  resolveSqlitePaths
} from '../dict-utils.js';
import {
  encodeVector,
  ensureVectorTable,
  getVectorExtensionConfig,
  hasVectorTable,
  loadVectorExtension
} from '../vector-extension.js';
import { compactDatabase } from '../compact-sqlite-index.js';
import { loadIncrementalManifest } from '../../src/storage/sqlite/incremental.js';
import { loadIndex, replaceSqliteDatabase } from '../../src/storage/sqlite/utils.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../src/storage/sqlite/build/from-artifacts.js';
import { buildDatabaseFromBundles } from '../../src/storage/sqlite/build/from-bundles.js';
import { incrementalUpdateDatabase } from '../../src/storage/sqlite/build/incremental-update.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {}

const resolveOutputPaths = ({ modeArg, outArg, sqlitePaths }) => {
  let outPath = null;
  let codeOutPath = sqlitePaths.codePath;
  let proseOutPath = sqlitePaths.prosePath;
  if (outArg) {
    if (modeArg === 'all') {
      const outDir = outArg.endsWith('.db') ? path.dirname(outArg) : outArg;
      codeOutPath = path.join(outDir, 'index-code.db');
      proseOutPath = path.join(outDir, 'index-prose.db');
    } else {
      const targetName = modeArg === 'code' ? 'index-code.db' : 'index-prose.db';
      outPath = outArg.endsWith('.db') ? outArg : path.join(outArg, targetName);
    }
  }
  if (!outPath && modeArg !== 'all') {
    outPath = modeArg === 'code' ? codeOutPath : proseOutPath;
  }
  return { outPath, codeOutPath, proseOutPath };
};

export async function runBuildSqliteIndex(rawArgs = process.argv.slice(2), options = {}) {
  const {
    argv,
    emitOutput,
    exitOnError,
    validateMode,
    modeArg,
    rawArgs: parsedRawArgs
  } = parseBuildSqliteArgs(rawArgs, options);
  const display = createDisplay({
    stream: process.stderr,
    progressMode: argv.progress,
    verbose: argv.verbose === true,
    quiet: argv.quiet === true
  });
  let stopHeartbeat = () => {};
  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    stopHeartbeat();
    display.close();
  };
  process.once('exit', finalize);
  const log = (message) => {
    if (emitOutput && message) display.log(message);
  };
  const warn = (message) => {
    if (emitOutput && message) display.warn(message);
  };
  const error = (message) => {
    if (emitOutput && message) display.error(message);
  };
  const bail = (message, code = 1) => {
    if (message) error(message);
    finalize();
    if (exitOnError) process.exit(code);
    throw new Error(message || 'SQLite index build failed.');
  };
  if (!Database) return bail('better-sqlite3 is required. Run npm install first.');

  const rootArg = options.root ? path.resolve(options.root) : (argv.repo ? path.resolve(argv.repo) : null);
  const root = rootArg || resolveRepoRoot(process.cwd());
  const envConfig = getEnvConfig();
  const userConfig = loadUserConfig(root);
  const indexRoot = argv['index-root']
    ? path.resolve(argv['index-root'])
    : resolveIndexRoot(root, userConfig);
  const buildStatePath = resolveBuildStatePath(indexRoot);
  const hasBuildState = buildStatePath && fsSync.existsSync(buildStatePath);
  stopHeartbeat = hasBuildState ? startBuildHeartbeat(indexRoot, 'stage4') : () => {};
  const threadLimits = resolveThreadLimits({
    argv,
    rawArgv: parsedRawArgs,
    envConfig,
    configConcurrency: userConfig?.indexing?.concurrency,
    importConcurrencyConfig: userConfig?.indexing?.importConcurrency
  });
  if (emitOutput && argv.verbose === true) {
    log(
      `[sqlite] Thread limits (${threadLimits.source}): ` +
      `cpu=${threadLimits.cpuCount}, cap=${threadLimits.maxConcurrencyCap}, ` +
      `files=${threadLimits.fileConcurrency}, imports=${threadLimits.importConcurrency}, ` +
      `io=${threadLimits.ioConcurrency}, cpuWork=${threadLimits.cpuConcurrency}.`
    );
  }
  const modelConfig = getModelConfig(root, userConfig);
  const vectorExtension = getVectorExtensionConfig(root, userConfig);
  const vectorAnnEnabled = vectorExtension.enabled;
  const vectorConfig = {
    enabled: vectorAnnEnabled,
    extension: vectorExtension,
    encodeVector,
    hasVectorTable,
    loadVectorExtension,
    ensureVectorTable
  };
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const compactFlag = argv.compact;
  const compactOnIncremental = compactFlag === true
    || (compactFlag !== false && userConfig?.sqlite?.compactOnIncremental === true);
  const codeDir = argv['code-dir']
    ? path.resolve(argv['code-dir'])
    : getIndexDir(root, 'code', userConfig, { indexRoot });
  const proseDir = argv['prose-dir']
    ? path.resolve(argv['prose-dir'])
    : getIndexDir(root, 'prose', userConfig, { indexRoot });
  const sqlitePaths = resolveSqlitePaths(root, userConfig, indexRoot ? { indexRoot } : {});
  const incrementalRequested = argv.incremental === true;

  if (!['all', 'code', 'prose'].includes(modeArg)) {
    return bail('Invalid mode. Use --mode all|code|prose');
  }

  const sqliteStateTargets = [];
  if (modeArg === 'all' || modeArg === 'code') sqliteStateTargets.push(codeDir);
  if (modeArg === 'all' || modeArg === 'prose') sqliteStateTargets.push(proseDir);
  if (hasBuildState) {
    await markBuildPhase(indexRoot, 'stage4', 'running');
  }
  await Promise.all(sqliteStateTargets.map((dir) => updateSqliteState(dir, {
    enabled: true,
    ready: false,
    pending: true
  })));

  const outArg = argv.out ? path.resolve(argv.out) : null;
  const { outPath, codeOutPath, proseOutPath } = resolveOutputPaths({
    modeArg,
    outArg,
    sqlitePaths
  });

  if (modeArg === 'all') {
    await fs.mkdir(path.dirname(codeOutPath), { recursive: true });
    await fs.mkdir(path.dirname(proseOutPath), { recursive: true });
  } else if (outPath) {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
  }

  const loadIndexSafe = async (dir, label) => {
    const pieces = loadIndexPieces(dir, modelConfig.id);
    if (pieces) return { index: null, tooLarge: false, pieces };
    try {
      const index = await loadIndex(dir, modelConfig.id);
      if (index) return { index, tooLarge: false, pieces: null };
      return { index: null, tooLarge: false, pieces: null };
    } catch (err) {
      if (err?.code === 'ERR_JSON_TOO_LARGE') {
        warn(`[sqlite] ${label} chunk_meta too large; will use pieces if available.`);
        return { index: null, tooLarge: true, pieces: loadIndexPieces(dir, modelConfig.id) };
      }
      throw err;
    }
  };

  const { index: codeIndex, pieces: codePieces } = await loadIndexSafe(codeDir, 'code');
  const { index: proseIndex, pieces: prosePieces } = await loadIndexSafe(proseDir, 'prose');
  const incrementalCode = loadIncrementalManifest(repoCacheRoot, 'code');
  const incrementalProse = loadIncrementalManifest(repoCacheRoot, 'prose');
  if (!codeIndex && !codePieces && !proseIndex && !prosePieces
    && !incrementalCode?.manifest && !incrementalProse?.manifest) {
    return bail('No index found. Build index-code/index-prose first.');
  }

  if (sqlitePaths.legacyExists) {
    try {
      await fs.rm(sqlitePaths.legacyPath, { force: true });
      warn(`Removed legacy SQLite index at ${sqlitePaths.legacyPath}`);
    } catch (err) {
      warn(`Failed to remove legacy SQLite index at ${sqlitePaths.legacyPath}: ${err?.message || err}`);
    }
  }

  if (modeArg === 'code' && !codeIndex && !codePieces && !incrementalCode?.manifest) {
    return bail('Code index missing; build index-code first.');
  }
  if (modeArg === 'prose' && !proseIndex && !prosePieces && !incrementalProse?.manifest) {
    return bail('Prose index missing; build index-prose first.');
  }

  const workerPath = fileURLToPath(new URL('../workers/bundle-reader.js', import.meta.url));

  const runMode = async (mode, index, indexDir, targetPath, incrementalData) => {
    const hasBundles = incrementalData?.manifest?.files
      ? Object.keys(incrementalData.manifest.files).length > 0
      : false;

    if (incrementalRequested) {
      const expectedDense = index?.denseVec
        ? { model: index.denseVec.model, dims: index.denseVec.dims }
        : null;
      const result = await incrementalUpdateDatabase({
        Database,
        outPath: targetPath,
        mode,
        incrementalData,
        modelConfig,
        vectorConfig,
        emitOutput,
        validateMode,
        expectedDense
      });
      if (result.used) {
        if (compactOnIncremental && (result.changedFiles || result.deletedFiles)) {
          log(`[sqlite] Compaction requested for ${mode} index...`);
          await compactDatabase({
            dbPath: targetPath,
            mode,
            vectorExtension,
            dryRun: false,
            keepBackup: false,
            logger: { log, warn, error }
          });
        }
        return { ...result, incremental: true };
      }
      if (result.reason) {
        warn(`[sqlite] Incremental ${mode} update skipped (${result.reason}); rebuilding full index.`);
      }
    }
    if (hasBundles) {
      log(`[sqlite] Using incremental bundles for ${mode} full rebuild.`);
      const tempPath = createTempPath(targetPath);
      let bundleResult = { count: 0 };
      try {
        bundleResult = await buildDatabaseFromBundles({
          Database,
          outPath: tempPath,
          mode,
          incrementalData,
          envConfig,
          threadLimits,
          emitOutput,
          validateMode,
          vectorConfig,
          modelConfig,
          workerPath
        });
        if (bundleResult.count) {
          await replaceSqliteDatabase(tempPath, targetPath, { keepBackup: true });
        } else {
          await fs.rm(tempPath, { force: true });
        }
      } catch (err) {
        try { await fs.rm(tempPath, { force: true }); } catch {}
        throw err;
      }
      if (bundleResult.count) {
        return {
          count: bundleResult.count,
          incremental: false,
          changedFiles: null,
          deletedFiles: null,
          insertedChunks: bundleResult.count
        };
      }
      if (bundleResult.reason) {
        warn(`[sqlite] Bundle build skipped (${bundleResult.reason}); falling back to file-backed artifacts.`);
      }
    }
    const tempPath = createTempPath(targetPath);
    let count = 0;
    try {
      count = await buildDatabaseFromArtifacts({
        Database,
        outPath: tempPath,
        index,
        indexDir,
        mode,
        manifestFiles: incrementalData?.manifest?.files,
        emitOutput,
        validateMode,
        vectorConfig,
        modelConfig
      });
      await replaceSqliteDatabase(tempPath, targetPath, { keepBackup: true });
    } catch (err) {
      try { await fs.rm(tempPath, { force: true }); } catch {}
      throw err;
    }
    return { count, incremental: false, changedFiles: null, deletedFiles: null, insertedChunks: count };
  };

  const results = {};
  const modeList = modeArg === 'all' ? ['code', 'prose'] : [modeArg];
  let completedModes = 0;
  const modeTask = display.task('SQLite', { total: modeList.length, stage: 'sqlite' });
  const updateModeProgress = (message) => {
    modeTask.set(completedModes, modeList.length, { message });
  };
  if (modeArg === 'all' || modeArg === 'code') {
    const targetPath = modeArg === 'all' ? codeOutPath : outPath;
    const codeInput = codeIndex || codePieces;
    updateModeProgress('building code');
    results.code = await runMode('code', codeInput, codeDir, targetPath, incrementalCode);
    completedModes += 1;
    updateModeProgress('built code');
  }
  if (modeArg === 'all' || modeArg === 'prose') {
    const targetPath = modeArg === 'all' ? proseOutPath : outPath;
    const proseInput = proseIndex || prosePieces;
    updateModeProgress('building prose');
    results.prose = await runMode('prose', proseInput, proseDir, targetPath, incrementalProse);
    completedModes += 1;
    updateModeProgress('built prose');
  }

  if (modeArg === 'all') {
    const codeResult = results.code || {};
    const proseResult = results.prose || {};
    if (codeResult.incremental || proseResult.incremental) {
      log(`SQLite indexes updated at code=${codeOutPath} prose=${proseOutPath}. ` +
        `code+${codeResult.insertedChunks || 0} prose+${proseResult.insertedChunks || 0}`);
    } else {
      log(`SQLite indexes built at code=${codeOutPath} prose=${proseOutPath}. ` +
        `code=${codeResult.count || 0} prose=${proseResult.count || 0}`);
    }
  } else {
    const result = modeArg === 'code' ? results.code : results.prose;
    if (result?.incremental) {
      log(`SQLite ${modeArg} index updated at ${outPath}. +${result.insertedChunks || 0} chunks`);
    } else {
      log(`SQLite ${modeArg} index built at ${outPath}. ${modeArg}=${result?.count || 0}`);
    }
  }

  await Promise.all(sqliteStateTargets.map((dir) => updateSqliteState(dir, {
    enabled: true,
    ready: true,
    pending: false
  })));
  if (hasBuildState) {
    await markBuildPhase(indexRoot, 'stage4', 'done');
  }
  finalize();

  return {
    mode: modeArg,
    results,
    paths: {
      code: codeOutPath,
      prose: proseOutPath,
      out: outPath
    }
  };
}
