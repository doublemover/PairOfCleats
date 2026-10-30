import { serialize, deserialize } from 'node:v8';
import { createHash } from 'node:crypto';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../semantic/analysis-versions.js';
import { LINT_PRODUCER } from '../../lint-policy.js';
import { projectFileAnalysisRisk, projectFileAnalysisComments } from './file-analysis-risk.js';
import { fileAnalysisProtocolError, fileAnalysisBudgetError } from './file-analysis-errors.js';
export { fileAnalysisProtocolError, fileAnalysisBudgetError } from './file-analysis-errors.js';

export const FILE_ANALYSIS_CONTRACT_VERSION = 2;
export const FILE_ANALYSIS_MAX_SOURCE_BYTES = 2 * 1024 * 1024;
export const FILE_ANALYSIS_MAX_INPUT_BYTES = 4 * 1024 * 1024;
export const FILE_ANALYSIS_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
export const FILE_ANALYSIS_MAX_EVENTS = 4096;
export const FILE_ANALYSIS_TIMING_METHODS = Object.freeze(['addSettingMetric', 'addLineSpan', 'addParseDuration',
  'addTokenizeDuration', 'addEnrichDuration', 'addEmbeddingDuration', 'addLintDuration', 'addComplexityDuration',
  'setGitDuration', 'setPythonAstDuration']);
const JS_TS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Reject handles/callbacks/cycles before serialization; no complete runtime or
 * parser context is cloned. Work is bounded independently of byte estimates. */
export const validateFileAnalysisProjection = (root, maxBytes) => {
  let nodes = 0, bytes = 0;
  const active = new Set();
  const visit = (value, depth = 0) => {
    if (++nodes > 200000 || depth > 64) throw fileAnalysisBudgetError('projection-structure');
    if (value == null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'bigint') { bytes += 16; }
    else if (typeof value === 'string') bytes += Buffer.byteLength(value) + 8;
    else if (typeof value !== 'object') throw fileAnalysisProtocolError('unsupported-value');
    else {
      if (active.has(value)) throw fileAnalysisProtocolError('cyclic-projection');
      if (ArrayBuffer.isView(value)) bytes += value.byteLength + 64;
      else if (value instanceof ArrayBuffer) bytes += value.byteLength + 64;
      else if (value instanceof Date) bytes += 32;
      else if (value instanceof RegExp) bytes += Buffer.byteLength(value.source) + 32;
      else {
        const prototype = Object.getPrototypeOf(value);
        if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw fileAnalysisProtocolError('runtime-handle');
        if (Object.getOwnPropertySymbols(value).length) throw fileAnalysisProtocolError('symbol-projection');
        if (Array.isArray(value) && value.length > 200000) throw fileAnalysisBudgetError('projection-rows');
        active.add(value);
        for (const key of Object.keys(value)) {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (!descriptor || !('value' in descriptor)) throw fileAnalysisProtocolError('projection-accessor');
          bytes += Buffer.byteLength(key) + 8; visit(descriptor.value, depth + 1);
        }
        active.delete(value);
      }
    }
    if (bytes > maxBytes) throw fileAnalysisBudgetError('projection-bytes');
  };
  visit(root);
};

const producerIdentity = () => ({ contract: FILE_ANALYSIS_CONTRACT_VERSION, node: process.versions.node,
  v8: process.versions.v8, producers: SEMANTIC_ANALYSIS_VERSIONS, lint: LINT_PRODUCER });
const bytesOf = value => {
  if (!ArrayBuffer.isView(value) || value.BYTES_PER_ELEMENT !== 1) throw fileAnalysisProtocolError('byte-envelope');
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
};
const decode = bytes => {
  let decoded;
  try { decoded = deserialize(bytes); }
  catch { throw fileAnalysisProtocolError('serialized-envelope'); }
  if (!decoded || !Array.isArray(decoded.nullPrototypePaths) || decoded.nullPrototypePaths.length > 200000) {
    throw fileAnalysisProtocolError('dictionary-envelope');
  }
  for (const path of decoded.nullPrototypePaths) {
    if (!Array.isArray(path) || path.length > 64) throw fileAnalysisProtocolError('dictionary-path');
    let target = decoded.value;
    for (const key of path) {
      if (typeof key !== 'string' || !target || typeof target !== 'object') throw fileAnalysisProtocolError('dictionary-path');
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (!descriptor || !('value' in descriptor)) throw fileAnalysisProtocolError('dictionary-path');
      target = descriptor.value;
    }
    if (!target || Array.isArray(target) || (Object.getPrototypeOf(target) !== Object.prototype
      && Object.getPrototypeOf(target) !== null)) {
      throw fileAnalysisProtocolError('dictionary-prototype');
    }
    Object.setPrototypeOf(target, null);
  }
  return decoded.value;
};
const encode = (value, limit) => {
  validateFileAnalysisProjection(value, limit);
  // V8 serialization drops null prototypes. Preserve the owned dictionary
  // paths separately so names such as __proto__ keep identical map semantics.
  const nullPrototypePaths = [];
  let pathBytes = 0;
  const visit = (node, path, bytes) => {
    if (!node || typeof node !== 'object' || ArrayBuffer.isView(node)
      || node instanceof ArrayBuffer || node instanceof Date || node instanceof RegExp) return;
    if (Object.getPrototypeOf(node) === null) {
      pathBytes += bytes + path.length * 8 + 32;
      if (pathBytes > limit) throw fileAnalysisBudgetError('dictionary-paths');
      nullPrototypePaths.push(path);
    }
    for (const key of Object.keys(node)) visit(node[key], [...path, key], bytes + Buffer.byteLength(key));
  };
  visit(value, [], 0);
  const bytes = serialize({ value, nullPrototypePaths });
  if (bytes.length > limit) throw fileAnalysisBudgetError('serialized-bytes');
  return bytes;
};

// A parent already owns its file/compute slot. Reserve all bounded transport
// copies and the maximum result before starting the task, without nesting a
// second acquisition behind the parent's retained byte reservation.
export const fileAnalysisAdmissionBytes = size => 2 * (FILE_ANALYSIS_MAX_INPUT_BYTES + FILE_ANALYSIS_MAX_OUTPUT_BYTES)
  + Math.max(0, Number(size) || 0) * 4;

export const isFileAnalysisCandidate = ({ mode, ext, workerPool }) => mode === 'code'
  && JS_TS_EXTENSIONS.has(ext) && workerPool?.config?.enabled === true
  && typeof workerPool?.analyzeFile === 'function';

const COPY_KEYS = ['abs', 'root', 'mode', 'fileIndex', 'ext', 'rel', 'relKey', 'text', 'fileHash', 'fileHashAlgo',
  'fileCaps', 'fileStructural', 'normalizedSegmentsConfig', 'normalizedCommentsConfig', 'dictConfig', 'postingsConfig',
  'contextWin', 'relationsEnabled', 'lintEnabled', 'lintPolicy', 'complexityEnabled', 'typeInferenceEnabled', 'riskAnalysisEnabled',
  'riskConfig', 'gitBlameEnabled', 'analysisPolicy', 'tokenizeEnabled', 'astDataflowEnabled', 'controlFlowEnabled',
  'toolInfo', 'vfsManifestConcurrency', 'buildStage', 'cachedLexicalCheckpoint', 'lexicalCheckpointDependencies',
  'fileLineDictionaryReceipt'];
const LANGUAGE_KEYS = ['rootDir', 'astDataflowEnabled', 'controlFlowEnabled', 'skipUnknownLanguages', 'skipOnParseError',
  'javascript', 'typescript', 'chunking', 'tokenization', 'lexicon', 'yamlChunking'];
const COORDINATOR_LANGUAGE_KEYS = new Set(['treeSitter', 'abortSignal', 'log', 'resolveSqlDialect', 'pythonAst', 'kotlin',
  'embeddingBatchMultipliers']);

/** Explicit unsupported ownership boundaries fall back before worker dispatch. */
export const projectFileAnalysisInput = context => {
  if (context.semantic) return { reason: 'compiler-session-owner' };
  if (context.embeddingEnabled) return { reason: 'embedding-owner' };
  if (context.treeSitterScheduler || (context.languageOptions?.treeSitter?.enabled !== false && !context.fileEntry?.treeSitterDisabled)) {
    return { reason: 'native-parser-owner' };
  }
  if (context.documentExtraction) return { reason: 'document-extraction-owner' };
  if (Object.keys(context.languageOptions || {}).some(key => !LANGUAGE_KEYS.includes(key) && !COORDINATOR_LANGUAGE_KEYS.has(key))) {
    return { reason: 'unsupported-language-option' };
  }
  if (context.postingsConfig?.tokenClassification?.enabled === true) return { reason: 'native-classification-owner' };
  if (context.scmProviderImpl && context.scmProvider && context.scmProvider !== 'none') return { reason: 'scm-owner' };
  if (typeof context.text !== 'string' || Buffer.byteLength(context.text) > FILE_ANALYSIS_MAX_SOURCE_BYTES) return { reason: 'source-budget' };
  const projection = Object.fromEntries(COPY_KEYS.filter(key => context[key] !== undefined).map(key => [key, context[key]]));
  projection.fileStat = { size: context.fileStat?.size || 0 };
  projection.fileEntry = { abs: context.abs, rel: context.relKey, lines: context.fileEntry?.lines, treeSitterDisabled: true };
  projection.languageOptions = Object.fromEntries(LANGUAGE_KEYS.filter(key => context.languageOptions?.[key] !== undefined)
    .map(key => [key, context.languageOptions[key]]));
  projection.languageOptions.treeSitter = { enabled: false };
  projection.cachedStageBundle = context.cachedStageBundle ? {
    stageRefresh: context.cachedStageBundle.stageRefresh, parseCheckpoint: context.cachedStageBundle.parseCheckpoint,
    lexicalCheckpoint: context.cachedStageBundle.lexicalCheckpoint
  } : null;
  projection.observers = { metrics: Boolean(context.timing?.metricsCollector), perf: Boolean(context.perfEventLogger),
    crash: Boolean(context.crashLogger?.enabled) };
  try {
    projection.riskConfig = projectFileAnalysisRisk(context.riskConfig);
    projection.normalizedCommentsConfig = projectFileAnalysisComments(context.normalizedCommentsConfig);
    const body = encode({ producer: producerIdentity(), context: projection }, FILE_ANALYSIS_MAX_INPUT_BYTES);
    return { payload: { version: FILE_ANALYSIS_CONTRACT_VERSION, identity: hash(body), body,
      mode: context.mode, ext: context.ext, languageId: ['.ts', '.tsx', '.mts', '.cts'].includes(context.ext) ? 'typescript' : 'javascript',
      file: context.relKey, size: Buffer.byteLength(context.text) } };
  } catch (error) {
    if (error?.code === 'ERR_FILE_ANALYSIS_PROTOCOL' || error?.code === 'ERR_FILE_ANALYSIS_BUDGET') return { reason: error.reason };
    throw error;
  }
};

export const decodeFileAnalysisInput = payload => {
  if (payload?.version !== FILE_ANALYSIS_CONTRACT_VERSION) throw fileAnalysisProtocolError('input-version');
  const body = bytesOf(payload.body);
  if (body.length > FILE_ANALYSIS_MAX_INPUT_BYTES || hash(body) !== payload.identity) throw fileAnalysisProtocolError('input-identity');
  const decoded = decode(body);
  validateFileAnalysisProjection(decoded, FILE_ANALYSIS_MAX_INPUT_BYTES);
  if (JSON.stringify(decoded.producer) !== JSON.stringify(producerIdentity())) throw fileAnalysisProtocolError('producer-identity');
  const context = decoded.context;
  const allowedKeys = new Set([...COPY_KEYS, 'fileStat', 'fileEntry', 'languageOptions', 'cachedStageBundle', 'observers']);
  if (!context || context.mode !== 'code' || !JS_TS_EXTENSIONS.has(context.ext)
    || Object.keys(context).some(key => !allowedKeys.has(key))
    || context.mode !== payload.mode || context.ext !== payload.ext || context.relKey !== payload.file
    || payload.languageId !== (['.ts', '.tsx', '.mts', '.cts'].includes(context.ext) ? 'typescript' : 'javascript')
    || typeof context.text !== 'string' || Buffer.byteLength(context.text) > FILE_ANALYSIS_MAX_SOURCE_BYTES
    || payload.size !== Buffer.byteLength(context.text) || context.languageOptions?.treeSitter?.enabled !== false) {
    throw fileAnalysisProtocolError('supported-source');
  }
  if (Object.keys(context.languageOptions).some(key => key !== 'treeSitter' && !LANGUAGE_KEYS.includes(key))
    || context.postingsConfig?.tokenClassification?.enabled === true
    || !Number.isSafeInteger(context.fileStat?.size) || context.fileStat.size < 0
    || context.fileEntry?.treeSitterDisabled !== true) throw fileAnalysisProtocolError('supported-options');
  return context;
};

export const encodeFileAnalysisResult = (payload, result) => {
  const body = encode(result, FILE_ANALYSIS_MAX_OUTPUT_BYTES);
  return { version: FILE_ANALYSIS_CONTRACT_VERSION, identity: payload.identity, body, outputIdentity: hash(body), outputBytes: body.length };
};
export const decodeFileAnalysisResult = (payload, envelope) => {
  if (envelope?.version !== FILE_ANALYSIS_CONTRACT_VERSION || envelope.identity !== payload.identity) throw fileAnalysisProtocolError('result-identity');
  const body = bytesOf(envelope.body);
  if (body.length > FILE_ANALYSIS_MAX_OUTPUT_BYTES || body.length !== envelope.outputBytes
    || hash(body) !== envelope.outputIdentity) throw fileAnalysisProtocolError('result-bytes');
  const result = decode(body);
  validateFileAnalysisProjection(result, FILE_ANALYSIS_MAX_OUTPUT_BYTES);
  return result;
};
