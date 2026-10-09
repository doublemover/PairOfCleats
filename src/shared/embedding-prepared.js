import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { normalizeEmbeddingGemma2Output } from './embedding-model-profile.js';

const INTEGER_OPTIONS = new Set(['intraOpNumThreads', 'interOpNumThreads']);
const BOOLEAN_OPTIONS = new Set(['enableCpuMemArena', 'enableMemPattern', 'enableProfiling']);
const PATH_OPTIONS = new Set(['profileFilePrefix', 'optimizedModelFilePath']);
const ENUM_OPTIONS = {
  executionMode: ['sequential', 'parallel'],
  graphOptimizationLevel: ['disabled', 'basic', 'extended', 'all'],
  logSeverityLevel: [0, 1, 2, 3, 4]
};
const EXTRA_OPTIONS = new Set([
  'session.intra_op.allow_spinning', 'session.inter_op.allow_spinning'
]);

/** Strict CPU session knobs. Native effective pool sizes are not inferred. */
export const normalizeEg2SessionOptions = (value) => {
  if (value == null) return Object.freeze({});
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('sessionOptions must be an object.');
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (INTEGER_OPTIONS.has(key)) {
      if (!Number.isInteger(item) || item < 1 || item > 256) throw new Error('Invalid CPU session option ' + key + '.');
    } else if (BOOLEAN_OPTIONS.has(key)) {
      if (typeof item !== 'boolean') throw new Error('Invalid CPU session option ' + key + '.');
    } else if (PATH_OPTIONS.has(key)) {
      if (typeof item !== 'string' || !path.isAbsolute(item)) throw new Error(key + ' must be an absolute approved output path.');
    } else if (Object.hasOwn(ENUM_OPTIONS, key)) {
      if (!ENUM_OPTIONS[key].includes(item)) throw new Error('Invalid CPU session option ' + key + '.');
    } else if (key === 'extra') {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid CPU session extra options.');
      result.extra = {};
      for (const extraKey of Object.keys(item).sort()) {
        if (!EXTRA_OPTIONS.has(extraKey) || !['0', '1'].includes(item[extraKey])) {
          throw new Error('Unsupported CPU session extra option ' + extraKey + '.');
        }
        result.extra[extraKey] = item[extraKey];
      }
      Object.freeze(result.extra);
      continue;
    } else {
      throw new Error('Unsupported CPU session option ' + key + '.');
    }
    result[key] = item;
  }
  return Object.freeze(result);
};

/** Custom graph stem only; caller owns graph hash and numerical qualification. */
export const normalizeEg2ModelFileName = (value) => {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value)) {
    throw new Error('modelFileName must be a safe ONNX graph basename without extension.');
  }
  return value;
};

/** Keep prepared IDs private, bound each admission, and pad without tokenizing twice. */
export const createPreparedTextEncoder = ({ tokenizer, model, Tensor, profile, sessionOptions, modelFileName = null }) => {
  const preparedRows = new WeakMap();
  const metrics = { preparationCalls: 0, inferenceCalls: 0, preparationMs: 0, assemblyMs: 0, inferenceMs: 0, outputMs: 0 };
  let lastBatch = null;
  let profilingEnded = false;
  let disposed = false;
  let disposalError = null;
  let active = false;
  const assertAvailable = () => {
    if (disposed) throw new Error('EG2 session has been explicitly disposed.');
  };
  const prepare = async (texts) => {
    assertAvailable();
    if (!Array.isArray(texts) || texts.length > 1024 || texts.some((text) => typeof text !== 'string')) {
      throw new Error('Prepared embedding inputs require at most 1024 strings.');
    }
    if (!texts.length) return [];
    if (texts.reduce((sum, text) => sum + text.length, 0) > 4 * 1024 * 1024) {
      throw new Error('Prepared embedding text exceeds the bounded preparation budget.');
    }
    const started = performance.now();
    const encoded = await tokenizer(texts, {
      padding: false, truncation: true, max_length: profile.maxLength, return_tensor: false
    });
    const fields = Object.keys(encoded);
    if (!fields.includes('input_ids') || !fields.includes('attention_mask')) throw new Error('Tokenizer omitted required prepared inputs.');
    const rows = texts.map((_, index) => {
      const length = encoded.input_ids[index]?.length;
      if (!Number.isInteger(length) || length < 1 || length > profile.maxLength) throw new Error('Invalid prepared token length.');
      const row = {};
      for (const field of fields) {
        const values = encoded[field][index];
        if (!Array.isArray(values) || values.length !== length
          || values.some((value) => !Number.isSafeInteger(value))) throw new Error('Invalid prepared token input.');
        row[field] = BigInt64Array.from(values, BigInt);
      }
      const item = Object.freeze({ tokenLength: length });
      preparedRows.set(item, row);
      return item;
    });
    metrics.preparationCalls += 1;
    metrics.preparationMs += performance.now() - started;
    return rows;
  };
  const run = async (inputs, count, batch) => {
    assertAvailable();
    if (active) throw new Error('EG2 adapter allows only one inference in flight.');
    if (profilingEnded && sessionOptions.enableProfiling) throw new Error('Profiled EG2 session has ended; use a new session.');
    active = true;
    const started = performance.now();
    try {
      const output = await model(inputs);
      const inferred = performance.now();
      const vectors = normalizeEmbeddingGemma2Output(output, count, profile.dimensions);
      const ended = performance.now();
      metrics.inferenceCalls += 1;
      metrics.inferenceMs += inferred - started;
      metrics.outputMs += ended - inferred;
      lastBatch = { ...batch, inferenceMs: inferred - started, outputMs: ended - inferred };
      return vectors;
    } finally {
      active = false;
    }
  };
  const embedPrepared = async (items) => {
    assertAvailable();
    if (!Array.isArray(items) || items.length > 64) throw new Error('Prepared inference requires at most 64 items.');
    if (!items.length) return [];
    if (typeof Tensor !== 'function') throw new Error('Prepared inference requires the Transformers Tensor constructor.');
    const started = performance.now();
    const rows = items.map((item) => {
      const row = preparedRows.get(item);
      if (!row) throw new Error('Prepared input belongs to a different encoder or is invalid.');
      return row;
    });
    const longest = Math.max(...items.map((item) => item.tokenLength));
    const inputs = {};
    const fields = Object.keys(rows[0]);
    const side = tokenizer.padding_side ?? 'right';
    if (!['left', 'right'].includes(side)) throw new Error('Unsupported tokenizer padding side.');
    for (const field of fields) {
      const data = new BigInt64Array(items.length * longest);
      if (field === 'input_ids') data.fill(BigInt(tokenizer.pad_token_id ?? 0));
      rows.forEach((row, index) => {
        if (Object.keys(row).length !== fields.length || !row[field]) throw new Error('Prepared input fields differ.');
        const offset = index * longest + (side === 'left' ? longest - items[index].tokenLength : 0);
        data.set(row[field], offset);
      });
      inputs[field] = new Tensor('int64', data, [items.length, longest]);
    }
    const assemblyMs = performance.now() - started;
    metrics.assemblyMs += assemblyMs;
    return run(inputs, items.length, {
      count: items.length, usefulTokens: items.reduce((sum, item) => sum + item.tokenLength, 0),
      paddedTokens: items.length * longest, attentionWork: items.length * longest * longest,
      longestInput: longest, assemblyMs
    });
  };
  const embed = async (texts) => {
    assertAvailable();
    const started = performance.now();
    const inputs = await tokenizer(texts, { padding: true, truncation: true, max_length: profile.maxLength });
    metrics.preparationCalls += 1;
    metrics.preparationMs += performance.now() - started;
    return run(inputs, texts.length, { count: texts.length, prepared: false });
  };
  embed.prepare = prepare;
  embed.embedPrepared = embedPrepared;
  embed.executionInfo = () => ({
    device: 'cpu', executionProviders: ['cpu'], modelFileName, requestedSessionOptions: structuredClone(sessionOptions),
    effectiveNativeThreads: null, effectiveGraphExecutionMode: null,
    sessions: Object.keys(model.sessions ?? {}), maxLength: profile.maxLength, maxConcurrentInference: 1,
    profilingEnabled: sessionOptions.enableProfiling === true, profilingEnded, disposed,
    optimizedModelFilePath: sessionOptions.optimizedModelFilePath ?? null,
    metrics: { ...metrics }, lastBatch: lastBatch ? { ...lastBatch } : null
  });
  embed.endProfiling = async () => {
    assertAvailable();
    if (active) throw new Error('Cannot end profiling while inference is active.');
    if (!sessionOptions.enableProfiling) return { enabled: false, sessions: [] };
    if (profilingEnded) return { enabled: true, alreadyEnded: true, sessions: [] };
    profilingEnded = true;
    const results = [];
    for (const [name, session] of Object.entries(model.sessions ?? {})) {
      if (typeof session.endProfiling !== 'function') {
        results.push({ name, status: 'unsupported' });
      } else {
        try {
          const output = await session.endProfiling();
          results.push({ name, status: 'ended', output: output ?? null });
        } catch (error) {
          results.push({ name, status: 'error', message: error.message });
        }
      }
    }
    return { enabled: true, profileFilePrefix: sessionOptions.profileFilePrefix ?? null, sessions: results };
  };
  embed.dispose = async () => {
    if (active) throw new Error('Cannot dispose while inference is active.');
    if (disposalError) throw disposalError;
    if (disposed) return;
    disposed = true;
    try {
      await model.dispose?.();
    } catch (error) {
      disposalError = error;
      throw error;
    }
  };
  return embed;
};
