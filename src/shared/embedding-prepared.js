import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { normalizeEmbeddingGemma2Output } from './embedding-model-profile.js';
import { createRunQueue } from './onnx-embeddings/run-queue.js';
import { observeEmbeddingOwnership, preserveEmbeddingCleanupFailure } from './embedding-cache-lifetime.js';
import { createTransformersResourceScope, trackPendingTransformersOwner, transformersCleanupFailure, bindTransformersResourceProducer } from './embedding-transformers-resources.js';
import { snapshotEmbeddingMetadata } from './embedding-selection-snapshot.js';

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
const encoderOwners = new WeakMap();
export const getPreparedTextEncoderOwner = encoder => encoder && (typeof encoder === 'function' || typeof encoder === 'object')
  ? encoderOwners.get(encoder) || null : null;

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

const invalidTokens = message => Object.assign(new Error(message), { code: 'ERR_EMBEDDING_PREPARED_INPUT' });
const assertTextInputs = texts => {
  if (!Array.isArray(texts) || texts.length > 1024 || texts.some(text => typeof text !== 'string')) {
    throw new Error('Prepared embedding inputs require at most 1024 strings.');
  }
  if (texts.reduce((sum, text) => sum + text.length, 0) > 4 * 1024 * 1024) {
    throw new Error('Prepared embedding text exceeds the bounded preparation budget.');
  }
};
const admitFields = encoded => {
  if (!encoded || typeof encoded !== 'object' || Array.isArray(encoded)) throw invalidTokens('Tokenizer omitted prepared input fields.');
  const fields = Object.keys(encoded);
  if (!fields.includes('input_ids') || !fields.includes('attention_mask') || fields.length > 16) throw invalidTokens('Tokenizer omitted required prepared inputs or exceeded the field bound.');
  return fields;
};
const admitPreparedRows = (encoded, count, maxLength) => {
  const fields = admitFields(encoded);
  for (const field of fields) {
    if (!Array.isArray(encoded[field]) || encoded[field].length !== count) throw invalidTokens('Tokenizer row cardinality differs from its requested text batch.');
  }
  // Validate the entire native response before publishing any opaque row item
  // or converting an integer into the narrower BigInt64 representation.
  for (let index = 0; index < count; index++) {
    const length = encoded.input_ids[index]?.length;
    if (!Number.isSafeInteger(length) || length < 1 || length > maxLength) throw invalidTokens('Invalid prepared token length.');
    for (const field of fields) {
      const values = encoded[field][index];
      if (!Array.isArray(values) || values.length !== length || values.some(value => !Number.isSafeInteger(value)
        || value < 0 || field === 'attention_mask' && value !== 0 && value !== 1)) throw invalidTokens('Invalid prepared token value or field width.');
    }
    if (!encoded.attention_mask[index].some(value => value === 1)) throw invalidTokens('Prepared attention row has no admitted tokens.');
  }
  return fields;
};
const admitPaddedInputs = (encoded, count, maxLength) => {
  const fields = admitFields(encoded), width = encoded.input_ids?.dims?.[1];
  if (!Number.isSafeInteger(width) || width < 1 || width > maxLength) throw invalidTokens('Invalid padded token width.');
  for (const field of fields) {
    const tensor = encoded[field], shape = tensor?.dims, data = tensor?.data;
    if (tensor?.type !== 'int64' || !Array.isArray(shape) || shape.length !== 2 || shape[0] !== count || shape[1] !== width
      || !(data instanceof BigInt64Array) || data.length !== count * width) throw invalidTokens('Tokenizer tensor cardinality, type or width differs from its requested text batch.');
    for (const value of data) if (value < 0n || field === 'attention_mask' && value !== 0n && value !== 1n) throw invalidTokens('Tokenizer tensor contains an invalid token or mask value.');
    if (field === 'attention_mask') for (let row = 0; row < count; row++) {
      if (!data.subarray(row * width, (row + 1) * width).some(value => value === 1n)) throw invalidTokens('Padded attention row has no admitted tokens.');
    }
  }
};

/** Keep prepared IDs private, bound each admission, and pad without tokenizing twice. */
export const createPreparedTextEncoder = ({ tokenizer, model, Tensor, profile, sessionOptions, modelFileName = null, resourceOwner = null }) => {
  profile = snapshotEmbeddingMetadata(profile);
  sessionOptions = normalizeEg2SessionOptions(sessionOptions);
  const components = resourceOwner || createTransformersResourceScope('prepared encoder model components');
  if (resourceOwner) {
    if (!components.pending || !components.owns(tokenizer) || !components.owns(model)) throw new Error('Prepared encoder components belong to another resource owner or are already closed.');
  } else { components.adopt(tokenizer, 'prepared encoder tokenizer'); components.adopt(model, 'prepared encoder text model'); }
  const preparedRows = new WeakMap();
  const metrics = { preparationCalls: 0, inferenceCalls: 0, preparationMs: 0, assemblyMs: 0, inferenceMs: 0, outputMs: 0 };
  let lastBatch = null;
  let profilingEnded = false;
  let disposed = false;
  let active = false;
  const admission = createRunQueue({ maxQueued: 64 });
  const tensorScopes = new Set(), profilingOperations = new Set(), workFailures = new Map();
  let disposing = null, disposeRequested = false, queueDrained = false, stopped = false, lastWorkFailure = null;
  const retainWorkFailure = error => {
    const observe = observeEmbeddingOwnership(error);
    if (observe && !workFailures.has(error)) workFailures.set(error, observe);
    if (observe && !observe()) { stopped = true; lastWorkFailure = error; trackPendingTransformersOwner(encoderOwner); }
  };
  const captureValues = (scope, record) => {
    if (!record || typeof record !== 'object') return;
    if (typeof Tensor === 'function' && record instanceof Tensor) { scope.adopt(record, 'prepared encoder tensor'); return; }
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (!value || (typeof value !== 'object' && typeof value !== 'function') || Array.isArray(value) || ArrayBuffer.isView(value)) continue;
      scope.adopt(value, 'prepared encoder tensor');
    }
  };
  const withTensorScope = async work => {
    assertAvailable();
    const scope = createTransformersResourceScope('prepared encoder operation tensors', { drainFailuresBeforeResources: true });
    tensorScopes.add(scope);
    let value, primaryError, hasPrimary = false, cleanupError, cleanupFailed = false;
    try { value = await work(scope); }
    catch (error) { hasPrimary = true; primaryError = error; scope.retainFailure(error); retainWorkFailure(error); }
    try { await scope.close(); }
    catch (error) { cleanupFailed = true; cleanupError = error; retainWorkFailure(error); }
    if (!scope.pending) tensorScopes.delete(scope);
    if (cleanupFailed) throw hasPrimary ? preserveEmbeddingCleanupFailure(primaryError, cleanupError) : cleanupError;
    if (hasPrimary) throw primaryError;
    return value;
  };
  const assertAvailable = () => {
    if (disposed) throw new Error('EG2 session has been explicitly disposed.');
    if (stopped) throw lastWorkFailure;
  };
  const prepare = async (texts) => withTensorScope(async scope => {
    assertAvailable();
    assertTextInputs(texts);
    if (!texts.length) return [];
    const started = performance.now();
    const encoded = await tokenizer(texts, {
      padding: false, truncation: true, max_length: profile.maxLength, return_tensor: false
    });
    captureValues(scope, encoded);
    const fields = admitPreparedRows(encoded, texts.length, profile.maxLength);
    const rows = texts.map((_, index) => {
      const length = encoded.input_ids[index]?.length;
      const row = {};
      for (const field of fields) {
        const values = encoded[field][index];
        row[field] = BigInt64Array.from(values, BigInt);
      }
      const item = Object.freeze({ tokenLength: length });
      preparedRows.set(item, row);
      return item;
    });
    metrics.preparationCalls += 1;
    metrics.preparationMs += performance.now() - started;
    return rows;
  });
  const run = async (inputs, count, batch, scope) => {
    assertAvailable();
    if (active) throw new Error('EG2 adapter allows only one inference in flight.');
    if (profilingEnded && sessionOptions.enableProfiling) throw new Error('Profiled EG2 session has ended; use a new session.');
    active = true;
    const started = performance.now();
    try {
      const output = await model(inputs);
      captureValues(scope, output);
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
  const embedPrepared = async (items) => withTensorScope(async scope => {
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
    const padTokenId = tokenizer.pad_token_id ?? 0;
    if (typeof padTokenId !== 'number' || !Number.isSafeInteger(padTokenId) || padTokenId < 0) throw invalidTokens('Invalid prepared pad token integer.');
    for (const field of fields) {
      const data = new BigInt64Array(items.length * longest);
      if (field === 'input_ids') data.fill(BigInt(padTokenId));
      rows.forEach((row, index) => {
        if (Object.keys(row).length !== fields.length || !row[field]) throw new Error('Prepared input fields differ.');
        const offset = index * longest + (side === 'left' ? longest - items[index].tokenLength : 0);
        data.set(row[field], offset);
      });
      inputs[field] = scope.adopt(new Tensor('int64', data, [items.length, longest]), 'prepared encoder input tensor');
    }
    const assemblyMs = performance.now() - started;
    metrics.assemblyMs += assemblyMs;
    return run(inputs, items.length, {
      count: items.length, usefulTokens: items.reduce((sum, item) => sum + item.tokenLength, 0),
      paddedTokens: items.length * longest, attentionWork: items.length * longest * longest,
      longestInput: longest, assemblyMs
    }, scope);
  });
  const embed = async (texts) => withTensorScope(async scope => {
    assertAvailable();
    assertTextInputs(texts);
    if (!texts.length) return [];
    const started = performance.now();
    const inputs = await tokenizer(texts, { padding: true, truncation: true, max_length: profile.maxLength });
    captureValues(scope, inputs);
    admitPaddedInputs(inputs, texts.length, profile.maxLength);
    metrics.preparationCalls += 1;
    metrics.preparationMs += performance.now() - started;
    return run(inputs, texts.length, { count: texts.length, prepared: false }, scope);
  });
  const admit = (work, options) => {
    try { assertAvailable(); } catch (error) { return Promise.reject(error); }
    return admission(work, options);
  };
  const admittedEmbed = (texts, options = {}) => {
    const selected = Array.isArray(texts) ? texts.slice() : texts;
    return admit(() => embed(selected), { ...options });
  };
  admittedEmbed.prepare = (texts, options = {}) => {
    const selected = Array.isArray(texts) ? texts.slice() : texts;
    return admit(() => prepare(selected), { ...options });
  };
  admittedEmbed.embedPrepared = (items, options = {}) => {
    const selected = Array.isArray(items) ? items.slice() : items;
    return admit(() => embedPrepared(selected), { ...options });
  };
  admittedEmbed.executionInfo = () => ({
    device: 'cpu', executionProviders: ['cpu'], modelFileName, requestedSessionOptions: structuredClone(sessionOptions),
    effectiveNativeThreads: null, effectiveGraphExecutionMode: null,
    sessions: Object.keys(model.sessions ?? {}), maxLength: profile.maxLength, maxConcurrentInference: 1,
    profilingEnabled: sessionOptions.enableProfiling === true, profilingEnded, disposed,
    optimizedModelFilePath: sessionOptions.optimizedModelFilePath ?? null,
    metrics: { ...metrics }, lastBatch: lastBatch ? { ...lastBatch } : null
  });
  const endProfiling = async () => {
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
          const observe = observeEmbeddingOwnership(error);
          if (observe && !observe()) { retainWorkFailure(error); throw error; }
          results.push({ name, status: 'error', message: error.message });
        }
      }
    }
    return { enabled: true, profileFilePrefix: sessionOptions.profileFilePrefix ?? null, sessions: results };
  };
  admittedEmbed.endProfiling = (...args) => {
    const work = endProfiling(...args); profilingOperations.add(work);
    work.then(() => profilingOperations.delete(work), error => { profilingOperations.delete(work); retainWorkFailure(error); });
    return work;
  };
  admittedEmbed.dispose = () => {
    if (!disposing) {
      const retry = disposeRequested; disposeRequested = true; disposed = true; stopped = true;
      disposing = (async () => {
        await admission.close();
        await Promise.allSettled([...profilingOperations]); queueDrained = true;
        const errors = [];
        for (const scope of tensorScopes) {
          try { await scope.close({ retry }); } catch (error) { errors.push(error); }
          if (!scope.pending) tensorScopes.delete(scope);
        }
        for (const [error, observe] of workFailures) if (!observe()) errors.push(error);
        if (errors.length) throw transformersCleanupFailure(encoderOwner, errors);
        try { await components.close({ retry }); }
        catch (error) { throw transformersCleanupFailure(encoderOwner, [error]); }
        trackPendingTransformersOwner(encoderOwner);
        return true;
      })().catch(error => { disposing = null; trackPendingTransformersOwner(encoderOwner); throw error; });
    }
    return disposing;
  };
  const encoderOwner = Object.freeze({ kind: 'prepared embedding encoder',
    get pending() { return !disposeRequested || !queueDrained || tensorScopes.size > 0 || components.pending
      || [...workFailures.values()].some(observe => !observe()); },
    get components() { return components; }, get pendingTensorScopes() { return Object.freeze([...tensorScopes]); },
    release: () => admittedEmbed.dispose() });
  admittedEmbed.transformersResourceOwner = encoderOwner;
  encoderOwners.set(admittedEmbed, encoderOwner);
  bindTransformersResourceProducer(admittedEmbed, encoderOwner);
  return admittedEmbed;
};
