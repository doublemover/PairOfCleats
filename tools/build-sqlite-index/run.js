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
import { ensureDiskSpace, estimateDirBytes } from '../../src/shared/disk-space.js';
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
import { SCHEMA_VERSION } from '../../src/storage/sqlite/schema.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {}

const resolveOutputPaths = ({ modeArg, outArg, sqlitePaths }) => {
  let outPath = null;
  let codeOutPath = sqlitePaths.codePath;
  let proseOutPath = sqlitePaths.prosePath;
  let extractedProseOutPath = sqlitePaths.extractedProsePath;
  let recordsOutPath = sqlitePaths.recordsPath;
  if (outArg) {
    if (modeArg === 'all') {
      const outDir = outArg.endsWith('.db') ? path.dirname(outArg) : outArg;
      codeOutPath = path.join(outDir, 'index-code.db');
      proseOutPath = path.join(outDir, 'index-prose.db');
      extractedProseOutPath = path.join(outDir, 'index-extracted-prose.db');
      recordsOutPath = path.join(outDir, 'index-records.db');
    } else {
      const targetName = modeArg === 'code'
        ? 'index-code.db'
        : (modeArg === 'prose'
          ? 'index-prose.db'
          : (modeArg === 'extracted-prose'
            ? 'index-extracted-prose.db'
            : 'index-records.db'));
      outPath = outArg.endsWith('.db') ? outArg : path.join(outArg, targetName);
    }
  }
  if (!outPath && modeArg !== 'all') {
    if (modeArg === 'code') outPath = codeOutPath;
    else if (modeArg === 'prose') outPath = proseOutPath;
    else if (modeArg === 'extracted-prose') outPath = extractedProseOutPath;
    else outPath = recordsOutPath;
  }
  return { outPath, codeOutPath, proseOutPath, extractedProseOutPath, recordsOutPath };
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
  const externalLogger = options.logger && typeof options.logger === 'object'
    ? options.logger
    : null;
  const display = externalLogger
    ? null
    : createDisplay({
      stream: process.stderr,
      progressMode: argv.progress,
      verbose: argv.verbose === true,
      quiet: argv.quiet === true
    });
  const createNoopTask = () => ({
    tick() {},
    set() {},
    done() {},
    fail() {},
    update() {}
  });
  const taskFactory = display?.task
    ? display.task.bind(display)
    : () => createNoopTask();
  let stopHeartbeat = () => {};
  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    stopHeartbeat();
    if (display) display.close();
  };
  process.once('exit', finalize);
  const emit = (handler, fallback, message) => {
    if (!emitOutput || !message) return;
    if (typeof handler === 'function') {
      handler(message);
      return;
    }
    if (typeof fallback === 'function') fallback(message);
  };
  const log = (message) => {
    emit(externalLogger?.log, display?.log, message);
  };
  const warn = (message) => {
    emit(externalLogger?.warn || externalLogger?.log, display?.warn, message);
  };
  const error = (message) => {
    emit(externalLogger?.error || externalLogger?.log, display?.error, message);
  };
  const bail = (message, code = 1) => {
    if (message) error(message);
    finalize();
    if (exitOnError) process.exit(code);
    throw new Error(message || 'SQLite index build failed.');
  };
  if (!Database) return bail('better-sqlite3 is required. Run npm install first.');

  try {
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
    if (argv.compact && argv['no-compact']) {
      return bail('Cannot use --compact and --no-compact together.');
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
    const compactFlag = argv['no-compact'] ? false : argv.compact;
    const compactOnIncremental = compactFlag === true
      || (compactFlag !== false && userConfig?.sqlite?.compactOnIncremental === true);
    const codeDir = argv['code-dir']
      ? path.resolve(argv['code-dir'])
      : getIndexDir(root, 'code', userConfig, { indexRoot });
    const proseDir = argv['prose-dir']
      ? path.resolve(argv['prose-dir'])
      : getIndexDir(root, 'prose', userConfig, { indexRoot });
    const extractedProseDir = argv['extracted-prose-dir']
      ? path.resolve(argv['extracted-prose-dir'])
      : getIndexDir(root, 'extracted-prose', userConfig, { indexRoot });
    const recordsDir = argv['records-dir']
      ? path.resolve(argv['records-dir'])
      : getIndexDir(root, 'records', userConfig, { indexRoot });
    const sqlitePaths = resolveSqlitePaths(root, userConfig, indexRoot ? { indexRoot } : {});
    const incrementalRequested = argv.incremental === true;

    if (!['all', 'code', 'prose', 'extracted-prose', 'records'].includes(modeArg)) {
      return bail('Invalid mode. Use --mode all|code|prose|extracted-prose|records');
    }

    const sqliteStateTargets = [];
    if (modeArg === 'all' || modeArg === 'code') sqliteStateTargets.push({ dir: codeDir, mode: 'code' });
    if (modeArg === 'all' || modeArg === 'prose') sqliteStateTargets.push({ dir: proseDir, mode: 'prose' });
    if (modeArg === 'all' || modeArg === 'extracted-prose') {
      sqliteStateTargets.push({ dir: extractedProseDir, mode: 'extracted-prose' });
    }
    if (modeArg === 'all' || modeArg === 'records') sqliteStateTargets.push({ dir: recordsDir, mode: 'records' });
    if (hasBuildState) {
      await markBuildPhase(indexRoot, 'stage4', 'running');
    }
    await Promise.all(sqliteStateTargets.map(({ dir }) => updateSqliteState(dir, {
      enabled: true,
      ready: false,
      pending: true,
      schemaVersion: SCHEMA_VERSION
    })));

  const outArg = argv.out ? path.resolve(argv.out) : null;
  const { outPath, codeOutPath, proseOutPath, extractedProseOutPath, recordsOutPath } = resolveOutputPaths({
    modeArg,
    outArg,
    sqlitePaths
  });

  if (modeArg === 'all') {
    await fs.mkdir(path.dirname(codeOutPath), { recursive: true });
    await fs.mkdir(path.dirname(proseOutPath), { recursive: true });
    await fs.mkdir(path.dirname(extractedProseOutPath), { recursive: true });
    await fs.mkdir(path.dirname(recordsOutPath), { recursive: true });
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
  const { index: extractedProseIndex, pieces: extractedProsePieces } = await loadIndexSafe(extractedProseDir, 'extracted-prose');
  const { index: recordsIndex, pieces: recordsPieces } = await loadIndexSafe(recordsDir, 'records');
  const incrementalCode = loadIncrementalManifest(repoCacheRoot, 'code');
  const incrementalProse = loadIncrementalManifest(repoCacheRoot, 'prose');
  const incrementalExtractedProse = loadIncrementalManifest(repoCacheRoot, 'extracted-prose');
  const incrementalRecords = loadIncrementalManifest(repoCacheRoot, 'records');
  const modeList = modeArg === 'all' ? ['code', 'prose', 'extracted-prose', 'records'] : [modeArg];
  const hasIndex = (index, pieces, incremental) => !!(index || pieces || incremental?.manifest);
  const indexByMode = {
    code: { index: codeIndex, pieces: codePieces, incremental: incrementalCode },
    prose: { index: proseIndex, pieces: prosePieces, incremental: incrementalProse },
    'extracted-prose': { index: extractedProseIndex, pieces: extractedProsePieces, incremental: incrementalExtractedProse },
    records: { index: recordsIndex, pieces: recordsPieces, incremental: incrementalRecords }
  };
  if (!modeList.some((mode) => {
    const entry = indexByMode[mode];
    return entry && hasIndex(entry.index, entry.pieces, entry.incremental);
  })) {
    return bail('No index found. Build index-code/index-prose/index-extracted-prose/index-records first.');
  }

  if (sqlitePaths.legacyExists) {
    try {
      await fs.rm(sqlitePaths.legacyPath, { force: true });
      warn(`Removed legacy SQLite index at ${sqlitePaths.legacyPath}`);
    } catch (err) {
      warn(`Failed to remove legacy SQLite index at ${sqlitePaths.legacyPath}: ${err?.message || err}`);
    }
  }

  const modeLabels = {
    code: 'index-code',
    prose: 'index-prose',
    'extracted-prose': 'index-extracted-prose',
    records: 'index-records'
  };
  for (const mode of modeList) {
    const entry = indexByMode[mode];
    if (!entry || hasIndex(entry.index, entry.pieces, entry.incremental)) continue;
    const label = modeLabels[mode] || `index-${mode}`;
    return bail(`${mode} index missing; build ${label} first.`);
  }

  const workerPath = fileURLToPath(new URL('../workers/bundle-reader.js', import.meta.url));

  const estimateArtifactsBytes = async (dir) => {
    const { bytes, truncated } = await estimateDirBytes(dir);
    return { bytes, truncated };
  };

  const estimateRequiredBytes = ({ sourceBytes, existingBytes, headroomMb = 64, multiplier = 1.2 }) => {
    const base = Number.isFinite(sourceBytes) ? sourceBytes : 0;
    const existing = Number.isFinite(existingBytes) ? existingBytes : 0;
    const headroom = headroomMb * 1024 * 1024;
    return Math.max(base * multiplier + existing, base + existing + headroom);
  };

  const runMode = async (mode, index, indexDir, targetPath, incrementalData) => {
    const hasBundles = incrementalData?.manifest?.files
      ? Object.keys(incrementalData.manifest.files).length > 0
      : false;
    const existingBytes = fsSync.existsSync(targetPath)
      ? (Number(fsSync.statSync(targetPath).size) || 0)
      : 0;

    if (incrementalRequested) {
      const requiredBytes = Math.max(existingBytes * 0.25, 128 * 1024 * 1024);
      await ensureDiskSpace({
        targetPath,
        requiredBytes,
        label: `sqlite incremental ${mode}`
      });
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
        expectedDense,
        logger: { log, warn, error }
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
        const rebuildLabel = mode === 'records' && result.reason === 'missing incremental manifest'
          ? 'building records index.'
          : 'rebuilding full index.';
        const changeStats = [];
        if (Number.isFinite(result.changedFiles)) changeStats.push(`changed=${result.changedFiles}`);
        if (Number.isFinite(result.deletedFiles)) changeStats.push(`deleted=${result.deletedFiles}`);
        if (Number.isFinite(result.manifestUpdates)) changeStats.push(`manifestUpdates=${result.manifestUpdates}`);
        if (Number.isFinite(result.totalFiles)) changeStats.push(`total=${result.totalFiles}`);
        const statsSuffix = changeStats.length ? `; ${changeStats.join(', ')}` : '';
        warn(`[sqlite] Incremental ${mode} update skipped (${result.reason}${statsSuffix}); ${rebuildLabel}`);
      }
    }
    if (hasBundles) {
      log(`[sqlite] Using incremental bundles for ${mode} full rebuild.`);
      const bundleEstimate = await estimateArtifactsBytes(incrementalData.bundleDir);
      const requiredBytes = estimateRequiredBytes({
        sourceBytes: bundleEstimate.bytes,
        existingBytes,
        headroomMb: 96,
        multiplier: 1.3
      });
      await ensureDiskSpace({
        targetPath,
        requiredBytes,
        label: `sqlite bundles ${mode}`,
        estimateNote: bundleEstimate.truncated ? 'estimate' : null
      });
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
          workerPath,
          logger: { log, warn, error }
        });
        const requiresDense = vectorConfig?.enabled === true
          && Array.isArray(index?.denseVec?.vectors)
          && index.denseVec.vectors.length > 0;
        if (bundleResult.count && requiresDense && !bundleResult.denseCount) {
          warn('[sqlite] Bundle build skipped (missing dense vectors); falling back to file-backed artifacts.');
          bundleResult = { ...bundleResult, count: 0, reason: 'missing dense vectors' };
        }
        if (bundleResult.count) {
          await replaceSqliteDatabase(tempPath, targetPath, { keepBackup: true, logger: { log, warn } });
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
      const artifactsEstimate = await estimateArtifactsBytes(indexDir);
      const requiredBytes = estimateRequiredBytes({
        sourceBytes: artifactsEstimate.bytes,
        existingBytes,
        headroomMb: 96,
        multiplier: 1.3
      });
      await ensureDiskSpace({
        targetPath,
        requiredBytes,
        label: `sqlite artifacts ${mode}`,
        estimateNote: artifactsEstimate.truncated ? 'estimate' : null
      });
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
        modelConfig,
        logger: { log, warn, error }
      });
      await replaceSqliteDatabase(tempPath, targetPath, { keepBackup: true, logger: { log, warn } });
    } catch (err) {
      try { await fs.rm(tempPath, { force: true }); } catch {}
      throw err;
    }
    return { count, incremental: false, changedFiles: null, deletedFiles: null, insertedChunks: count };
  };

  const results = {};
  let completedModes = 0;
  const modeTask = taskFactory('SQLite', { total: modeList.length, stage: 'sqlite' });
  const localAppData = process.env.LOCALAPPDATA || '';
  const normalizePath = (value) => String(value || '').replace(/\//g, path.sep);
  const ensureTrailingSep = (value) => value && value.endsWith(path.sep) ? value : `${value}${path.sep}`;
  const formatCacheRoot = (value) => {
    if (!value) return '';
    const normalized = normalizePath(value);
    if (localAppData && normalized.toLowerCase().startsWith(localAppData.toLowerCase())) {
      const suffix = normalized.slice(localAppData.length);
      const trimmed = suffix.startsWith(path.sep) ? suffix.slice(1) : suffix;
      return ensureTrailingSep(`%LOCALAPPDATA%${path.sep}${trimmed}`);
    }
    return ensureTrailingSep(normalized);
  };
  const extractRepoName = (value) => {
    if (!value) return '';
    const parts = normalizePath(value).split(path.sep).filter(Boolean);
    const repoIndex = parts.findIndex((part) => part.toLowerCase() === 'repos');
    if (repoIndex >= 0 && parts[repoIndex + 1]) return parts[repoIndex + 1];
    return path.basename(value);
  };
  const extractBuildId = (value) => {
    if (!value) return '';
    const match = normalizePath(value).match(/builds[\\\/]([^\\\/]+)/i);
    return match ? match[1] : '';
  };
  const logIndexLayout = (heading, paths) => {
    log(heading);
    const firstPath = paths.find((entry) => entry.path)?.path || '';
    const cacheRoot = repoCacheRoot ? path.dirname(path.dirname(repoCacheRoot)) : '';
    const repoName = repoCacheRoot ? path.basename(repoCacheRoot) : extractRepoName(firstPath);
    const buildId = extractBuildId(firstPath);
    const layoutPath = [
      'cache_root',
      'repo',
      'builds',
      'build',
      'index-sqlite'
    ].join(path.sep) + path.sep;
    const files = paths
      .map((entry) => entry.path && path.basename(entry.path))
      .filter(Boolean);
    const entries = [
      { label: 'Cache Root', value: formatCacheRoot(cacheRoot) },
      { label: 'Repo', value: repoName },
      { label: 'Build', value: buildId },
      { label: 'Path', value: layoutPath },
      { label: 'Files', value: files[0] || '' }
    ];
    const maxLabel = entries.reduce((max, entry) => Math.max(max, entry.label.length), 0);
    const valueColumn = Math.max(30, maxLabel + 2);
    const formatLine = (label, value) => {
      const labelPad = label.padStart(maxLabel, ' ');
      const prefix = `${labelPad}:`;
      const spacer = ' '.repeat(Math.max(1, valueColumn - prefix.length));
      return `${prefix}${spacer}${value}`;
    };
    for (const entry of entries) {
      if (!entry.value) continue;
      log(formatLine(entry.label, entry.value));
      if (entry.label === 'Files') {
        for (const file of files.slice(1)) {
          log(' '.repeat(valueColumn) + file);
        }
      }
    }
  };
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
  if (modeArg === 'all' || modeArg === 'extracted-prose') {
    const targetPath = modeArg === 'all' ? extractedProseOutPath : outPath;
    const extractedInput = extractedProseIndex || extractedProsePieces;
    updateModeProgress('building extracted-prose');
    results['extracted-prose'] = await runMode(
      'extracted-prose',
      extractedInput,
      extractedProseDir,
      targetPath,
      incrementalExtractedProse
    );
    completedModes += 1;
    updateModeProgress('built extracted-prose');
  }
  if (modeArg === 'all' || modeArg === 'records') {
    const targetPath = modeArg === 'all' ? recordsOutPath : outPath;
    const recordsInput = recordsIndex || recordsPieces;
    updateModeProgress('building records');
    results.records = await runMode('records', recordsInput, recordsDir, targetPath, incrementalRecords);
    completedModes += 1;
    updateModeProgress('built records');
  }

  if (modeArg === 'all') {
    const codeResult = results.code || {};
    const proseResult = results.prose || {};
    const extractedResult = results['extracted-prose'] || {};
    const recordsResult = results.records || {};
    const anyIncremental = codeResult.incremental || proseResult.incremental
      || extractedResult.incremental || recordsResult.incremental;
    if (anyIncremental) {
      logIndexLayout('SQLite Indexes Updated', [
        { label: 'Code', path: codeOutPath },
        { label: 'Prose', path: proseOutPath },
        { label: 'Extracted Prose', path: extractedProseOutPath },
        { label: 'Records', path: recordsOutPath }
      ]);
      log(
        `SQLite Updates: code+${codeResult.insertedChunks || 0} ` +
        `prose+${proseResult.insertedChunks || 0} ` +
        `extracted-prose+${extractedResult.insertedChunks || 0} ` +
        `records+${recordsResult.insertedChunks || 0}`
      );
    } else {
      logIndexLayout('SQLite Indexes Built', [
        { label: 'Code', path: codeOutPath },
        { label: 'Prose', path: proseOutPath },
        { label: 'Extracted Prose', path: extractedProseOutPath },
        { label: 'Records', path: recordsOutPath }
      ]);
      log(
        `SQLite Counts: code=${codeResult.count || 0} ` +
        `prose=${proseResult.count || 0} ` +
        `extracted-prose=${extractedResult.count || 0} ` +
        `records=${recordsResult.count || 0}`
      );
    }
  } else {
    const result = modeArg === 'code'
      ? results.code
      : (modeArg === 'prose'
        ? results.prose
        : (modeArg === 'extracted-prose'
          ? results['extracted-prose']
          : results.records));
    if (result?.incremental) {
      logIndexLayout('SQLite Index Updated', [
        { label: modeArg === 'extracted-prose' ? 'Extracted Prose' : modeArg[0].toUpperCase() + modeArg.slice(1), path: outPath }
      ]);
      log(`SQLite Updates: +${result.insertedChunks || 0} chunks`);
    } else {
      logIndexLayout('SQLite Index Built', [
        { label: modeArg === 'extracted-prose' ? 'Extracted Prose' : modeArg[0].toUpperCase() + modeArg.slice(1), path: outPath }
      ]);
      log(`SQLite Counts: ${modeArg}=${result?.count || 0}`);
    }
  }

  const buildModes = {
    code: results.code?.incremental ? 'incremental' : 'full',
    prose: results.prose?.incremental ? 'incremental' : 'full',
    'extracted-prose': results['extracted-prose']?.incremental ? 'incremental' : 'full',
    records: results.records?.incremental ? 'incremental' : 'full'
  };
  await Promise.all(sqliteStateTargets.map(({ dir, mode }) => updateSqliteState(dir, {
    enabled: true,
    ready: true,
    pending: false,
    schemaVersion: SCHEMA_VERSION,
    buildMode: buildModes[mode] || (incrementalRequested ? 'incremental' : 'full')
  })));
    if (hasBuildState) {
      await markBuildPhase(indexRoot, 'stage4', 'done');
    }

    return {
      mode: modeArg,
      results,
      paths: {
        code: codeOutPath,
        prose: proseOutPath,
        extractedProse: extractedProseOutPath,
        records: recordsOutPath,
        out: outPath
      }
    };
  } finally {
    finalize();
  }
}
