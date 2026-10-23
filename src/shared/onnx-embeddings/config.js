import fs from 'node:fs';
import { resolveInstalledOnnxPath } from '../onnx-installation.js';
import path from 'node:path';
import { isAbsolutePathNative } from '../file-paths.js';

const GRAPH_LEVELS = new Set(['disabled', 'basic', 'extended', 'all']);
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled']);
export const ONNX_TOKENIZATION_CACHE_DEFAULT_MAX_ENTRIES = 256;
const ONNX_TOKENIZATION_CACHE_MAX_ENTRIES_CAP = 4096;
export const DEFAULT_PREWARM_TEXTS = Object.freeze(['pairofcleats prewarm']);
const PREWARM_TOKENIZER_ENV = 'PAIROFCLEATS_ONNX_PREWARM_TOKENIZER';
const PREWARM_MODEL_ENV = 'PAIROFCLEATS_ONNX_PREWARM_MODEL';
const PREWARM_TEXTS_ENV = 'PAIROFCLEATS_ONNX_PREWARM_TEXTS';
const TOKENIZATION_CACHE_ENABLED_ENV = 'PAIROFCLEATS_ONNX_TOKENIZATION_CACHE';
const TOKENIZATION_CACHE_MAX_ENV = 'PAIROFCLEATS_ONNX_TOKENIZATION_CACHE_MAX';
const CPU_EP_TUNING_ENV = 'PAIROFCLEATS_ONNX_CPU_EP_TUNING';
const PROVIDER_ALIASES = new Map([
  ['onnx', 'onnx'],
  ['onnxruntime', 'onnx'],
  ['onnxruntime-node', 'onnx'],
  ['xenova', 'xenova'],
  ['transformers', 'xenova']
]);

const normalizeProvider = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return PROVIDER_ALIASES.get(trimmed) || null;
};

const normalizeProviders = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return null;
};

const normalizeThread = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const normalizeBoundedInt = (value, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return null;
  return Math.min(max, Math.floor(parsed));
};

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
};

const resolveBooleanOption = (configValue, fallback) => {
  const normalizedConfigValue = normalizeBoolean(configValue);
  if (normalizedConfigValue != null) return normalizedConfigValue;
  return fallback;
};

const resolveBoundedIntOption = (configValue, fallback, bounds) => {
  const normalizedConfigValue = normalizeBoundedInt(configValue, bounds);
  if (normalizedConfigValue != null) return normalizedConfigValue;
  return fallback;
};

const normalizeGraphLevel = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return GRAPH_LEVELS.has(normalized) ? normalized : null;
};

const normalizeTextRows = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  return value.split(/[\r\n,]+/);
};

const normalizePrewarmTexts = (value) => {
  const rows = normalizeTextRows(value);
  if (!rows) return null;
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const text = typeof row === 'string' ? row.trim() : '';
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out.length ? out : null;
};

export const LARGE_MODEL_BYTES = Math.floor(1.5 * 1024 * 1024 * 1024);

export const statSize = (filePath) => {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
};

export function normalizeOnnxConfig(raw = {}) {
  const config = raw && typeof raw === 'object' ? raw : {};
  if (config.modelPath != null && (typeof config.modelPath !== 'string'
    || config.modelPath.length > 0 && !config.modelPath.trim())) {
    throw Object.assign(new Error('Explicit ONNX modelPath must name a nonempty selected file or directory.'), { code: 'ERR_EMBEDDING_MODEL_PATH' });
  }
  const executionProviders = normalizeProviders(config.executionProviders);
  const prewarmTokenizer = resolveBooleanOption(config.prewarmTokenizer, false);
  const prewarmModel = resolveBooleanOption(config.prewarmModel, false);
  const configPrewarmTexts = normalizePrewarmTexts(config.prewarmTexts ?? config.prewarmText);
  const prewarmTexts = configPrewarmTexts || null;
  return {
    modelPath: typeof config.modelPath === 'string' ? config.modelPath.trim() : '',
    tokenizerId: typeof config.tokenizerId === 'string' ? config.tokenizerId.trim() : '',
    executionProviders: executionProviders && executionProviders.length ? executionProviders : null,
    intraOpNumThreads: normalizeThread(config.intraOpNumThreads),
    interOpNumThreads: normalizeThread(config.interOpNumThreads),
    graphOptimizationLevel: normalizeGraphLevel(config.graphOptimizationLevel),
    cpuExecutionProviderTuning: resolveBooleanOption(config.cpuExecutionProviderTuning, true),
    tokenizationCacheEnabled: resolveBooleanOption(config.tokenizationCacheEnabled, true),
    tokenizationCacheMaxEntries: resolveBoundedIntOption(
      config.tokenizationCacheMaxEntries,
      ONNX_TOKENIZATION_CACHE_DEFAULT_MAX_ENTRIES,
      { min: 1, max: ONNX_TOKENIZATION_CACHE_MAX_ENTRIES_CAP }
    ),
    prewarmTokenizer,
    prewarmModel,
    prewarmTexts
  };
}

/** Resolve environment precedence once at a configuration boundary. */
export function resolveOnnxConfig(raw = {}, rawEnv = process.env) {
  const config = raw && typeof raw === 'object' ? raw : {};
  const env = rawEnv && typeof rawEnv === 'object' ? rawEnv : {};
  return normalizeOnnxConfig({
    ...config,
    cpuExecutionProviderTuning: normalizeBoolean(env[CPU_EP_TUNING_ENV]) ?? config.cpuExecutionProviderTuning,
    tokenizationCacheEnabled: normalizeBoolean(env[TOKENIZATION_CACHE_ENABLED_ENV]) ?? config.tokenizationCacheEnabled,
    tokenizationCacheMaxEntries: normalizeBoundedInt(env[TOKENIZATION_CACHE_MAX_ENV], {
      min: 1, max: ONNX_TOKENIZATION_CACHE_MAX_ENTRIES_CAP
    }) ?? config.tokenizationCacheMaxEntries,
    prewarmTokenizer: normalizeBoolean(env[PREWARM_TOKENIZER_ENV]) ?? config.prewarmTokenizer,
    prewarmModel: normalizeBoolean(env[PREWARM_MODEL_ENV]) ?? config.prewarmModel,
    prewarmTexts: normalizePrewarmTexts(env[PREWARM_TEXTS_ENV]) ?? config.prewarmTexts ?? config.prewarmText
  });
}

export function normalizeEmbeddingProvider(raw, { strict = false } = {}) {
  if (raw === undefined || raw === null || raw === '') return 'xenova';
  const normalized = normalizeProvider(raw);
  if (normalized) return normalized;
  if (strict) {
    const candidates = Array.from(new Set(PROVIDER_ALIASES.values())).sort().join(', ');
    throw new Error(`[embeddings] Unknown provider "${raw}". Expected one of: ${candidates}.`);
  }
  return 'xenova';
}

export function resolveOnnxModelPath({ rootDir, modelPath, modelsDir, modelId }) {
  const root = rootDir ? path.resolve(rootDir) : process.cwd();
  if (modelPath != null && (typeof modelPath !== 'string' || modelPath.length > 0 && !modelPath.trim())) {
    throw Object.assign(new Error('Explicit ONNX modelPath is not a usable selected path.'), { code: 'ERR_EMBEDDING_MODEL_PATH' });
  }
  const trimmed = typeof modelPath === 'string' ? modelPath.trim() : '';
  const readableFile = (candidate) => {
    const stat = fs.statSync(candidate);
    if (!stat.isFile() || stat.size === 0) throw new Error('Expected a nonempty regular ONNX file.');
    fs.accessSync(candidate, fs.constants.R_OK);
    return candidate;
  };
  const tryPath = (candidate, authoritative = false) => {
    if (!candidate) return null;
    try {
      const installed = resolveInstalledOnnxPath(candidate);
      if (installed) return readableFile(installed);
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) {
        if (/\.onnx$/iu.test(path.basename(candidate))) throw new Error('The selected ONNX graph is a directory, not a regular file.');
        const nested = [
          path.join(candidate, 'model.onnx'),
          path.join(candidate, 'model_quantized.onnx'),
          path.join(candidate, 'onnx', 'model.onnx'),
          path.join(candidate, 'onnx', 'model_quantized.onnx')
        ];
        for (const entry of nested) {
          try { return readableFile(entry); } catch { /* Continue selected directory candidates. */ }
        }
        throw new Error('The selected directory has no readable nonempty ONNX graph.');
      }
      return readableFile(candidate);
    } catch (cause) {
      if (authoritative) {
        throw Object.assign(new Error(`Selected ONNX model path "${candidate}" is unavailable or unusable. Download/verify that graph or correct indexing.embeddings.onnx.modelPath.`, { cause }), {
          code: 'ERR_EMBEDDING_MODEL_PATH', modelPath: candidate
        });
      }
      return null;
    }
  };
  if (trimmed) {
    const resolved = isAbsolutePathNative(trimmed) ? trimmed : path.join(root, trimmed);
    return tryPath(resolved, true);
  }
  const modelRoot = modelId && modelsDir ? path.join(modelsDir, modelId) : null;
  const candidates = [
    modelRoot ? path.join(modelRoot, 'onnx', 'model.onnx') : null,
    modelRoot ? path.join(modelRoot, 'onnx', 'model_quantized.onnx') : null,
    modelRoot ? path.join(modelRoot, 'model.onnx') : null,
    modelRoot ? path.join(modelRoot, 'model_quantized.onnx') : null
  ];
  for (const candidate of candidates) {
    const resolved = tryPath(candidate);
    if (resolved) return resolved;
  }
  return null;
}

export const resolvePrewarmList = (texts, fallbackTexts = null) => {
  const override = normalizePrewarmTexts(texts);
  if (override && override.length) return override;
  if (Array.isArray(fallbackTexts) && fallbackTexts.length) return fallbackTexts.slice();
  return DEFAULT_PREWARM_TEXTS.slice();
};
