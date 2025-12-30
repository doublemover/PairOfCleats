#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import simpleGit from 'simple-git';
import { getToolDefs } from '../src/mcp/defs.js';
import { sendError, sendNotification, sendResult } from '../src/mcp/protocol.js';
import {
  DEFAULT_MODEL_ID,
  getCacheRoot,
  getDictConfig,
  getDictionaryPaths,
  getIndexDir,
  getMetricsDir,
  getModelConfig,
  getRepoCacheRoot,
  getRepoId,
  loadUserConfig,
  resolveSqlitePaths
} from './dict-utils.js';
import { getVectorExtensionConfig, resolveVectorExtensionPath } from './vector-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const TOOL_DEFS = getToolDefs(DEFAULT_MODEL_ID);


/**
 * Resolve and validate a repo path.
 * @param {string} inputPath
 * @returns {string}
 */
function resolveRepoPath(inputPath) {
  const base = inputPath ? path.resolve(inputPath) : process.cwd();
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    throw new Error(`Repo path not found: ${base}`);
  }
  return base;
}

/**
 * Build the artifact path map for a repo.
 * @param {string} repoPath
 * @param {object} userConfig
 * @returns {object}
 */
function listArtifacts(repoPath, userConfig) {
  const indexCode = getIndexDir(repoPath, 'code', userConfig);
  const indexProse = getIndexDir(repoPath, 'prose', userConfig);
  const indexRecords = getIndexDir(repoPath, 'records', userConfig);
  const metricsDir = getMetricsDir(repoPath, userConfig);
  const sqlitePaths = resolveSqlitePaths(repoPath, userConfig);
  return {
    index: {
      code: {
        dir: indexCode,
        chunkMeta: path.join(indexCode, 'chunk_meta.json'),
        tokenPostings: path.join(indexCode, 'token_postings.json')
      },
      prose: {
        dir: indexProse,
        chunkMeta: path.join(indexProse, 'chunk_meta.json'),
        tokenPostings: path.join(indexProse, 'token_postings.json')
      },
      records: {
        dir: indexRecords,
        chunkMeta: path.join(indexRecords, 'chunk_meta.json'),
        tokenPostings: path.join(indexRecords, 'token_postings.json')
      }
    },
    metrics: {
      dir: metricsDir,
      indexCode: path.join(metricsDir, 'index-code.json'),
      indexProse: path.join(metricsDir, 'index-prose.json'),
      indexRecords: path.join(metricsDir, 'index-records.json'),
      queryCache: path.join(metricsDir, 'queryCache.json')
    },
    sqlite: {
      code: sqlitePaths.codePath,
      prose: sqlitePaths.prosePath,
      legacy: sqlitePaths.legacyPath,
      legacyExists: sqlitePaths.legacyExists
    }
  };
}

/**
 * Stat a path if it exists.
 * @param {string} target
 * @returns {{exists:boolean,mtime:(string|null),bytes:number}}
 */
function statIfExists(target) {
  try {
    const stat = fs.statSync(target);
    return {
      exists: true,
      mtime: stat.mtime ? stat.mtime.toISOString() : null,
      bytes: stat.size
    };
  } catch {
    return { exists: false, mtime: null, bytes: 0 };
  }
}

/**
 * Fetch lightweight git status info for a repo.
 * @param {string} repoPath
 * @returns {Promise<object>}
 */
async function getGitInfo(repoPath) {
  const gitDir = path.join(repoPath, '.git');
  const hasGitDir = fs.existsSync(gitDir);
  if (!hasGitDir) {
    return {
      isRepo: false,
      warning: 'Git repository not detected; using path-based repo identity.'
    };
  }
  try {
    const git = simpleGit(repoPath);
    const status = await git.status();
    const head = await git.revparse(['HEAD']);
    return {
      isRepo: true,
      head: head.trim(),
      branch: status.current || null,
      isDirty: status.files.length > 0
    };
  } catch (error) {
    return {
      isRepo: true,
      warning: `Git detected but status unavailable: ${error.message}`
    };
  }
}

/**
 * Build an index status report for the MCP tool.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
async function indexStatus(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const userConfig = loadUserConfig(repoPath);
  const cacheRoot = (userConfig.cache && userConfig.cache.root) || process.env.PAIROFCLEATS_CACHE_ROOT || getCacheRoot();
  const repoId = getRepoId(repoPath);
  const repoCacheRoot = getRepoCacheRoot(repoPath, userConfig);
  const dictConfig = getDictConfig(repoPath, userConfig);
  const dictPaths = await getDictionaryPaths(repoPath, dictConfig);
  const modelConfig = getModelConfig(repoPath, userConfig);
  const modelsDir = modelConfig.dir;
  const modelDirName = `models--${modelConfig.id.replace('/', '--')}`;
  const modelPath = path.join(modelsDir, modelDirName);

  const artifacts = listArtifacts(repoPath, userConfig);
  const git = await getGitInfo(repoPath);
  const incrementalRoot = path.join(repoCacheRoot, 'incremental');
  const report = {
    repoPath,
    repoId,
    cacheRoot,
    repoCacheRoot,
    git,
    dictionaries: {
      dir: dictConfig.dir,
      files: dictPaths,
      enabled: dictPaths.length > 0,
      includeSlang: dictConfig.includeSlang
    },
    models: {
      dir: modelsDir,
      model: modelConfig.id,
      available: fs.existsSync(modelPath),
      hint: fs.existsSync(modelPath)
        ? null
        : 'Run the download_models tool or `npm run download-models` to prefetch embeddings.'
    },
    incremental: {
      dir: incrementalRoot,
      exists: fs.existsSync(incrementalRoot)
    },
    index: {
      code: {
        dir: artifacts.index.code.dir,
        chunkMeta: statIfExists(artifacts.index.code.chunkMeta),
        tokenPostings: statIfExists(artifacts.index.code.tokenPostings)
      },
      prose: {
        dir: artifacts.index.prose.dir,
        chunkMeta: statIfExists(artifacts.index.prose.chunkMeta),
        tokenPostings: statIfExists(artifacts.index.prose.tokenPostings)
      },
      records: {
        dir: artifacts.index.records.dir,
        chunkMeta: statIfExists(artifacts.index.records.chunkMeta),
        tokenPostings: statIfExists(artifacts.index.records.tokenPostings)
      }
    },
    sqlite: {
      code: { path: artifacts.sqlite.code, ...statIfExists(artifacts.sqlite.code) },
      prose: { path: artifacts.sqlite.prose, ...statIfExists(artifacts.sqlite.prose) },
      legacy: artifacts.sqlite.legacyExists ? artifacts.sqlite.legacy : null
    },
    metrics: {
      dir: artifacts.metrics.dir,
      indexCode: statIfExists(artifacts.metrics.indexCode),
      indexProse: statIfExists(artifacts.metrics.indexProse),
      indexRecords: statIfExists(artifacts.metrics.indexRecords),
      queryCache: statIfExists(artifacts.metrics.queryCache)
    }
  };

  return report;
}

/**
 * Inspect configuration + cache status with warnings.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
async function configStatus(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const userConfig = loadUserConfig(repoPath);
  const cacheRoot = (userConfig.cache && userConfig.cache.root) || process.env.PAIROFCLEATS_CACHE_ROOT || getCacheRoot();
  const repoCacheRoot = getRepoCacheRoot(repoPath, userConfig);
  const dictConfig = getDictConfig(repoPath, userConfig);
  const dictionaryPaths = await getDictionaryPaths(repoPath, dictConfig);
  const modelConfig = getModelConfig(repoPath, userConfig);
  const modelsDir = modelConfig.dir;
  const modelDirName = `models--${modelConfig.id.replace('/', '--')}`;
  const modelPath = path.join(modelsDir, modelDirName);
  const sqlitePaths = resolveSqlitePaths(repoPath, userConfig);
  const sqliteConfigured = userConfig.sqlite?.use !== false;
  const vectorConfig = getVectorExtensionConfig(repoPath, userConfig);
  const vectorPath = resolveVectorExtensionPath(vectorConfig);

  const warnings = [];
  if (!dictionaryPaths.length && (dictConfig.languages.length || dictConfig.files.length || dictConfig.includeSlang || dictConfig.enableRepoDictionary)) {
    warnings.push({
      code: 'dictionary_missing',
      message: 'No dictionary files found; identifier splitting will be limited.'
    });
  }
  if (!fs.existsSync(modelPath)) {
    warnings.push({
      code: 'model_missing',
      message: `Embedding model not found (${modelConfig.id}). Run npm run download-models.`
    });
  }
  if (sqliteConfigured) {
    const missing = [];
    if (!fs.existsSync(sqlitePaths.codePath)) missing.push(`code=${sqlitePaths.codePath}`);
    if (!fs.existsSync(sqlitePaths.prosePath)) missing.push(`prose=${sqlitePaths.prosePath}`);
    if (missing.length) {
      warnings.push({
        code: 'sqlite_missing',
        message: `SQLite indexes missing (${missing.join(', ')}). Run npm run build-sqlite-index.`
      });
    }
  }
  if (vectorConfig.enabled) {
    if (!vectorPath || !fs.existsSync(vectorPath)) {
      warnings.push({
        code: 'extension_missing',
        message: 'SQLite vector extension is enabled but not installed.'
      });
    }
  }

  return {
    repoPath,
    repoId: getRepoId(repoPath),
    config: {
      cacheRoot,
      repoCacheRoot,
      dictionary: dictConfig,
      models: modelConfig,
      sqlite: {
        use: sqliteConfigured,
        annMode: userConfig.sqlite?.annMode || null,
        codeDbPath: sqlitePaths.codePath,
        proseDbPath: sqlitePaths.prosePath
      },
      search: userConfig.search || {},
      indexing: userConfig.indexing || {},
      tooling: userConfig.tooling || {}
    },
    cache: {
      cacheRootExists: fs.existsSync(cacheRoot),
      repoCacheExists: fs.existsSync(repoCacheRoot),
      dictionaries: dictionaryPaths,
      modelAvailable: fs.existsSync(modelPath),
      sqlite: {
        codeExists: fs.existsSync(sqlitePaths.codePath),
        proseExists: fs.existsSync(sqlitePaths.prosePath)
      },
      vectorExtension: {
        enabled: vectorConfig.enabled,
        path: vectorPath,
        available: !!(vectorPath && fs.existsSync(vectorPath))
      }
    },
    warnings
  };
}

/**
 * Run a node command and return stdout.
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
function runNodeSync(cwd, args) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    const err = result.stderr || `Command failed: ${args.join(' ')}`;
    throw new Error(err.trim());
  }
  return result.stdout || '';
}

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
 * Build a line buffer for progress streaming.
 * @param {(line:string)=>void} onLine
 * @returns {{push:(text:string)=>void,flush:()=>void}}
 */
function createLineBuffer(onLine) {
  let buffer = '';
  return {
    push(text) {
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) onLine(trimmed);
      }
    },
    flush() {
      const trimmed = buffer.trim();
      if (trimmed) onLine(trimmed);
      buffer = '';
    }
  };
}

/**
 * Run a node command asynchronously with optional stderr streaming.
 * @param {string} cwd
 * @param {string[]} args
 * @param {{streamOutput?:boolean,onLine?:(payload:{stream:string,line:string})=>void}} [options]
 * @returns {Promise<{stdout:string,stderr:string}>}
 */
function runNodeAsync(cwd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd });
    let stdout = '';
    let stderr = '';
    const streamOutput = options.streamOutput === true;
    const onLine = typeof options.onLine === 'function' ? options.onLine : null;
    const stdoutBuffer = onLine
      ? createLineBuffer((line) => onLine({ stream: 'stdout', line }))
      : null;
    const stderrBuffer = onLine
      ? createLineBuffer((line) => onLine({ stream: 'stderr', line }))
      : null;
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (streamOutput) process.stderr.write(text);
      stdoutBuffer?.push(text);
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (streamOutput) process.stderr.write(text);
      stderrBuffer?.push(text);
    });
    child.on('error', (err) => {
      const error = new Error(err.message || 'Command failed');
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
    child.on('close', (code) => {
      stdoutBuffer?.flush();
      stderrBuffer?.flush();
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(stderr.trim() || `Command failed: ${args.join(' ')}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

/**
 * Format error payloads for tool responses.
 * @param {any} error
 * @returns {{message:string,code?:number,stderr?:string,stdout?:string}}
 */
function getRemediationHint(error) {
  const parts = [error?.message, error?.stderr, error?.stdout]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  if (!parts) return null;

  if (parts.includes('sqlite backend requested but index not found')
    || parts.includes('missing required tables')) {
    return 'Run `npm run build-sqlite-index` or set sqlite.use=false / --backend memory.';
  }
  if (parts.includes('better-sqlite3 is required')) {
    return 'Run `npm install` and ensure better-sqlite3 can load on this platform.';
  }
  if (parts.includes('chunk_meta.json') || parts.includes('minhash_signatures')) {
    return 'Run `npm run build-index` (or `npm run setup`/`npm run bootstrap`) to generate indexes.';
  }
  if ((parts.includes('model') || parts.includes('xenova') || parts.includes('transformers'))
    && (parts.includes('not found') || parts.includes('failed') || parts.includes('fetch') || parts.includes('download') || parts.includes('enoent'))) {
    return 'Run `npm run download-models` or use `--stub-embeddings` / `PAIROFCLEATS_EMBEDDINGS=stub`.';
  }
  if (parts.includes('dictionary')
    || parts.includes('wordlist')
    || parts.includes('words_alpha')
    || parts.includes('download-dicts')) {
    return 'Run `npm run download-dicts -- --lang en` (or configure dictionary.files/languages).';
  }
  return null;
}

/**
 * Format error payloads for tool responses.
 * @param {any} error
 * @returns {{message:string,code?:number,stderr?:string,stdout?:string,hint?:string}}
 */
function formatToolError(error) {
  const payload = {
    message: error?.message || String(error)
  };
  if (error?.code !== undefined) payload.code = error.code;
  if (error?.stderr) payload.stderr = String(error.stderr).trim();
  if (error?.stdout) payload.stdout = String(error.stdout).trim();
  const hint = getRemediationHint(error);
  if (hint) payload.hint = hint;
  return payload;
}

/**
 * Emit a progress notification for long-running tools.
 * @param {string|number|null} id
 * @param {string} tool
 * @param {{message:string,stream?:string,phase?:string}} payload
 */
function sendProgress(id, tool, payload) {
  if (id === null || id === undefined) return;
  const message = payload?.message ? String(payload.message) : '';
  if (!message) return;
  sendNotification('notifications/progress', {
    id,
    tool,
    message,
    stream: payload?.stream || 'info',
    phase: payload?.phase || 'progress',
    ts: new Date().toISOString()
  });
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
  runNodeSync(repoPath, [path.join(ROOT, 'tools', 'ci-restore-artifacts.js'), '--from', fromDir]);
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
async function buildIndex(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const userConfig = loadUserConfig(repoPath);
  const sqliteConfigured = userConfig.sqlite?.use !== false;
  const shouldUseSqlite = typeof args.sqlite === 'boolean' ? args.sqlite : sqliteConfigured;
  const mode = args.mode || 'all';
  const incremental = args.incremental === true;
  const stubEmbeddings = args.stubEmbeddings === true;
  const buildSqlite = shouldUseSqlite && mode !== 'records';
  const useArtifacts = args.useArtifacts === true;
  const progress = typeof context.progress === 'function' ? context.progress : null;
  const progressLine = progress
    ? ({ stream, line }) => progress({ message: line, stream })
    : null;

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
    const indexArgs = [path.join(ROOT, 'build_index.js')];
    if (mode && mode !== 'all') indexArgs.push('--mode', mode);
    if (incremental) indexArgs.push('--incremental');
    if (stubEmbeddings) indexArgs.push('--stub-embeddings');
    await runNodeAsync(repoPath, indexArgs, { streamOutput: true, onLine: progressLine });
  }

  if (buildSqlite) {
    if (progress) {
      progress({
        message: `Building SQLite index${incremental ? ' (incremental)' : ''}.`,
        phase: 'start'
      });
    }
    const sqliteArgs = [path.join(ROOT, 'tools', 'build-sqlite-index.js')];
    if (incremental) sqliteArgs.push('--incremental');
    await runNodeAsync(repoPath, sqliteArgs, { streamOutput: true, onLine: progressLine });
  }
  if (progress) {
    progress({
      message: 'Index build complete.',
      phase: 'done'
    });
  }

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
function runSearch(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const query = String(args.query || '').trim();
  if (!query) throw new Error('Query is required.');
  const mode = args.mode || 'both';
  const backend = args.backend || null;
  const ann = typeof args.ann === 'boolean' ? args.ann : null;
  const top = Number.isFinite(Number(args.top)) ? Math.max(1, Number(args.top)) : null;
  const context = Number.isFinite(Number(args.context)) ? Math.max(0, Number(args.context)) : null;
  const fileFilter = args.file ? String(args.file) : null;
  const extFilter = args.ext ? String(args.ext) : null;
  const metaFilters = normalizeMetaFilters(args.meta);
  const metaJson = args.metaJson || null;

  const searchArgs = [path.join(ROOT, 'search.js'), query, '--json'];
  if (mode && mode !== 'both') searchArgs.push('--mode', mode);
  if (backend) searchArgs.push('--backend', backend);
  if (ann === true) searchArgs.push('--ann');
  if (ann === false) searchArgs.push('--no-ann');
  if (top) searchArgs.push('-n', String(top));
  if (context !== null) searchArgs.push('--context', String(context));
  if (fileFilter) searchArgs.push('--file', fileFilter);
  if (extFilter) searchArgs.push('--ext', extFilter);
  if (Array.isArray(metaFilters)) {
    metaFilters.forEach((entry) => searchArgs.push('--meta', entry));
  }
  if (metaJson) {
    const jsonValue = typeof metaJson === 'string' ? metaJson : JSON.stringify(metaJson);
    searchArgs.push('--meta-json', jsonValue);
  }

  const stdout = runNodeSync(repoPath, searchArgs);
  return JSON.parse(stdout || '{}');
}

/**
 * Handle the MCP download_models tool call.
 * @param {object} [args]
 * @returns {{model:string,output:string}}
 */
async function downloadModels(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const userConfig = loadUserConfig(repoPath);
  const modelConfig = getModelConfig(repoPath, userConfig);
  const model = args.model || modelConfig.id || DEFAULT_MODEL_ID;
  const scriptArgs = [path.join(ROOT, 'tools', 'download-models.js'), '--model', model];
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
 * Handle the MCP report_artifacts tool call.
 * @param {object} [args]
 * @returns {object}
 */
function reportArtifacts(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const stdout = runNodeSync(repoPath, [path.join(ROOT, 'tools', 'report-artifacts.js'), '--json']);
  return JSON.parse(stdout || '{}');
}

/**
 * Handle the MCP triage_ingest tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
async function triageIngest(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const source = String(args.source || '').trim();
  const inputPath = String(args.inputPath || '').trim();
  if (!source || !inputPath) {
    throw new Error('source and inputPath are required.');
  }
  const resolvedInput = path.isAbsolute(inputPath) ? inputPath : path.join(repoPath, inputPath);
  const metaFilters = normalizeMetaFilters(args.meta);
  const ingestArgs = [path.join(ROOT, 'tools', 'triage', 'ingest.js'), '--source', source, '--in', resolvedInput];
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
function triageDecision(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const finding = String(args.finding || '').trim();
  const status = String(args.status || '').trim();
  if (!finding || !status) {
    throw new Error('finding and status are required.');
  }
  const metaFilters = normalizeMetaFilters(args.meta);
  const decisionArgs = [path.join(ROOT, 'tools', 'triage', 'decision.js'), '--finding', finding, '--status', status];
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
async function triageContextPack(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const recordId = String(args.recordId || '').trim();
  if (!recordId) throw new Error('recordId is required.');
  const contextArgs = [path.join(ROOT, 'tools', 'triage', 'context-pack.js'), '--record', recordId];
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
async function handleToolCall(name, args, context = {}) {
  switch (name) {
    case 'index_status':
      return await indexStatus(args);
    case 'config_status':
      return await configStatus(args);
    case 'build_index':
      return await buildIndex(args, context);
    case 'search':
      return runSearch(args);
    case 'download_models':
      return await downloadModels(args, context);
    case 'report_artifacts':
      return reportArtifacts(args);
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

/**
 * Handle a JSON-RPC message from stdin.
 * @param {object} message
 * @returns {Promise<void>}
 */
async function handleMessage(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  const { id, method, params } = message;

  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'PairOfCleats', version: PKG.version },
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false }
      }
    });
    return;
  }

  if (method === 'shutdown') {
    sendResult(id, {});
    return;
  }

  if (method === 'exit') {
    process.exit(0);
  }

  if (method === 'tools/list') {
    sendResult(id, { tools: TOOL_DEFS });
    return;
  }

  if (method === 'resources/list') {
    sendResult(id, { resources: [] });
    return;
  }

  if (method === 'tools/call') {
    if (!id) return;
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      const progress = (payload) => sendProgress(id, name, payload);
      const result = await handleToolCall(name, args, { progress, toolCallId: id });
      sendResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      });
    } catch (error) {
      const payload = formatToolError(error);
      sendResult(id, {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        isError: true
      });
    }
    return;
  }

  if (id) {
    sendError(id, -32601, `Method not found: ${method}`);
  }
}

let buffer = Buffer.alloc(0);
let processing = false;
const queue = [];

/**
 * Process queued messages serially.
 */
function processQueue() {
  if (processing) return;
  processing = true;
  const run = async () => {
    while (queue.length) {
      const msg = queue.shift();
      await handleMessage(msg);
    }
    processing = false;
  };
  run().catch((error) => {
    processing = false;
    console.error(error);
  });
}

/**
 * Enqueue a message for processing.
 * @param {object} message
 */
function enqueueMessage(message) {
  queue.push(message);
  processQueue();
}

/**
 * Parse framed JSON-RPC messages from the input buffer.
 */
function parseBuffer() {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString('utf8');
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = parseInt(lengthMatch[1], 10);
    const total = headerEnd + 4 + length;
    if (buffer.length < total) return;
    const body = buffer.slice(headerEnd + 4, total).toString('utf8');
    buffer = buffer.slice(total);
    try {
      const msg = JSON.parse(body);
      enqueueMessage(msg);
    } catch {}
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  parseBuffer();
});

process.stdin.on('end', () => {
  process.exit(0);
});
