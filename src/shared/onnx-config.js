import fs from 'node:fs';
import path from 'node:path';
import { isAbsolutePathNative } from './file-paths.js';

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

const resolveBooleanOption = (configValue, envName, fallback) => {
  const envValue = normalizeBoolean(process?.env?.[envName]);
  if (envValue != null) return envValue;
  const normalizedConfigValue = normalizeBoolean(configValue);
  if (normalizedConfigValue != null) return normalizedConfigValue;
  return fallback;
};

const resolveBoundedIntOption = (configValue, envName, fallback, bounds) => {
  const envValue = normalizeBoundedInt(process?.env?.[envName], bounds);
  if (envValue != null) return envValue;
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
  const executionProviders = normalizeProviders(config.executionProviders);
  const prewarmTokenizer = resolveBooleanOption(config.prewarmTokenizer, PREWARM_TOKENIZER_ENV, false);
  const prewarmModel = resolveBooleanOption(config.prewarmModel, PREWARM_MODEL_ENV, false);
  const envPrewarmTexts = normalizePrewarmTexts(process?.env?.[PREWARM_TEXTS_ENV]);
  const configPrewarmTexts = normalizePrewarmTexts(config.prewarmTexts ?? config.prewarmText);
  const prewarmTexts = envPrewarmTexts || configPrewarmTexts || null;
  return {
    modelPath: typeof config.modelPath === 'string' ? config.modelPath.trim() : '',
    tokenizerId: typeof config.tokenizerId === 'string' ? config.tokenizerId.trim() : '',
    executionProviders: executionProviders && executionProviders.length ? executionProviders : null,
    intraOpNumThreads: normalizeThread(config.intraOpNumThreads),
    interOpNumThreads: normalizeThread(config.interOpNumThreads),
    graphOptimizationLevel: normalizeGraphLevel(config.graphOptimizationLevel),
    cpuExecutionProviderTuning: resolveBooleanOption(config.cpuExecutionProviderTuning, CPU_EP_TUNING_ENV, true),
    tokenizationCacheEnabled: resolveBooleanOption(config.tokenizationCacheEnabled, TOKENIZATION_CACHE_ENABLED_ENV, true),
    tokenizationCacheMaxEntries: resolveBoundedIntOption(
      config.tokenizationCacheMaxEntries,
      TOKENIZATION_CACHE_MAX_ENV,
      ONNX_TOKENIZATION_CACHE_DEFAULT_MAX_ENTRIES,
      { min: 1, max: ONNX_TOKENIZATION_CACHE_MAX_ENTRIES_CAP }
    ),
    prewarmTokenizer,
    prewarmModel,
    prewarmTexts
  };
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
  const trimmed = typeof modelPath === 'string' ? modelPath.trim() : '';
  const tryPath = (candidate) => {
    if (!candidate || !fs.existsSync(candidate)) return null;
    try {
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) {
        const nested = [
          path.join(candidate, 'model.onnx'),
          path.join(candidate, 'model_quantized.onnx'),
          path.join(candidate, 'onnx', 'model.onnx'),
          path.join(candidate, 'onnx', 'model_quantized.onnx')
        ];
        for (const entry of nested) {
          if (fs.existsSync(entry)) return entry;
        }
        return null;
      }
    } catch {
      return null;
    }
    return candidate;
  };
  if (trimmed) {
    const resolved = isAbsolutePathNative(trimmed) ? trimmed : path.join(root, trimmed);
    const stat = tryPath(resolved);
    if (stat) return stat;
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
