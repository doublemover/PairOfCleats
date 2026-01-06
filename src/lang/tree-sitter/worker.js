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
    byLanguage: config.byLanguage || {},
    configChunking: config.configChunking === true
  };
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
    treeSitterState.treeSitterWorkerPool = new Piscina({
      filename: fileURLToPath(new URL('../workers/tree-sitter-worker.js', import.meta.url)),
      maxThreads: config.maxWorkers,
      idleTimeout: config.idleTimeoutMs,
      taskTimeout: config.taskTimeoutMs
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
