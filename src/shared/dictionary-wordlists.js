import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import readline from 'node:readline';
import { acquireDictionaryStorageRead, isDictionaryStorageAccessError } from './storage/dictionary-access.js';

const DEFAULT_DICTIONARY_READ_CONCURRENCY = 8;
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
  let stream = null;
  let lineReader = null;
  let closed = null;
  let closeFailure = null;
  let operationError = null;
  try {
    stream = fsSync.createReadStream(dictFile, { encoding: 'utf8' });
    stream.on('error', error => { if (error?.syscall === 'close') closeFailure = error; });
    closed = new Promise(resolve => stream.once('close', resolve));
    lineReader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lineReader) {
      addDictionaryWordFromLine(line, target, lowerCase);
    }
  } catch (error) {
    operationError = asDictionaryError(error);
    throw operationError;
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
    if (closeFailure) {
      const error = Object.assign(new Error('Dictionary file close is unconfirmed; its storage lease remains retained.', { cause: closeFailure }), {
        code: 'ERR_DICTIONARY_STORAGE_CLOSE_PENDING', cacheOwnershipPending: true
      });
      Object.defineProperty(error, 'dictionaryStorageAccess', { value: access });
      cleanupError = cleanupError ? retainDictionaryFailure(cleanupError, error, 'dictionaryCleanupErrors') : error;
    } else {
      try { access.releaseAfterClosure(); }
      catch (error) { cleanupError = cleanupError ? retainDictionaryFailure(cleanupError, error, 'dictionaryCleanupErrors') : asDictionaryError(error); }
    }
    if (cleanupError) throw operationError ? retainDictionaryFailure(operationError, cleanupError, 'dictionaryCleanupErrors') : cleanupError;
  }
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
  { target = null, lowerCase = false } = {}
) => {
  const words = target instanceof Set ? target : new Set();
  const files = toFileList(filePaths);
  if (!files.length) return words;
  await runWithBoundedConcurrency(files, DEFAULT_DICTIONARY_READ_CONCURRENCY, async (dictFile) => {
    try {
      await readDictionaryWordsFromFile(dictFile, words, { lowerCase });
    } catch (error) { if (isDictionaryStorageAccessError(error)) throw error; }
  });
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
  const access = acquireDictionaryStorageRead(dictFile, { scope: 'dictionary-signature-stat' });
  try {
    const stat = await fs.stat(dictFile);
    return `${prefix}${signaturePath}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return `${prefix}${signaturePath}:missing`;
  } finally { access.releaseAfterClosure(); }
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
    lowerCase = true
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
  await runWithBoundedConcurrency(jobs, DEFAULT_DICTIONARY_READ_CONCURRENCY, async ({ file, words }) => {
    try { await readDictionaryWordsFromFile(file, words, { lowerCase }); }
    catch (error) { if (isDictionaryStorageAccessError(error)) throw error; }
  });
  for (const word of commonWords) allWords.add(word);
  for (const [language, words] of wordsByLanguage) {
    if (!words.size) { wordsByLanguage.delete(language); continue; }
    for (const word of words) allWords.add(word);
  }
  return { commonWords, wordsByLanguage, allWords };
};

/**
 * Build stable dictionary signature rows from path + stat metadata.
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
