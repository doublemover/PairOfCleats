#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import simpleGit from 'simple-git';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const TOOL_DEFS = [
  {
    name: 'index_status',
    description: 'Return cache and index status for a repo path.',
    inputSchema: {
      type: 'object',
      properties: {
        repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' }
      }
    }
  },
  {
    name: 'build_index',
    description: 'Build or update indexes for a repo (optionally SQLite + incremental).',
    inputSchema: {
      type: 'object',
      properties: {
        repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
        mode: { type: 'string', enum: ['all', 'code', 'prose'] },
        sqlite: { type: 'boolean', description: 'Build SQLite indexes after JSON indexes.' },
        incremental: { type: 'boolean', description: 'Reuse per-file incremental cache.' },
        stubEmbeddings: { type: 'boolean', description: 'Skip model downloads and use stub embeddings.' },
        useArtifacts: { type: 'boolean', description: 'Restore CI artifacts before building.' },
        artifactsDir: { type: 'string', description: 'Path to CI artifacts directory.' }
      }
    }
  },
  {
    name: 'search',
    description: 'Run a search query against the repo index.',
    inputSchema: {
      type: 'object',
      properties: {
        repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
        query: { type: 'string' },
        mode: { type: 'string', enum: ['both', 'code', 'prose'] },
        backend: { type: 'string', enum: ['memory', 'sqlite', 'sqlite-fts'] },
        ann: { type: 'boolean', description: 'Enable ANN re-ranking (default uses config).' },
        top: { type: 'number', description: 'Top N results.' },
        context: { type: 'number', description: 'Context lines.' }
      },
      required: ['query']
    }
  },
  {
    name: 'download_models',
    description: 'Download embedding models into the shared cache.',
    inputSchema: {
      type: 'object',
      properties: {
        repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
        model: { type: 'string', description: `Model id (default ${DEFAULT_MODEL_ID}).` },
        cacheDir: { type: 'string', description: 'Override cache directory.' }
      }
    }
  },
  {
    name: 'report_artifacts',
    description: 'Report current artifact sizes for the repo and cache root.',
    inputSchema: {
      type: 'object',
      properties: {
        repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' }
      }
    }
  }
];

function sendMessage(payload) {
  const json = JSON.stringify(payload);
  const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
  process.stdout.write(header + json);
}

function sendResult(id, result) {
  sendMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  sendMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

function resolveRepoPath(inputPath) {
  const base = inputPath ? path.resolve(inputPath) : process.cwd();
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    throw new Error(`Repo path not found: ${base}`);
  }
  return base;
}

function listArtifacts(repoPath, userConfig) {
  const indexCode = getIndexDir(repoPath, 'code', userConfig);
  const indexProse = getIndexDir(repoPath, 'prose', userConfig);
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
      }
    },
    metrics: {
      dir: metricsDir,
      indexCode: path.join(metricsDir, 'index-code.json'),
      indexProse: path.join(metricsDir, 'index-prose.json'),
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
      queryCache: statIfExists(artifacts.metrics.queryCache)
    }
  };

  return report;
}

function runNode(cwd, args) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    const err = result.stderr || `Command failed: ${args.join(' ')}`;
    throw new Error(err.trim());
  }
  return result.stdout || '';
}

function maybeRestoreArtifacts(repoPath, artifactsDir) {
  const fromDir = artifactsDir ? path.resolve(artifactsDir) : path.join(repoPath, 'ci-artifacts');
  if (!fs.existsSync(path.join(fromDir, 'manifest.json'))) return false;
  runNode(repoPath, [path.join(ROOT, 'tools', 'ci-restore-artifacts.js'), '--from', fromDir]);
  return true;
}

function buildIndex(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const userConfig = loadUserConfig(repoPath);
  const sqliteConfigured = userConfig.sqlite?.use !== false;
  const shouldUseSqlite = typeof args.sqlite === 'boolean' ? args.sqlite : sqliteConfigured;
  const mode = args.mode || 'all';
  const incremental = args.incremental === true;
  const stubEmbeddings = args.stubEmbeddings === true;
  const useArtifacts = args.useArtifacts === true;

  let restoredArtifacts = false;
  if (useArtifacts) {
    restoredArtifacts = maybeRestoreArtifacts(repoPath, args.artifactsDir);
  }

  if (!restoredArtifacts) {
    const indexArgs = [path.join(ROOT, 'build_index.js')];
    if (mode && mode !== 'all') indexArgs.push('--mode', mode);
    if (incremental) indexArgs.push('--incremental');
    if (stubEmbeddings) indexArgs.push('--stub-embeddings');
    runNode(repoPath, indexArgs);
  }

  if (shouldUseSqlite) {
    const sqliteArgs = [path.join(ROOT, 'tools', 'build-sqlite-index.js')];
    if (incremental) sqliteArgs.push('--incremental');
    runNode(repoPath, sqliteArgs);
  }

  return {
    repoPath,
    mode,
    sqlite: shouldUseSqlite,
    incremental,
    restoredArtifacts
  };
}

function runSearch(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const query = String(args.query || '').trim();
  if (!query) throw new Error('Query is required.');
  const mode = args.mode || 'both';
  const backend = args.backend || null;
  const ann = typeof args.ann === 'boolean' ? args.ann : null;
  const top = Number.isFinite(Number(args.top)) ? Math.max(1, Number(args.top)) : null;
  const context = Number.isFinite(Number(args.context)) ? Math.max(0, Number(args.context)) : null;

  const searchArgs = [path.join(ROOT, 'search.js'), query, '--json'];
  if (mode && mode !== 'both') searchArgs.push('--mode', mode);
  if (backend) searchArgs.push('--backend', backend);
  if (ann === true) searchArgs.push('--ann');
  if (ann === false) searchArgs.push('--no-ann');
  if (top) searchArgs.push('-n', String(top));
  if (context !== null) searchArgs.push('--context', String(context));

  const stdout = runNode(repoPath, searchArgs);
  return JSON.parse(stdout || '{}');
}

function downloadModels(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const userConfig = loadUserConfig(repoPath);
  const modelConfig = getModelConfig(repoPath, userConfig);
  const model = args.model || modelConfig.id || DEFAULT_MODEL_ID;
  const scriptArgs = [path.join(ROOT, 'tools', 'download-models.js'), '--model', model];
  if (args.cacheDir) scriptArgs.push('--cache-dir', args.cacheDir);
  const stdout = runNode(repoPath, scriptArgs);
  return { model, output: stdout.trim() };
}

function reportArtifacts(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const stdout = runNode(repoPath, [path.join(ROOT, 'tools', 'report-artifacts.js'), '--json']);
  return JSON.parse(stdout || '{}');
}

async function handleToolCall(name, args) {
  switch (name) {
    case 'index_status':
      return await indexStatus(args);
    case 'build_index':
      return buildIndex(args);
    case 'search':
      return runSearch(args);
    case 'download_models':
      return downloadModels(args);
    case 'report_artifacts':
      return reportArtifacts(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

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
      const result = await handleToolCall(name, args);
      sendResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      });
    } catch (error) {
      sendResult(id, {
        content: [{ type: 'text', text: error.message }],
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

function enqueueMessage(message) {
  queue.push(message);
  processQueue();
}

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
