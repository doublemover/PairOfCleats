#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa, execaSync } from 'execa';
import simpleGit from 'simple-git';
import { getToolDefs } from '../src/mcp/defs.js';
import { sendError, sendNotification, sendResult } from '../src/mcp/protocol.js';
import { StreamMessageReader } from 'vscode-jsonrpc';
import { buildIndex as coreBuildIndex, buildSqliteIndex as coreBuildSqliteIndex, search as coreSearch, status as coreStatus } from '../src/core/index.js';
import { createSqliteDbCache } from '../src/search/sqlite-cache.js';
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
  resolveRepoRoot,
  resolveSqlitePaths
} from './dict-utils.js';
import { getVectorExtensionConfig, resolveVectorExtensionPath } from './vector-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const TOOL_DEFS = getToolDefs(DEFAULT_MODEL_ID);

const repoCaches = new Map();

const getRepoCaches = (repoPath) => {
  const key = repoPath || process.cwd();
  const existing = repoCaches.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing;
  }
  const entry = {
    indexCache: new Map(),
    sqliteCache: createSqliteDbCache(),
    lastUsed: Date.now()
  };
  repoCaches.set(key, entry);
  return entry;
};

const clearRepoCaches = (repoPath) => {
  if (!repoPath) return;
  const entry = repoCaches.get(repoPath);
  if (!entry) return;
  entry.sqliteCache?.closeAll?.();
  entry.indexCache?.clear?.();
  repoCaches.delete(repoPath);
};


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
  return inputPath ? base : resolveRepoRoot(base);
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
  const result = execaSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    reject: false
  });
  if (result.exitCode !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const message = stderr || stdout || `Command failed: ${args.join(' ')}`;
    const error = new Error(message.trim());
    error.code = result.exitCode;
    error.stderr = stderr;
    error.stdout = stdout;
    throw error;
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
 * @param {{streamOutput?:boolean,onLine?:(payload:{stream:string,line:string})=>void,maxBufferBytes?:number}} [options]
 * @returns {Promise<{stdout:string,stderr:string}>}
 */
function runNodeAsync(cwd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execa(process.execPath, args, {
      cwd,
      reject: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const streamOutput = options.streamOutput === true;
    const onLine = typeof options.onLine === 'function' ? options.onLine : null;
    const maxBufferBytes = Number.isFinite(Number(options.maxBufferBytes))
      ? Math.max(0, Number(options.maxBufferBytes))
      : 1024 * 1024;
    const appendLimited = (current, text) => {
      if (!maxBufferBytes) return current + text;
      const combined = current + text;
      if (combined.length <= maxBufferBytes) return combined;
      return combined.slice(combined.length - maxBufferBytes);
    };
    const stdoutBuffer = onLine
      ? createLineBuffer((line) => onLine({ stream: 'stdout', line }))
      : null;
    const stderrBuffer = onLine
      ? createLineBuffer((line) => onLine({ stream: 'stderr', line }))
      : null;
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout = appendLimited(stdout, text);
      if (streamOutput) process.stderr.write(text);
      stdoutBuffer?.push(text);
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr = appendLimited(stderr, text);
      if (streamOutput) process.stderr.write(text);
      stderrBuffer?.push(text);
    });
    child
      .then((result) => {
        stdoutBuffer?.flush();
        stderrBuffer?.flush();
        if (result.exitCode === 0) {
          resolve({ stdout, stderr });
          return;
        }
        const error = new Error(stderr.trim() || `Command failed: ${args.join(' ')}`);
        error.code = result.exitCode;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      })
      .catch((err) => {
        const error = new Error(err?.shortMessage || err?.message || 'Command failed');
        error.code = err?.exitCode;
        error.stdout = err?.stdout || stdout;
        error.stderr = err?.stderr || stderr;
        reject(error);
      });
  });
}

/**
 * Run a tool script with progress notifications.
 * @param {{repoPath:string,scriptArgs:string[],context?:object,startMessage?:string,doneMessage?:string}} input
 * @returns {Promise<string>}
 */
async function runToolWithProgress({ repoPath, scriptArgs, context = {}, startMessage, doneMessage }) {
  const progress = typeof context.progress === 'function' ? context.progress : null;
  if (progress && startMessage) {
    progress({ message: startMessage, phase: 'start' });
  }
  const { stdout } = await runNodeAsync(repoPath, scriptArgs, {
    streamOutput: true,
    onLine: progressLine
  });
  if (progress && doneMessage) {
    progress({ message: doneMessage, phase: 'done' });
  }
  return stdout || '';
}

function parseCountSummary(stdout) {
  const match = String(stdout || '').match(/downloaded=(\d+)\s+skipped=(\d+)/i);
  if (!match) return null;
  return {
    downloaded: Number(match[1]),
    skipped: Number(match[2])
  };
}

function parseExtensionPath(stdout) {
  const match = String(stdout || '').match(/Extension present at (.+)$/im);
  return match ? match[1].trim() : null;
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
  if (parts.includes('chunk_meta.json')
    || parts.includes('minhash_signatures')
    || parts.includes('index not found')
    || parts.includes('build-index')
    || parts.includes('build index')) {
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
  runNodeSync(repoPath, [path.join(ROOT, 'tools', 'ci-restore-artifacts.js'), '--repo', repoPath, '--from', fromDir]);
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
async function runSearch(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const query = String(args.query || '').trim();
  if (!query) throw new Error('Query is required.');
  const mode = args.mode || 'both';
  const backend = args.backend || null;
  const output = typeof args.output === 'string' ? args.output.toLowerCase() : '';
  const ann = typeof args.ann === 'boolean' ? args.ann : null;
  const top = Number.isFinite(Number(args.top)) ? Math.max(1, Number(args.top)) : null;
  const context = Number.isFinite(Number(args.context)) ? Math.max(0, Number(args.context)) : null;
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
  const searchArgs = [useCompact ? '--json-compact' : '--json', '--repo', repoPath];
  if (mode && mode !== 'both') searchArgs.push('--mode', mode);
  if (backend) searchArgs.push('--backend', backend);
  if (ann === true) searchArgs.push('--ann');
  if (ann === false) searchArgs.push('--no-ann');
  if (top) searchArgs.push('-n', String(top));
  if (context !== null) searchArgs.push('--context', String(context));
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
  return await coreSearch(repoPath, {
    args: searchArgs,
    query,
    emitOutput: false,
    exitOnError: false,
    indexCache: caches.indexCache,
    sqliteCache: caches.sqliteCache
  });
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
  const scriptArgs = [path.join(ROOT, 'tools', 'download-models.js'), '--model', model, '--repo', repoPath];
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
async function downloadDictionaries(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const scriptArgs = [path.join(ROOT, 'tools', 'download-dicts.js'), '--repo', repoPath];
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
async function downloadExtensions(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const scriptArgs = [path.join(ROOT, 'tools', 'download-extensions.js'), '--repo', repoPath];
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
function verifyExtensions(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const scriptArgs = [path.join(ROOT, 'tools', 'verify-extensions.js'), '--json', '--repo', repoPath];
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
async function buildSqliteIndex(args = {}, context = {}) {
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
async function compactSqliteIndex(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const scriptArgs = [path.join(ROOT, 'tools', 'compact-sqlite-index.js'), '--repo', repoPath];
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
function cacheGc(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const scriptArgs = [path.join(ROOT, 'tools', 'cache-gc.js'), '--json', '--repo', repoPath];
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
async function cleanArtifacts(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const scriptArgs = [path.join(ROOT, 'tools', 'clean-artifacts.js'), '--repo', repoPath];
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
async function runBootstrap(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const scriptArgs = [path.join(ROOT, 'tools', 'bootstrap.js'), '--repo', repoPath];
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
async function reportArtifacts(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  return coreStatus(repoPath);
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
      return await runSearch(args);
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

const reader = new StreamMessageReader(process.stdin);
reader.onError((err) => console.error(err?.message || err));
reader.onClose(() => process.exit(0));
reader.listen(enqueueMessage);
