import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { treeSitterState } from './state.js';

const normalizeTreeSitterWorkerConfig = (raw) => {
  if (raw === false) return { enabled: false };
  if (raw === true) return { enabled: true };
  if (!raw || typeof raw !== 'object') return { enabled: false };
  const enabled = raw.enabled !== false;
  const maxWorkersRaw = Number(raw.maxWorkers);
  const defaultMax = Math.max(1, Math.min(4, os.cpus().length));
  const maxWorkers = Number.isFinite(maxWorkersRaw) && maxWorkersRaw > 0
    ? Math.max(1, Math.floor(maxWorkersRaw))
    : defaultMax;
  const idleTimeoutMsRaw = Number(raw.idleTimeoutMs);
  const idleTimeoutMs = Number.isFinite(idleTimeoutMsRaw) && idleTimeoutMsRaw > 0
    ? Math.floor(idleTimeoutMsRaw)
    : 30000;
  const taskTimeoutMsRaw = Number(raw.taskTimeoutMs);
  const taskTimeoutMs = Number.isFinite(taskTimeoutMsRaw) && taskTimeoutMsRaw > 0
    ? Math.floor(taskTimeoutMsRaw)
    : 60000;
  return {
    enabled,
    maxWorkers,
    idleTimeoutMs,
    taskTimeoutMs
  };
};

export const sanitizeTreeSitterOptions = (treeSitter) => {
  const config = treeSitter && typeof treeSitter === 'object' ? treeSitter : {};
  return {
    enabled: config.enabled !== false,
    languages: config.languages || {},
    maxBytes: config.maxBytes ?? null,
    maxLines: config.maxLines ?? null,
    maxParseMs: config.maxParseMs ?? null,
    maxLoadedLanguages: config.maxLoadedLanguages ?? null,
    maxAstNodes: config.maxAstNodes ?? null,
    maxAstStack: config.maxAstStack ?? null,
    maxChunkNodes: config.maxChunkNodes ?? null,
    byLanguage: config.byLanguage || {},
    configChunking: config.configChunking === true
  };
};

const buildWorkerExecArgv = () => process.execArgv.filter((arg) => (
  typeof arg === 'string'
  && !arg.startsWith('--max-old-space-size')
  && !arg.startsWith('--max-semi-space-size')
));

const parseMaxOldSpaceSizeMb = (argv) => {
  if (!Array.isArray(argv)) return null;
  for (let i = argv.length - 1; i >= 0; i -= 1) {
    const arg = argv[i];
    if (typeof arg !== 'string') continue;
    if (arg === '--max-old-space-size' && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) return Math.floor(value);
    }
    if (arg.startsWith('--max-old-space-size=')) {
      const value = Number(arg.split('=', 2)[1]);
      if (Number.isFinite(value) && value > 0) return Math.floor(value);
    }
  }
  return null;
};

const resolveWorkerResourceLimits = (maxWorkers) => {
  const workerCount = Math.max(1, Math.floor(Number(maxWorkers) || 0));
  if (!Number.isFinite(workerCount) || workerCount <= 0) return null;

  const totalMemMb = Math.floor(os.totalmem() / 1024 / 1024);
  // process.execArgv does NOT include NODE_OPTIONS.
  const execArgv = Array.isArray(process.execArgv) ? process.execArgv : [];
  const nodeOptionsRaw = typeof process.env.NODE_OPTIONS === 'string'
    ? process.env.NODE_OPTIONS
    : '';
  const nodeOptionsArgv = nodeOptionsRaw
    ? nodeOptionsRaw.split(/\s+/).filter(Boolean)
    : [];
  const maxOldMb = parseMaxOldSpaceSizeMb([...execArgv, ...nodeOptionsArgv]);

  // Tree-sitter workers can load multiple WASM grammars. When indexing a repo
  // that spans many languages, overly small heaps can crash workers with V8
  // "Zone" OOMs even when overall RSS remains low.
  let budgetMb = null;
  if (Number.isFinite(maxOldMb) && maxOldMb > 0) {
    budgetMb = Math.floor(maxOldMb);
  } else if (Number.isFinite(totalMemMb) && totalMemMb > 0) {
    budgetMb = Math.floor(totalMemMb * 0.5);
  }
  if (!Number.isFinite(budgetMb) || budgetMb <= 0) return null;

  if (Number.isFinite(totalMemMb) && totalMemMb > 0) {
    const hardCap = Math.max(512, Math.floor(totalMemMb * 0.85));
    budgetMb = Math.min(budgetMb, hardCap);
  }

  const perWorkerMb = Math.floor(budgetMb / (workerCount + 1));
  const minMb = 128;
  const platformCap = process.platform === 'win32' ? 4096 : 8192;
  const oldGenMb = Math.max(minMb, Math.min(platformCap, perWorkerMb));
  return { maxOldGenerationSizeMb: oldGenMb };
};

export const getTreeSitterWorkerPool = async (rawConfig, options = {}) => {
  const config = normalizeTreeSitterWorkerConfig(rawConfig);
  if (!config.enabled) return null;
  const signature = JSON.stringify(config);
  if (treeSitterState.treeSitterWorkerPool && treeSitterState.treeSitterWorkerConfigSignature === signature) {
    return treeSitterState.treeSitterWorkerPool;
  }
  if (treeSitterState.treeSitterWorkerPool && treeSitterState.treeSitterWorkerPool.destroy) {
    await treeSitterState.treeSitterWorkerPool.destroy();
    treeSitterState.treeSitterWorkerPool = null;
  }
  treeSitterState.treeSitterWorkerConfigSignature = signature;
  let Piscina;
  try {
    Piscina = (await import('piscina')).default;
  } catch (err) {
    if (options?.log && !treeSitterState.loggedWorkerFailures.has('piscina')) {
      options.log(`[tree-sitter] Worker pool unavailable (piscina missing): ${err?.message || err}.`);
      treeSitterState.loggedWorkerFailures.add('piscina');
    }
    return null;
  }
  try {
    const execArgv = buildWorkerExecArgv();
    const resourceLimits = resolveWorkerResourceLimits(config.maxWorkers);
    treeSitterState.treeSitterWorkerPool = new Piscina({
      filename: fileURLToPath(new URL('../workers/tree-sitter-worker.js', import.meta.url)),
      maxThreads: config.maxWorkers,
      idleTimeout: config.idleTimeoutMs,
      taskTimeout: config.taskTimeoutMs,
      ...(execArgv.length ? { execArgv } : {}),
      ...(resourceLimits ? { resourceLimits } : {})
    });
    return treeSitterState.treeSitterWorkerPool;
  } catch (err) {
    if (options?.log && !treeSitterState.loggedWorkerFailures.has('init')) {
      options.log(`[tree-sitter] Worker pool init failed: ${err?.message || err}.`);
      treeSitterState.loggedWorkerFailures.add('init');
    }
    treeSitterState.treeSitterWorkerPool = null;
    return null;
  }
};
