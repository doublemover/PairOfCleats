import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_MODEL_ID,
  getModelConfig,
  loadUserConfig,
  resolveToolRoot
} from '../dict-utils.js';
import { buildIndex as coreBuildIndex, buildSqliteIndex as coreBuildSqliteIndex, search as coreSearch, status as coreStatus } from '../../src/integrations/core/index.js';
import { clearRepoCaches, configStatus, getRepoCaches, indexStatus, refreshRepoCaches, resolveRepoPath } from './repo.js';
import { parseCountSummary, parseExtensionPath, runNodeAsync, runNodeSync, runToolWithProgress } from './runner.js';

const toolRoot = resolveToolRoot();

/**
 * Normalize meta filters into CLI-friendly key/value strings.
 * @param {any} meta
 * @returns {string[]|null}
 */
function normalizeMetaFilters(meta) {
  if (!meta) return null;
  if (Array.isArray(meta)) {
    const entries = meta.flatMap((entry) => {
      if (entry == null) return [];
      if (typeof entry === 'string') return [entry];
      if (typeof entry === 'object') {
        return Object.entries(entry).map(([key, value]) =>
          value == null || value === '' ? String(key) : `${key}=${value}`
        );
      }
      return [String(entry)];
    });
    return entries.length ? entries : null;
  }
  if (typeof meta === 'object') {
    const entries = Object.entries(meta).map(([key, value]) =>
      value == null || value === '' ? String(key) : `${key}=${value}`
    );
    return entries.length ? entries : null;
  }
  return [String(meta)];
}

/**
 * Restore CI artifacts if present.
 * @param {string} repoPath
 * @param {string} artifactsDir
 * @returns {boolean}
 */
function maybeRestoreArtifacts(repoPath, artifactsDir, progress) {
  const fromDir = artifactsDir ? path.resolve(artifactsDir) : path.join(repoPath, 'ci-artifacts');
  if (!fs.existsSync(path.join(fromDir, 'manifest.json'))) return false;
  if (progress) {
    progress({
      message: `Restoring CI artifacts from ${fromDir}`,
      phase: 'start'
    });
  }
  runNodeSync(repoPath, [path.join(toolRoot, 'tools', 'ci-restore-artifacts.js'), '--repo', repoPath, '--from', fromDir]);
  if (progress) {
    progress({
      message: 'CI artifacts restored.',
      phase: 'done'
    });
  }
  return true;
}

/**
 * Handle the MCP build_index tool call.
 * @param {object} [args]
 * @returns {object}
 */
export async function buildIndex(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const userConfig = loadUserConfig(repoPath);
  const sqliteConfigured = userConfig.sqlite?.use !== false;
  const shouldUseSqlite = typeof args.sqlite === 'boolean' ? args.sqlite : sqliteConfigured;
  const mode = args.mode || 'all';
  const incremental = args.incremental === true;
  const stubEmbeddings = args.stubEmbeddings === true;
  const buildSqlite = shouldUseSqlite;
  const useArtifacts = args.useArtifacts === true;
  const progress = typeof context.progress === 'function' ? context.progress : null;

  let restoredArtifacts = false;
  if (useArtifacts) {
    restoredArtifacts = maybeRestoreArtifacts(repoPath, args.artifactsDir, progress);
  }

  if (!restoredArtifacts) {
    if (progress) {
      progress({
        message: `Building ${mode} index${incremental ? ' (incremental)' : ''}.`,
        phase: 'start'
      });
    }
    await coreBuildIndex(repoPath, {
      mode,
      incremental,
      stubEmbeddings,
      sqlite: buildSqlite,
      emitOutput: true
    });
  }

  if (buildSqlite) {
    if (progress) {
      progress({
        message: `Building SQLite index${incremental ? ' (incremental)' : ''}.`,
        phase: 'start'
      });
    }
    await coreBuildSqliteIndex(repoPath, {
      incremental,
      emitOutput: true
    });
  }
  if (progress) {
    progress({
      message: 'Index build complete.',
      phase: 'done'
    });
  }
  clearRepoCaches(repoPath);

  return {
    repoPath,
    mode,
    sqlite: buildSqlite,
    incremental,
    restoredArtifacts
  };
}

/**
 * Handle the MCP search tool call.
 * @param {object} [args]
 * @returns {object}
 */
export async function runSearch(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  if (context.signal?.aborted) {
    throw new Error('Request cancelled.');
  }
  const query = String(args.query || '').trim();
  if (!query) throw new Error('Query is required.');

  const mode = args.mode || 'both';
  const backend = args.backend || null;
  const output = typeof args.output === 'string' ? args.output.toLowerCase() : '';
  const ann = typeof args.ann === 'boolean' ? args.ann : null;
  const top = Number.isFinite(Number(args.top)) ? Math.max(1, Number(args.top)) : null;
  const contextLines = Number.isFinite(Number(args.context)) ? Math.max(0, Number(args.context)) : null;
  const typeFilter = args.type ? String(args.type) : null;
  const authorFilter = args.author ? String(args.author) : null;
  const importFilter = args.import ? String(args.import) : null;
  const callsFilter = args.calls ? String(args.calls) : null;
  const usesFilter = args.uses ? String(args.uses) : null;
  const signatureFilter = args.signature ? String(args.signature) : null;
  const paramFilter = args.param ? String(args.param) : null;
  const decoratorFilter = args.decorator ? String(args.decorator) : null;
  const inferredTypeFilter = args.inferredType ? String(args.inferredType) : null;
  const returnTypeFilter = args.returnType ? String(args.returnType) : null;
  const throwsFilter = args.throws ? String(args.throws) : null;
  const readsFilter = args.reads ? String(args.reads) : null;
  const writesFilter = args.writes ? String(args.writes) : null;
  const mutatesFilter = args.mutates ? String(args.mutates) : null;
  const aliasFilter = args.alias ? String(args.alias) : null;
  const awaitsFilter = args.awaits ? String(args.awaits) : null;
  const riskFilter = args.risk ? String(args.risk) : null;
  const riskTagFilter = args.riskTag ? String(args.riskTag) : null;
  const riskSourceFilter = args.riskSource ? String(args.riskSource) : null;
  const riskSinkFilter = args.riskSink ? String(args.riskSink) : null;
  const riskCategoryFilter = args.riskCategory ? String(args.riskCategory) : null;
  const riskFlowFilter = args.riskFlow ? String(args.riskFlow) : null;
  const branchesMin = Number.isFinite(Number(args.branchesMin)) ? Number(args.branchesMin) : null;
  const loopsMin = Number.isFinite(Number(args.loopsMin)) ? Number(args.loopsMin) : null;
  const breaksMin = Number.isFinite(Number(args.breaksMin)) ? Number(args.breaksMin) : null;
  const continuesMin = Number.isFinite(Number(args.continuesMin)) ? Number(args.continuesMin) : null;
  const churnMin = Number.isFinite(Number(args.churnMin)) ? Number(args.churnMin) : null;
  const chunkAuthorFilter = args.chunkAuthor ? String(args.chunkAuthor) : null;
  const modifiedAfter = args.modifiedAfter ? String(args.modifiedAfter) : null;
  const modifiedSince = Number.isFinite(Number(args.modifiedSince)) ? Number(args.modifiedSince) : null;
  const visibilityFilter = args.visibility ? String(args.visibility) : null;
  const extendsFilter = args.extends ? String(args.extends) : null;
  const lintFilter = args.lint === true;
  const asyncFilter = args.async === true;
  const generatorFilter = args.generator === true;
  const returnsFilter = args.returns === true;
  const branchFilter = args.branch ? String(args.branch) : null;
  const langFilter = args.lang ? String(args.lang) : null;
  const caseAll = args.case === true;
  const caseFile = args.caseFile === true || caseAll;
  const caseTokens = args.caseTokens === true || caseAll;
  const fileFilters = [];
  const toList = (value) => (Array.isArray(value) ? value : (value == null ? [] : [value]));
  fileFilters.push(...toList(args.path));
  fileFilters.push(...toList(args.file));
  const extFilters = toList(args.ext);
  const metaFilters = normalizeMetaFilters(args.meta);
  const metaJson = args.metaJson || null;

  const useCompact = output !== 'full' && output !== 'json';
  const searchArgs = ['--json', '--repo', repoPath];
  if (useCompact) searchArgs.push('--compact');
  if (mode && mode !== 'both') searchArgs.push('--mode', mode);
  if (backend) searchArgs.push('--backend', backend);
  if (ann === true) searchArgs.push('--ann');
  if (ann === false) searchArgs.push('--no-ann');
  if (top) searchArgs.push('-n', String(top));
  if (contextLines !== null) searchArgs.push('--context', String(contextLines));
  if (typeFilter) searchArgs.push('--type', typeFilter);
  if (authorFilter) searchArgs.push('--author', authorFilter);
  if (importFilter) searchArgs.push('--import', importFilter);
  if (callsFilter) searchArgs.push('--calls', callsFilter);
  if (usesFilter) searchArgs.push('--uses', usesFilter);
  if (signatureFilter) searchArgs.push('--signature', signatureFilter);
  if (paramFilter) searchArgs.push('--param', paramFilter);
  if (decoratorFilter) searchArgs.push('--decorator', decoratorFilter);
  if (inferredTypeFilter) searchArgs.push('--inferred-type', inferredTypeFilter);
  if (returnTypeFilter) searchArgs.push('--return-type', returnTypeFilter);
  if (throwsFilter) searchArgs.push('--throws', throwsFilter);
  if (readsFilter) searchArgs.push('--reads', readsFilter);
  if (writesFilter) searchArgs.push('--writes', writesFilter);
  if (mutatesFilter) searchArgs.push('--mutates', mutatesFilter);
  if (aliasFilter) searchArgs.push('--alias', aliasFilter);
  if (awaitsFilter) searchArgs.push('--awaits', awaitsFilter);
  if (riskFilter) searchArgs.push('--risk', riskFilter);
  if (riskTagFilter) searchArgs.push('--risk-tag', riskTagFilter);
  if (riskSourceFilter) searchArgs.push('--risk-source', riskSourceFilter);
  if (riskSinkFilter) searchArgs.push('--risk-sink', riskSinkFilter);
  if (riskCategoryFilter) searchArgs.push('--risk-category', riskCategoryFilter);
  if (riskFlowFilter) searchArgs.push('--risk-flow', riskFlowFilter);
  if (branchesMin !== null) searchArgs.push('--branches', String(branchesMin));
  if (loopsMin !== null) searchArgs.push('--loops', String(loopsMin));
  if (breaksMin !== null) searchArgs.push('--breaks', String(breaksMin));
  if (continuesMin !== null) searchArgs.push('--continues', String(continuesMin));
  if (churnMin !== null) searchArgs.push('--churn', String(churnMin));
  if (chunkAuthorFilter) searchArgs.push('--chunk-author', chunkAuthorFilter);
  if (modifiedAfter) searchArgs.push('--modified-after', modifiedAfter);
  if (modifiedSince !== null) searchArgs.push('--modified-since', String(modifiedSince));
  if (visibilityFilter) searchArgs.push('--visibility', visibilityFilter);
  if (extendsFilter) searchArgs.push('--extends', extendsFilter);
  if (lintFilter) searchArgs.push('--lint');
  if (asyncFilter) searchArgs.push('--async');
  if (generatorFilter) searchArgs.push('--generator');
  if (returnsFilter) searchArgs.push('--returns');
  if (branchFilter) searchArgs.push('--branch', branchFilter);
  if (langFilter) searchArgs.push('--lang', langFilter);
  if (caseAll) searchArgs.push('--case');
  if (!caseAll && caseFile) searchArgs.push('--case-file');
  if (!caseAll && caseTokens) searchArgs.push('--case-tokens');
  for (const entry of fileFilters) {
    if (entry == null || entry === '') continue;
    searchArgs.push('--path', String(entry));
  }
  for (const entry of extFilters) {
    if (entry == null || entry === '') continue;
    searchArgs.push('--ext', String(entry));
  }
  if (Array.isArray(metaFilters)) {
    metaFilters.forEach((entry) => searchArgs.push('--meta', entry));
  }
  if (metaJson) {
    const jsonValue = typeof metaJson === 'string' ? metaJson : JSON.stringify(metaJson);
    searchArgs.push('--meta-json', jsonValue);
  }

  const caches = getRepoCaches(repoPath);
  await refreshRepoCaches(repoPath);
  return await coreSearch(repoPath, {
    args: searchArgs,
    query,
    emitOutput: false,
    exitOnError: false,
    indexCache: caches.indexCache,
    sqliteCache: caches.sqliteCache,
    signal: context.signal
  });
}

/**
 * Handle the MCP download_models tool call.
 * @param {object} [args]
 * @returns {{model:string,output:string}}
 */
export async function downloadModels(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const userConfig = loadUserConfig(repoPath);
  const modelConfig = getModelConfig(repoPath, userConfig);
  const model = args.model || modelConfig.id || DEFAULT_MODEL_ID;
  const scriptArgs = [path.join(toolRoot, 'tools', 'download-models.js'), '--model', model, '--repo', repoPath];
  if (args.cacheDir) scriptArgs.push('--cache-dir', args.cacheDir);
  const progress = typeof context.progress === 'function' ? context.progress : null;
  const progressLine = progress
    ? ({ stream, line }) => progress({ message: line, stream })
    : null;
  if (progress) {
    progress({ message: `Downloading model ${model}.`, phase: 'start' });
  }
  const { stdout } = await runNodeAsync(repoPath, scriptArgs, {
    streamOutput: true,
    onLine: progressLine
  });
  if (progress) {
    progress({ message: `Model download complete (${model}).`, phase: 'done' });
  }
  return { model, output: stdout.trim() };
}

/**
 * Handle the MCP download_dictionaries tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function downloadDictionaries(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const scriptArgs = [path.join(toolRoot, 'tools', 'download-dicts.js'), '--repo', repoPath];
  if (args.lang) scriptArgs.push('--lang', String(args.lang));
  const urls = Array.isArray(args.url) ? args.url : (args.url ? [args.url] : []);
  urls.forEach((value) => scriptArgs.push('--url', String(value)));
  if (args.dir) scriptArgs.push('--dir', String(args.dir));
  if (args.update === true) scriptArgs.push('--update');
  if (args.force === true) scriptArgs.push('--force');
  const stdout = await runToolWithProgress({
    repoPath,
    scriptArgs,
    context,
    startMessage: 'Downloading dictionaries.',
    doneMessage: 'Dictionary download complete.'
  });
  const summary = parseCountSummary(stdout);
  return {
    repoPath,
    output: stdout.trim(),
    ...(summary || {})
  };
}

/**
 * Handle the MCP download_extensions tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function downloadExtensions(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const scriptArgs = [path.join(toolRoot, 'tools', 'download-extensions.js'), '--repo', repoPath];
  if (args.provider) scriptArgs.push('--provider', String(args.provider));
  if (args.dir) scriptArgs.push('--dir', String(args.dir));
  if (args.out) scriptArgs.push('--out', String(args.out));
  if (args.platform) scriptArgs.push('--platform', String(args.platform));
  if (args.arch) scriptArgs.push('--arch', String(args.arch));
  const urls = Array.isArray(args.url) ? args.url : (args.url ? [args.url] : []);
  urls.forEach((value) => scriptArgs.push('--url', String(value)));
  if (args.update === true) scriptArgs.push('--update');
  if (args.force === true) scriptArgs.push('--force');
  const stdout = await runToolWithProgress({
    repoPath,
    scriptArgs,
    context,
    startMessage: 'Downloading extensions.',
    doneMessage: 'Extension download complete.'
  });
  const summary = parseCountSummary(stdout);
  const resolvedPath = parseExtensionPath(stdout);
  return {
    repoPath,
    output: stdout.trim(),
    extensionPath: resolvedPath,
    ...(summary || {})
  };
}

/**
 * Handle the MCP verify_extensions tool call.
 * @param {object} [args]
 * @returns {object}
 */
export function verifyExtensions(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const scriptArgs = [path.join(toolRoot, 'tools', 'verify-extensions.js'), '--json', '--repo', repoPath];
  if (args.provider) scriptArgs.push('--provider', String(args.provider));
  if (args.dir) scriptArgs.push('--dir', String(args.dir));
  if (args.path) scriptArgs.push('--path', String(args.path));
  if (args.platform) scriptArgs.push('--platform', String(args.platform));
  if (args.arch) scriptArgs.push('--arch', String(args.arch));
  if (args.module) scriptArgs.push('--module', String(args.module));
  if (args.table) scriptArgs.push('--table', String(args.table));
  if (args.column) scriptArgs.push('--column', String(args.column));
  if (args.encoding) scriptArgs.push('--encoding', String(args.encoding));
  if (args.options) scriptArgs.push('--options', String(args.options));
  if (args.annMode) scriptArgs.push('--ann-mode', String(args.annMode));
  if (args.load === false) scriptArgs.push('--no-load');
  const stdout = runNodeSync(repoPath, scriptArgs);
  try {
    return JSON.parse(stdout || '{}');
  } catch {
    return { repoPath, output: stdout.trim() };
  }
}

/**
 * Handle the MCP build_sqlite_index tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function buildSqliteIndex(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const progress = typeof context.progress === 'function' ? context.progress : null;
  if (progress) {
    progress({ message: 'Building SQLite index.', phase: 'start' });
  }
  const payload = await coreBuildSqliteIndex(repoPath, {
    mode: args.mode,
    incremental: args.incremental === true,
    compact: args.compact === true,
    codeDir: args.codeDir,
    proseDir: args.proseDir,
    out: args.out,
    emitOutput: true,
    exitOnError: false
  });
  clearRepoCaches(repoPath);
  if (progress) {
    progress({ message: 'SQLite index build complete.', phase: 'done' });
  }
  return payload;
}

/**
 * Handle the MCP compact_sqlite_index tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function compactSqliteIndex(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const scriptArgs = [path.join(toolRoot, 'tools', 'compact-sqlite-index.js'), '--repo', repoPath];
  if (args.mode) scriptArgs.push('--mode', String(args.mode));
  if (args.dryRun === true) scriptArgs.push('--dry-run');
  if (args.keepBackup === true) scriptArgs.push('--keep-backup');
  const stdout = await runToolWithProgress({
    repoPath,
    scriptArgs,
    context,
    startMessage: 'Compacting SQLite index.',
    doneMessage: 'SQLite compaction complete.'
  });
  return { repoPath, output: stdout.trim() };
}

/**
 * Handle the MCP cache_gc tool call.
 * @param {object} [args]
 * @returns {object}
 */
export function cacheGc(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const scriptArgs = [path.join(toolRoot, 'tools', 'cache-gc.js'), '--json', '--repo', repoPath];
  if (args.dryRun === true) scriptArgs.push('--dry-run');
  if (Number.isFinite(Number(args.maxBytes))) scriptArgs.push('--max-bytes', String(args.maxBytes));
  if (Number.isFinite(Number(args.maxGb))) scriptArgs.push('--max-gb', String(args.maxGb));
  if (Number.isFinite(Number(args.maxAgeDays))) scriptArgs.push('--max-age-days', String(args.maxAgeDays));
  const stdout = runNodeSync(repoPath, scriptArgs);
  try {
    return JSON.parse(stdout || '{}');
  } catch {
    return { repoPath, output: stdout.trim() };
  }
}

/**
 * Handle the MCP clean_artifacts tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function cleanArtifacts(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const scriptArgs = [path.join(toolRoot, 'tools', 'clean-artifacts.js'), '--repo', repoPath];
  if (args.all === true) scriptArgs.push('--all');
  if (args.dryRun === true) scriptArgs.push('--dry-run');
  const stdout = await runToolWithProgress({
    repoPath,
    scriptArgs,
    context,
    startMessage: 'Cleaning artifacts.',
    doneMessage: 'Artifact cleanup complete.'
  });
  return { repoPath, output: stdout.trim() };
}

/**
 * Handle the MCP bootstrap tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function runBootstrap(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const scriptArgs = [path.join(toolRoot, 'tools', 'bootstrap.js'), '--repo', repoPath];
  if (args.skipInstall === true) scriptArgs.push('--skip-install');
  if (args.skipDicts === true) scriptArgs.push('--skip-dicts');
  if (args.skipIndex === true) scriptArgs.push('--skip-index');
  if (args.skipArtifacts === true) scriptArgs.push('--skip-artifacts');
  if (args.skipTooling === true) scriptArgs.push('--skip-tooling');
  if (args.withSqlite === true) scriptArgs.push('--with-sqlite');
  if (args.incremental === true) scriptArgs.push('--incremental');
  const stdout = await runToolWithProgress({
    repoPath,
    scriptArgs,
    context,
    startMessage: 'Bootstrapping repo.',
    doneMessage: 'Bootstrap complete.'
  });
  return { repoPath, output: stdout.trim() };
}

/**
 * Handle the MCP report_artifacts tool call.
 * @param {object} [args]
 * @returns {object}
 */
export async function reportArtifacts(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  return coreStatus(repoPath);
}

/**
 * Handle the MCP triage_ingest tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function triageIngest(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const source = String(args.source || '').trim();
  const inputPath = String(args.inputPath || '').trim();
  if (!source || !inputPath) {
    throw new Error('source and inputPath are required.');
  }
  const resolvedInput = path.isAbsolute(inputPath) ? inputPath : path.join(repoPath, inputPath);
  const metaFilters = normalizeMetaFilters(args.meta);
  const ingestArgs = [path.join(toolRoot, 'tools', 'triage', 'ingest.js'), '--source', source, '--in', resolvedInput];
  ingestArgs.push('--repo', repoPath);
  if (Array.isArray(metaFilters)) {
    metaFilters.forEach((entry) => ingestArgs.push('--meta', entry));
  }
  const progress = typeof context.progress === 'function' ? context.progress : null;
  const progressLine = progress
    ? ({ stream, line }) => progress({ message: line, stream })
    : null;
  if (progress) {
    progress({ message: `Ingesting ${source} findings.`, phase: 'start' });
  }
  const { stdout } = await runNodeAsync(repoPath, ingestArgs, { streamOutput: true, onLine: progressLine });
  let payload = {};
  try {
    payload = JSON.parse(stdout || '{}');
  } catch (error) {
    throw new Error(`Failed to parse ingest output: ${error?.message || error}`);
  }
  if (args.buildIndex) {
    await buildIndex({
      repoPath,
      mode: 'records',
      incremental: args.incremental === true,
      stubEmbeddings: args.stubEmbeddings === true,
      sqlite: false
    }, context);
  }
  if (progress) {
    progress({ message: 'Triage ingest complete.', phase: 'done' });
  }
  return payload;
}

/**
 * Handle the MCP triage_decision tool call.
 * @param {object} [args]
 * @returns {object}
 */
export function triageDecision(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const finding = String(args.finding || '').trim();
  const status = String(args.status || '').trim();
  if (!finding || !status) {
    throw new Error('finding and status are required.');
  }
  const metaFilters = normalizeMetaFilters(args.meta);
  const decisionArgs = [path.join(toolRoot, 'tools', 'triage', 'decision.js'), '--finding', finding, '--status', status];
  decisionArgs.push('--repo', repoPath);
  if (args.justification) decisionArgs.push('--justification', String(args.justification));
  if (args.reviewer) decisionArgs.push('--reviewer', String(args.reviewer));
  if (args.expires) decisionArgs.push('--expires', String(args.expires));
  if (Array.isArray(metaFilters)) {
    metaFilters.forEach((entry) => decisionArgs.push('--meta', entry));
  }
  const codes = Array.isArray(args.codes) ? args.codes : (args.codes ? [args.codes] : []);
  const evidence = Array.isArray(args.evidence) ? args.evidence : (args.evidence ? [args.evidence] : []);
  codes.filter(Boolean).forEach((code) => decisionArgs.push('--code', String(code)));
  evidence.filter(Boolean).forEach((item) => decisionArgs.push('--evidence', String(item)));
  const stdout = runNodeSync(repoPath, decisionArgs);
  return JSON.parse(stdout || '{}');
}

/**
 * Handle the MCP triage_context_pack tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function triageContextPack(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const recordId = String(args.recordId || '').trim();
  if (!recordId) throw new Error('recordId is required.');
  const contextArgs = [path.join(toolRoot, 'tools', 'triage', 'context-pack.js'), '--record', recordId];
  contextArgs.push('--repo', repoPath);
  if (args.outPath) contextArgs.push('--out', String(args.outPath));
  if (args.ann === true) contextArgs.push('--ann');
  if (args.ann === false) contextArgs.push('--no-ann');
  if (args.stubEmbeddings === true) contextArgs.push('--stub-embeddings');
  const progress = typeof context.progress === 'function' ? context.progress : null;
  const progressLine = progress
    ? ({ stream, line }) => progress({ message: line, stream })
    : null;
  if (progress) {
    progress({ message: 'Building triage context pack.', phase: 'start' });
  }
  const { stdout } = await runNodeAsync(repoPath, contextArgs, { streamOutput: true, onLine: progressLine });
  if (progress) {
    progress({ message: 'Context pack ready.', phase: 'done' });
  }
  try {
    return JSON.parse(stdout || '{}');
  } catch (error) {
    throw new Error(`Failed to parse context pack output: ${error?.message || error}`);
  }
}

/**
 * Dispatch an MCP tool call by name.
 * @param {string} name
 * @param {object} args
 * @returns {Promise<any>}
 */
export async function handleToolCall(name, args, context = {}) {
  switch (name) {
    case 'index_status':
      return await indexStatus(args);
    case 'config_status':
      return await configStatus(args);
    case 'build_index':
      return await buildIndex(args, context);
    case 'search':
      return await runSearch(args, context);
    case 'download_models':
      return await downloadModels(args, context);
    case 'download_dictionaries':
      return await downloadDictionaries(args, context);
    case 'download_extensions':
      return await downloadExtensions(args, context);
    case 'verify_extensions':
      return verifyExtensions(args);
    case 'build_sqlite_index':
      return await buildSqliteIndex(args, context);
    case 'compact_sqlite_index':
      return await compactSqliteIndex(args, context);
    case 'cache_gc':
      return cacheGc(args);
    case 'clean_artifacts':
      return await cleanArtifacts(args, context);
    case 'bootstrap':
      return await runBootstrap(args, context);
    case 'report_artifacts':
      return await reportArtifacts(args);
    case 'triage_ingest':
      return await triageIngest(args, context);
    case 'triage_decision':
      return triageDecision(args);
    case 'triage_context_pack':
      return await triageContextPack(args, context);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
