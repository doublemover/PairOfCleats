import path from 'node:path';
import readline from 'node:readline';
import { acquireDictionaryStorageRead } from './storage/dictionary-access.js';
import { createDictionaryInputStream } from './dictionary-input-stream.js';
import { describeStorageFailure, observeStorageResource } from './storage/failure-observation.js';
import { addStorageFailureContext } from './storage/operation-error.js';

const DEFAULT_DICTIONARY_READ_CONCURRENCY = 8;
const snapshotScopes = new WeakMap();
const snapshotWords = (scope, file, lowerCase) => {
  const admission = snapshotScopes.get(scope), record = admission?.records.get(file);
  if (!record || admission.lowerCase !== Boolean(lowerCase) || scope.get(file) !== record.receipt) {
    throw new TypeError('Dictionary snapshot does not own the selected input/normalization scope.');
  }
  return record.words;
};
const asDictionaryError = error => error && typeof error === 'object' ? error : new Error(String(error), { cause: error });
const captureDictionaryClosure = error => {
  let observer;
  try { observer = error.cacheOwnershipReleased; } catch { return { present: true, observe: () => false }; }
  return { present: typeof observer === 'function',
    observe: () => { try { return typeof observer === 'function' && observer.call(error) === true; } catch { return false; } } };
};
const retainDictionaryFailure = (primary, secondary, field) => {
  const error = asDictionaryError(primary);
  const additional = asDictionaryError(secondary);
  if (error === additional) return error;
  const failures = [...(Array.isArray(error[field]) ? error[field] : []), additional];
  const pending = error.cacheOwnershipPending === true || additional.cacheOwnershipPending === true;
  // Capture function identities before replacing the primary's observer; a
  // dynamic lookup here would recurse into this newly composed predicate.
  const closures = [];
  const primaryClosure = captureDictionaryClosure(error);
  if (error.cacheOwnershipPending === true || primaryClosure.present) closures.push(primaryClosure.observe);
  if (additional.cacheOwnershipPending === true) closures.push(captureDictionaryClosure(additional).observe);
  const allReleased = () => closures.length > 0 && closures.every(observe => observe());
  try {
    Object.defineProperty(error, field, { value: failures, configurable: true, writable: true });
    if (pending && error.cacheOwnershipPending !== true) {
      Object.defineProperty(error, 'cacheOwnershipPending', { value: true, configurable: true, writable: true });
    }
    if (pending) Object.defineProperty(error, 'cacheOwnershipReleased', { value: allReleased, configurable: true, writable: true });
    return error;
  } catch {
    // Provider/native errors may be frozen or carry readonly diagnostics. Keep
    // that exact primary as cause and first aggregate member instead of losing
    // it (and its pending sibling) to a metadata-attachment TypeError.
    const aggregate = new AggregateError([error, additional], error.message || 'Dictionary operation and cleanup failed.', { cause: error });
    if (typeof error.code === 'string') aggregate.code = error.code;
    aggregate[field] = failures;
    if (pending) aggregate.cacheOwnershipPending = true;
    if (pending) aggregate.cacheOwnershipReleased = allReleased;
    return aggregate;
  }
};

/**
 * Normalize file path inputs into a filtered string list.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
const toFileList = (value) => {
  if (!value) return [];
  if (typeof value === 'string' || value instanceof String) {
    const normalized = String(value);
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === 'string' && entry);
  }
  if (value instanceof Set) {
    return Array.from(value).filter((entry) => typeof entry === 'string' && entry);
  }
  if (typeof value[Symbol.iterator] === 'function') {
    return Array.from(value).filter((entry) => typeof entry === 'string' && entry);
  }
  return [];
};

/**
 * Parse newline-delimited words from one in-memory dictionary file.
 *
 * @param {string|null|undefined} text
 * @param {Set<string>} target
 * @param {{lowerCase?:boolean}} [options]
 * @returns {Set<string>}
 */
export const addDictionaryWordsFromText = (
  text,
  target,
  { lowerCase = false } = {}
) => {
  if (!(target instanceof Set) || typeof text !== 'string' || !text.length) {
    return target;
  }
  let lineStart = 0;
  for (let i = 0; i <= text.length; i += 1) {
    if (i !== text.length && text.charCodeAt(i) !== 10) continue;
    let line = text.slice(lineStart, i);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    const trimmed = line.trim();
    if (trimmed) {
      target.add(lowerCase ? trimmed.toLowerCase().normalize('NFKD') : trimmed);
    }
    lineStart = i + 1;
  }
  return target;
};

/**
 * Add one normalized dictionary token to a target set.
 *
 * @param {string} line
 * @param {Set<string>} target
 * @param {boolean} lowerCase
 * @returns {void}
 */
const addDictionaryWordFromLine = (line, target, lowerCase) => {
  const trimmed = String(line || '').trim();
  if (!trimmed) return;
  target.add(lowerCase ? trimmed.toLowerCase().normalize('NFKD') : trimmed);
};

/**
 * Execute async jobs with a bounded worker pool.
 *
 * @template T
 * @param {T[]} values
 * @param {number} maxConcurrency
 * @param {(value:T,index:number)=>Promise<void>} worker
 * @returns {Promise<void>}
 */
const runWithBoundedConcurrency = async (values, maxConcurrency, worker) => {
  if (!values.length) return;
  const limit = Number.isFinite(maxConcurrency)
    ? Math.max(1, Math.floor(maxConcurrency))
    : DEFAULT_DICTIONARY_READ_CONCURRENCY;
  let cursor = 0;
  let failed = false;
  let firstError;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (!failed) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) break;
      try { await worker(values[index], index); }
      catch (error) {
        if (!failed) { failed = true; firstError = asDictionaryError(error); }
        else firstError = retainDictionaryFailure(firstError, error, 'dictionarySiblingFailures');
      }
    }
  });
  // The first failure stops admission, but already-open native reads must
  // confirm closure before this owner reports terminal failure to its caller.
  await Promise.all(workers);
  if (failed) throw firstError;
};

/**
 * Stream dictionary file lines into the target set.
 *
 * @param {string} dictFile
 * @param {Set<string>} target
 * @param {{lowerCase?:boolean}} [options]
 * @returns {Promise<void>}
 */
const readDictionaryWordsFromFile = async (
  dictFile,
  target,
  { lowerCase = false } = {}
) => {
  const access = acquireDictionaryStorageRead(dictFile);
  const releaseAccess = access.releaseAfterClosure.bind(access);
  let stream = null;
  let lineReader = null;
  let closed = null;
  let closeFailure = null;
  let operationError = null;
  let input = null;
  const staged = new Set();
  try {
    input = createDictionaryInputStream(dictFile, access.root || path.dirname(path.resolve(dictFile)));
    stream = input.stream;
    stream.on('error', error => { if (error?.syscall === 'close') closeFailure = error; });
    closed = new Promise(resolve => stream.once('close', resolve));
    lineReader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    // Readline forwards input errors even after its async iterator has ended.
    // Keep observing that exact interface through the native close barrier.
    lineReader.on('error', error => { operationError ||= asDictionaryError(error); });
    for await (const line of lineReader) {
      addDictionaryWordFromLine(line, staged, lowerCase);
    }
  } catch (error) {
    operationError = asDictionaryError(error);
  } finally {
    let cleanupError = null;
    try { lineReader?.close(); } catch (error) { cleanupError = asDictionaryError(error); }
    try { stream?.destroy(); } catch (error) {
      const failure = asDictionaryError(error);
      cleanupError = cleanupError ? retainDictionaryFailure(cleanupError, failure, 'dictionaryCleanupErrors') : failure;
    }
    // readline completion/destroy requests are not native handle closure.
    // Keep the exact scoped lease until the ReadStream emits actual close.
    if (closed) await closed;
    // ReadStream can retain its first read error instead of emitting the
    // descriptor owner's later close failure. Preserve that exact original
    // outcome before deciding whether metadata ownership can be released.
    const originalCloseFailure = input?.closureFailure();
    if (originalCloseFailure && originalCloseFailure !== operationError) {
      operationError = operationError ? retainDictionaryFailure(operationError, originalCloseFailure, 'dictionaryCleanupErrors') : originalCloseFailure;
    }
    let pendingObservation = null;
    if (operationError) {
      try { observeStorageResource(operationError, { phase: 'dictionary-input-read' }).requireSettled(); }
      catch (error) { pendingObservation = error; }
    }
    if (closeFailure || pendingObservation) {
      const observations = [...new Set([closeFailure, pendingObservation].filter(Boolean))]
        .map(error => observeStorageResource(error, { phase: 'dictionary-close-reconciliation' }));
      let accessReleased = false;
      const unknownClose = observations.some(observation => !observation.hasResourceObservation);
      const error = Object.assign(new Error('Dictionary file close is unconfirmed; its storage lease remains retained.', { cause: closeFailure || pendingObservation }), {
        code: 'ERR_DICTIONARY_STORAGE_CLOSE_PENDING', cacheOwnershipPending: true,
        cacheOwnershipReleased: () => accessReleased && !unknownClose && observations.every(observation => observation.isSettled())
      });
      Object.defineProperty(error, 'dictionaryStorageAccess', { value: Object.freeze({ ...access, releaseAfterClosure: () => {
        // This existing capability releases metadata only. It never retries a
        // native close and cannot bypass independently pending original work.
        if (accessReleased) return true;
        for (const observation of observations) observation.requireSettled();
        if (releaseAccess() !== true) throw new Error('Dictionary metadata release was not confirmed.');
        accessReleased = true; return true;
      } }) });
      cleanupError = cleanupError ? retainDictionaryFailure(cleanupError, error, 'dictionaryCleanupErrors') : error;
    } else {
      try { releaseAccess(); }
      catch (error) { cleanupError = cleanupError ? retainDictionaryFailure(cleanupError, error, 'dictionaryCleanupErrors') : asDictionaryError(error); }
    }
    if (cleanupError) throw operationError ? retainDictionaryFailure(operationError, cleanupError, 'dictionaryCleanupErrors') : cleanupError;
  }
  if (operationError) {
    const diagnostic = describeStorageFailure(operationError, { phase: 'dictionary-input-read' });
    if (diagnostic.code === 'ENOENT' && !input?.opened()) return Object.freeze({ outcome: 'optional-missing', bytes: 0, hash: null });
    throw operationError;
  }
  const receipt = input.receipt();
  for (const word of staged) target.add(word);
  return receipt;
};

/** One global reader budget for all selected base/common/language inputs. The
 * returned word sets and content receipts come from the same completed stream.
 */
export const loadDictionaryFileSnapshots = async (filePaths, { lowerCase = false } = {}) => {
  const files = [...new Set(toFileList(filePaths))], results = new Map(), records = new Map();
  let failed = 0;
  try {
    await runWithBoundedConcurrency(files, DEFAULT_DICTIONARY_READ_CONCURRENCY, async file => {
      const words = new Set();
      try {
        const receipt = await readDictionaryWordsFromFile(file, words, { lowerCase });
        results.set(file, receipt); records.set(file, { receipt, words });
      } catch (error) {
        failed++;
        throw addStorageFailureContext(error, { dictionaryInput: Object.freeze({ path: file, outcome: 'failed' }) });
      }
    });
  } catch (error) {
    const completed = [...results.values()].filter(receipt => receipt.outcome === 'complete').length;
    const optionalMissing = results.size - completed;
    throw addStorageFailureContext(error, { dictionaryInputs: Object.freeze({ selected: files.length, completed,
      optionalMissing, failed, unstarted: files.length - results.size - failed, complete: false }) });
  }
  snapshotScopes.set(results, { lowerCase: Boolean(lowerCase), records });
  return results;
};

/**
 * Read and parse dictionary files into a single word set.
 *
 * Files are read in parallel to reduce startup latency for multi-file
 * dictionary setups.
 *
 * @param {string[]|Set<string>|Iterable<string>} filePaths
 * @param {{target?:Set<string>|null,lowerCase?:boolean}} [options]
 * @returns {Promise<Set<string>>}
 */
export const loadDictionaryWordSetFromFiles = async (
  filePaths,
  { target = null, lowerCase = false, snapshots = null } = {}
) => {
  const words = target instanceof Set ? target : new Set();
  const files = toFileList(filePaths);
  if (!files.length) return words;
  const inputs = snapshots || await loadDictionaryFileSnapshots(files, { lowerCase });
  for (const file of files) for (const word of snapshotWords(inputs, file, lowerCase)) words.add(word);
  return words;
};

/**
 * Read one dictionary file as a signature row.
 *
 * @param {string} dictFile
 * @param {{toSignaturePath?:(filePath:string)=>string,prefix?:string}} [options]
 * @returns {Promise<string>}
 */
const buildDictionaryFileSignature = async (
  dictFile,
  { toSignaturePath = null, prefix = '' } = {}
) => {
  const signaturePath = typeof toSignaturePath === 'function'
    ? toSignaturePath(dictFile)
    : String(dictFile || '');
  const inputs = await loadDictionaryFileSnapshots([dictFile]);
  const receipt = inputs.get(dictFile);
  return receipt.outcome === 'optional-missing' ? `${prefix}${signaturePath}:missing`
    : `${prefix}${signaturePath}:sha256:${receipt.bytes}:${receipt.hash}`;
};

/**
 * Build normalized word sets for common + language-scoped code dictionaries.
 *
 * @param {{
 *   commonFiles?:string[]|Set<string>|Iterable<string>,
 *   byLanguage?:Map<string, string[]|Set<string>|Iterable<string>>|Record<string, string[]|Set<string>|Iterable<string>>,
 *   lowerCase?:boolean
 * }} [input]
 * @returns {Promise<{commonWords:Set<string>,wordsByLanguage:Map<string, Set<string>>,allWords:Set<string>}>}
 */
export const loadCodeDictionaryWordSets = async (
  {
    commonFiles = [],
    byLanguage = new Map(),
    lowerCase = true,
    snapshots = null
  } = {}
) => {
  const entries = byLanguage instanceof Map
    ? Array.from(byLanguage.entries())
    : Object.entries(byLanguage || {});
  const commonWords = new Set();
  const wordsByLanguage = new Map();
  const allWords = new Set();
  const jobs = toFileList(commonFiles).map(file => ({ file, words: commonWords }));
  for (const [language, files] of entries) {
    if (typeof language !== 'string' || !language) continue;
    const words = new Set();
    wordsByLanguage.set(language, words);
    for (const file of toFileList(files)) jobs.push({ file, words });
  }
  // Common and all language scopes consume one file-reader budget. A separate
  // pool per language multiplies open descriptors by configured language count.
  const inputs = snapshots || await loadDictionaryFileSnapshots(jobs.map(job => job.file), { lowerCase });
  for (const { file, words } of jobs) for (const word of snapshotWords(inputs, file, lowerCase)) words.add(word);
  for (const word of commonWords) allWords.add(word);
  for (const [language, words] of wordsByLanguage) {
    if (!words.size) { wordsByLanguage.delete(language); continue; }
    for (const word of words) allWords.add(word);
  }
  return { commonWords, wordsByLanguage, allWords };
};

/**
 * Build stable signature rows from the exact completed dictionary bytes.
 *
 * @param {string[]|Set<string>|Iterable<string>} filePaths
 * @param {{toSignaturePath?:(filePath:string)=>string,prefix?:string}} [options]
 * @returns {Promise<string[]>}
 */
export const collectDictionaryFileSignatures = async (
  filePaths,
  { toSignaturePath = null, prefix = '' } = {}
) => {
  const files = toFileList(filePaths);
  if (!files.length) return [];
  const signatures = new Array(files.length);
  await runWithBoundedConcurrency(files, DEFAULT_DICTIONARY_READ_CONCURRENCY, async (file, index) => {
    signatures[index] = await buildDictionaryFileSignature(file, { toSignaturePath, prefix });
  });
  return signatures;
};
