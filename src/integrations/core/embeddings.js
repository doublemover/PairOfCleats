import { spawnSubprocess } from '../../shared/subprocess.js';

const EMBEDDINGS_CANCEL_CODE = 0xC000013A;

const createLineEmitter = (onLine) => {
  let buffer = '';
  const emitLine = (line) => {
    const trimmed = line.trimEnd();
    if (trimmed) onLine(trimmed);
  };
  const handleChunk = (chunk) => {
    buffer += chunk;
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() || '';
    for (const line of parts) emitLine(line);
  };
  const flush = () => {
    if (buffer) emitLine(buffer);
    buffer = '';
  };
  return { handleChunk, flush };
};

export const resolveEmbeddingRuntime = ({ argv, userConfig, policy }) => {
  const embeddingsConfig = userConfig?.indexing?.embeddings || {};
  const embeddingModeRaw = typeof embeddingsConfig.mode === 'string'
    ? embeddingsConfig.mode.trim().toLowerCase()
    : 'auto';
  const baseStubEmbeddings = argv['stub-embeddings'] === true;
  const normalizedEmbeddingMode = ['auto', 'inline', 'service', 'stub', 'off'].includes(embeddingModeRaw)
    ? embeddingModeRaw
    : 'auto';
  const resolvedEmbeddingMode = normalizedEmbeddingMode === 'auto'
    ? (baseStubEmbeddings ? 'stub' : 'inline')
    : normalizedEmbeddingMode;
  const policyEmbeddings = policy?.indexing?.embeddings?.enabled;
  const configEnabled = embeddingsConfig.enabled !== false;
  const embeddingEnabled = (policyEmbeddings ?? configEnabled)
    && resolvedEmbeddingMode !== 'off';
  const embeddingService = embeddingEnabled
    && resolvedEmbeddingMode === 'service';
  const queueDir = typeof embeddingsConfig.queue?.dir === 'string'
    ? embeddingsConfig.queue.dir.trim()
    : '';
  const queueMaxRaw = Number(embeddingsConfig.queue?.maxQueued);
  const queueMaxQueued = Number.isFinite(queueMaxRaw)
    ? Math.max(0, Math.floor(queueMaxRaw))
    : null;
  return {
    embeddingEnabled,
    embeddingService,
    useStubEmbeddings: resolvedEmbeddingMode === 'stub' || baseStubEmbeddings,
    resolvedEmbeddingMode,
    queueDir,
    queueMaxQueued
  };
};

export const runEmbeddingsTool = async (args, options = {}) => {
  const onLine = typeof options.onLine === 'function' ? options.onLine : null;
  const emitter = onLine ? createLineEmitter(onLine) : null;
  const baseEnv = options.baseEnv && typeof options.baseEnv === 'object'
    ? options.baseEnv
    : process.env;
  const extraEnv = options.extraEnv && typeof options.extraEnv === 'object'
    ? options.extraEnv
    : null;
  const env = extraEnv ? { ...baseEnv, ...extraEnv } : baseEnv;
  const result = await spawnSubprocess(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    signal: options.signal || null,
    rejectOnNonZeroExit: false,
    onStdout: emitter ? emitter.handleChunk : null,
    onStderr: emitter ? emitter.handleChunk : null
  });
  emitter?.flush();
  if (result.exitCode === 0) {
    return { ok: true };
  }
  if (result.signal || result.exitCode === EMBEDDINGS_CANCEL_CODE) {
    return { cancelled: true, code: result.exitCode ?? null, signal: result.signal || null };
  }
  throw new Error(`build-embeddings exited with code ${result.exitCode ?? 'unknown'}`);
};
