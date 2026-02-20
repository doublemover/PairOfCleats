import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_FLUSH_ROWS = 128;
const DEFAULT_FLUSH_BYTES = 256 * 1024;
const HEAVY_FILE_EVENT = 'perf.heavy_file_policy';
const HEAVY_FILE_SUMMARY_EVENT = 'perf.heavy_file_policy.summary';
const DEFAULT_HEAVY_FILE_SAMPLE_LIMIT = 12;

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const safeStringify = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

const toFiniteNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const createNoopPerfEventLogger = () => ({
  enabled: false,
  path: null,
  emit: () => {},
  flush: async () => {},
  close: async () => {}
});

const createHeavyFileAggregateState = (sampleLimit) => ({
  files: 0,
  heavyDownshiftFiles: 0,
  skipTokenizationFiles: 0,
  coalescedFiles: 0,
  fileBytes: 0,
  fileLines: 0,
  sourceChunks: 0,
  workingChunks: 0,
  outputChunks: 0,
  processingDurationMs: 0,
  maxProcessingDurationMs: 0,
  maxProcessingDurationFile: null,
  maxSourceChunks: 0,
  maxSourceChunksFile: null,
  topSlowFiles: [],
  byLanguage: new Map(),
  sampleLimit
});

const maybeInsertSlowSample = (samples, candidate, limit) => {
  if (!Number.isFinite(candidate?.processingDurationMs) || candidate.processingDurationMs <= 0) return;
  if (!Number.isFinite(limit) || limit <= 0) return;
  if (samples.length < limit) {
    samples.push(candidate);
    samples.sort((a, b) => b.processingDurationMs - a.processingDurationMs);
    return;
  }
  if (candidate.processingDurationMs <= samples[samples.length - 1].processingDurationMs) return;
  samples[samples.length - 1] = candidate;
  samples.sort((a, b) => b.processingDurationMs - a.processingDurationMs);
};

const foldHeavyFileEvent = (state, payload) => {
  if (!payload || typeof payload !== 'object') return;
  state.files += 1;
  const processingDurationMs = toFiniteNumber(payload.processingDurationMs);
  const sourceChunks = toFiniteNumber(payload.sourceChunks);
  const workingChunks = toFiniteNumber(payload.workingChunks);
  const outputChunks = toFiniteNumber(payload.outputChunks);
  const fileBytes = toFiniteNumber(payload.fileBytes);
  const fileLines = toFiniteNumber(payload.fileLines);
  if (payload.heavyDownshift === true) state.heavyDownshiftFiles += 1;
  if (payload.skipTokenization === true) state.skipTokenizationFiles += 1;
  if (payload.coalesced === true) state.coalescedFiles += 1;
  state.processingDurationMs += processingDurationMs;
  state.sourceChunks += sourceChunks;
  state.workingChunks += workingChunks;
  state.outputChunks += outputChunks;
  state.fileBytes += fileBytes;
  state.fileLines += fileLines;
  if (processingDurationMs > state.maxProcessingDurationMs) {
    state.maxProcessingDurationMs = processingDurationMs;
    state.maxProcessingDurationFile = payload.file || null;
  }
  if (sourceChunks > state.maxSourceChunks) {
    state.maxSourceChunks = sourceChunks;
    state.maxSourceChunksFile = payload.file || null;
  }
  const languageId = typeof payload.languageId === 'string' && payload.languageId.trim()
    ? payload.languageId.trim()
    : '_unknown';
  const languageBucket = state.byLanguage.get(languageId) || {
    files: 0,
    heavyDownshift: 0,
    skipTokenization: 0,
    coalesced: 0
  };
  languageBucket.files += 1;
  if (payload.heavyDownshift === true) languageBucket.heavyDownshift += 1;
  if (payload.skipTokenization === true) languageBucket.skipTokenization += 1;
  if (payload.coalesced === true) languageBucket.coalesced += 1;
  state.byLanguage.set(languageId, languageBucket);
  maybeInsertSlowSample(state.topSlowFiles, {
    file: payload.file || null,
    languageId,
    processingDurationMs,
    sourceChunks,
    workingChunks,
    outputChunks,
    fileBytes,
    fileLines
  }, state.sampleLimit);
};

const buildHeavyFileSummary = (state) => {
  if (!state || state.files <= 0) return null;
  const totalFiles = state.files || 1;
  const byLanguage = Array.from(state.byLanguage.entries())
    .sort((a, b) => b[1].files - a[1].files)
    .slice(0, 8)
    .map(([languageId, value]) => ({ languageId, ...value }));
  return {
    files: state.files,
    heavyDownshiftFiles: state.heavyDownshiftFiles,
    skipTokenizationFiles: state.skipTokenizationFiles,
    coalescedFiles: state.coalescedFiles,
    avgProcessingDurationMs: Number((state.processingDurationMs / totalFiles).toFixed(3)),
    avgSourceChunks: Number((state.sourceChunks / totalFiles).toFixed(3)),
    avgWorkingChunks: Number((state.workingChunks / totalFiles).toFixed(3)),
    avgOutputChunks: Number((state.outputChunks / totalFiles).toFixed(3)),
    avgFileBytes: Number((state.fileBytes / totalFiles).toFixed(1)),
    avgFileLines: Number((state.fileLines / totalFiles).toFixed(1)),
    maxProcessingDurationMs: state.maxProcessingDurationMs,
    maxProcessingDurationFile: state.maxProcessingDurationFile,
    maxSourceChunks: state.maxSourceChunks,
    maxSourceChunksFile: state.maxSourceChunksFile,
    topSlowFiles: state.topSlowFiles,
    byLanguage
  };
};

/**
 * Create a buffered JSONL perf event logger.
 *
 * Events are written to disk only and never mirrored to console output.
 *
 * @param {{
 *   buildRoot?:string|null,
 *   mode?:string|null,
 *   stream?:string|null,
 *   enabled?:boolean,
 *   flushRows?:number,
 *   flushBytes?:number
 * }} [options]
 * @returns {Promise<{
 *   enabled:boolean,
 *   path:string|null,
 *   emit:(event:string,payload?:object)=>void,
 *   flush:()=>Promise<void>,
 *   close:()=>Promise<void>
 * }>}
 */
export const createPerfEventLogger = async ({
  buildRoot = null,
  mode = null,
  stream = 'events',
  enabled = true,
  flushRows = DEFAULT_FLUSH_ROWS,
  flushBytes = DEFAULT_FLUSH_BYTES
} = {}) => {
  if (!enabled || !buildRoot) {
    return createNoopPerfEventLogger();
  }

  const resolvedFlushRows = toPositiveInt(flushRows, DEFAULT_FLUSH_ROWS);
  const resolvedFlushBytes = toPositiveInt(flushBytes, DEFAULT_FLUSH_BYTES);
  const perfDir = path.join(buildRoot, 'perf');
  const modeLabel = typeof mode === 'string' && mode.trim() ? mode.trim().toLowerCase() : 'all';
  const streamLabel = typeof stream === 'string' && stream.trim() ? stream.trim().toLowerCase() : 'events';
  const filePath = path.join(perfDir, `${streamLabel}.${modeLabel}.jsonl`);

  try {
    await fs.mkdir(perfDir, { recursive: true });
    await fs.appendFile(filePath, '');
  } catch {
    return createNoopPerfEventLogger();
  }

  let buffer = [];
  let bufferedBytes = 0;
  let writeChain = Promise.resolve();

  const flush = async () => {
    if (!buffer.length) return writeChain;
    const payload = buffer.join('');
    buffer = [];
    bufferedBytes = 0;
    writeChain = writeChain.then(async () => {
      try {
        await fs.appendFile(filePath, payload, 'utf8');
      } catch {}
    });
    return writeChain;
  };

  const emit = (event, payload = {}) => {
    if (!event) return;
    const encoded = safeStringify({
      ts: new Date().toISOString(),
      event,
      ...((payload && typeof payload === 'object') ? payload : {})
    });
    if (!encoded) return;
    const line = `${encoded}\n`;
    buffer.push(line);
    bufferedBytes += Buffer.byteLength(line, 'utf8');
    if (buffer.length >= resolvedFlushRows || bufferedBytes >= resolvedFlushBytes) {
      void flush();
    }
  };

  const close = async () => {
    await flush();
    await writeChain;
  };

  return {
    enabled: true,
    path: filePath,
    emit,
    flush,
    close
  };
};

/**
 * Wrap a perf event logger and aggregate high-frequency heavy-file events.
 *
 * This keeps heavy-file instrumentation always-on while avoiding one JSONL row
 * per code file in normal indexing runs.
 *
 * @param {{
 *   logger?:{enabled?:boolean,path?:string|null,emit?:(event:string,payload?:object)=>void,flush?:()=>Promise<void>,close?:()=>Promise<void>},
 *   sampleLimit?:number
 * }} [options]
 * @returns {{enabled:boolean,path:string|null,emit:(event:string,payload?:object)=>void,flush:()=>Promise<void>,close:()=>Promise<void>}}
 */
export const createHeavyFilePerfAggregator = ({
  logger = null,
  sampleLimit = DEFAULT_HEAVY_FILE_SAMPLE_LIMIT
} = {}) => {
  const downstream = logger && typeof logger.emit === 'function'
    ? logger
    : createNoopPerfEventLogger();
  if (downstream.enabled !== true) return downstream;
  const limit = toPositiveInt(sampleLimit, DEFAULT_HEAVY_FILE_SAMPLE_LIMIT);
  let state = createHeavyFileAggregateState(limit);

  const emitSummary = () => {
    const summary = buildHeavyFileSummary(state);
    if (!summary) return;
    downstream.emit(HEAVY_FILE_SUMMARY_EVENT, summary);
    state = createHeavyFileAggregateState(limit);
  };

  return {
    enabled: downstream.enabled === true,
    path: downstream.path || null,
    emit(event, payload = {}) {
      if (event === HEAVY_FILE_EVENT) {
        foldHeavyFileEvent(state, payload);
        return;
      }
      downstream.emit(event, payload);
    },
    async flush() {
      await downstream.flush?.();
    },
    async close() {
      emitSummary();
      await downstream.close?.();
    }
  };
};
