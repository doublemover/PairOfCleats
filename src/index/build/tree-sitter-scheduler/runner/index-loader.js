import fs from 'node:fs/promises';
import { coerceAbortSignal, throwIfAborted } from '../../../../shared/abort.js';
import { runWithConcurrency } from '../../../../shared/concurrency.js';

const INDEX_LOAD_RETRY_ATTEMPTS = 8;
const INDEX_LOAD_RETRY_BASE_DELAY_MS = 25;

/**
 * Sleep helper used for bounded retry backoff while polling scheduler indexes.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Parse and validate newline-delimited scheduler index rows.
 *
 * @param {string} text
 * @param {string} indexPath
 * @returns {Map<string, object>}
 */
const parseIndexRows = (text, indexPath) => {
  const rows = new Map();
  let invalidRows = 0;
  const validateRow = (row) => {
    if (!row || typeof row !== 'object') return false;
    if (typeof row.virtualPath !== 'string' || !row.virtualPath) return false;
    if (typeof row.grammarKey !== 'string' || !row.grammarKey) return false;
    if (row.store === 'paged-json') {
      const page = Number(row.page);
      const item = Number(row.row);
      const pageOffset = Number(row.pageOffset);
      const pageBytes = Number(row.pageBytes);
      return Number.isFinite(page)
        && page >= 0
        && Number.isFinite(item)
        && item >= 0
        && Number.isFinite(pageOffset)
        && pageOffset >= 0
        && Number.isFinite(pageBytes)
        && pageBytes > 0;
    }
    const offset = Number(row.offset);
    const bytes = Number(row.bytes);
    return Number.isFinite(offset)
      && offset >= 0
      && Number.isFinite(bytes)
      && bytes > 0;
  };
  const lines = String(text || '').split(/\r?\n/);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const raw = lines[lineNumber];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let row = null;
    try {
      row = JSON.parse(trimmed);
    } catch (err) {
      invalidRows += 1;
      continue;
    }
    if (!validateRow(row)) {
      invalidRows += 1;
      continue;
    }
    rows.set(row.virtualPath, row);
  }
  if (invalidRows > 0) {
    const err = new Error(
      `[tree-sitter:schedule] invalid index rows in ${indexPath} (invalid=${invalidRows}, valid=${rows.size})`
    );
    err.code = 'ERR_TREE_SITTER_INDEX_PARSE';
    throw err;
  }
  return rows;
};

/**
 * Read scheduler index rows with bounded retry for transient writer races.
 *
 * @param {{indexPath:string,abortSignal?:AbortSignal|null}} input
 * @returns {Promise<Map<string, object>>}
 */
const readIndexRowsWithRetry = async ({ indexPath, abortSignal = null }) => {
  const effectiveAbortSignal = coerceAbortSignal(abortSignal);
  let lastError = null;
  for (let attempt = 0; attempt < INDEX_LOAD_RETRY_ATTEMPTS; attempt += 1) {
    throwIfAborted(effectiveAbortSignal);
    try {
      const text = await fs.readFile(indexPath, 'utf8');
      return parseIndexRows(text, indexPath);
    } catch (err) {
      lastError = err;
      const retryable = err?.code === 'ENOENT' || err?.code === 'ERR_TREE_SITTER_INDEX_PARSE';
      if (!retryable || attempt >= INDEX_LOAD_RETRY_ATTEMPTS - 1) {
        throw err;
      }
      await sleep(INDEX_LOAD_RETRY_BASE_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError || new Error(`[tree-sitter:schedule] failed to load index rows: ${indexPath}`);
};

/**
 * Load and merge per-grammar scheduler index rows into a virtual-path map.
 *
 * @param {{grammarKeys:string[],paths:object,abortSignal?:AbortSignal|null}} input
 * @returns {Promise<Map<string, object>>}
 */
export const loadIndexEntries = async ({ grammarKeys, paths, abortSignal = null }) => {
  const effectiveAbortSignal = coerceAbortSignal(abortSignal);
  throwIfAborted(effectiveAbortSignal);
  const index = new Map();
  const keys = Array.isArray(grammarKeys) ? grammarKeys : [];
  const rowMaps = await runWithConcurrency(
    keys,
    Math.max(1, Math.min(8, keys.length || 1)),
    async (grammarKey) => {
      throwIfAborted(effectiveAbortSignal);
      const indexPath = paths.resultsIndexPathForGrammarKey(grammarKey);
      return readIndexRowsWithRetry({ indexPath, abortSignal: effectiveAbortSignal });
    },
    {
      signal: effectiveAbortSignal,
      requireSignal: true,
      signalLabel: 'build.tree-sitter.index-loader.runWithConcurrency'
    }
  );
  for (const rows of rowMaps || []) {
    if (!(rows instanceof Map)) continue;
    for (const [virtualPath, row] of rows.entries()) {
      throwIfAborted(effectiveAbortSignal);
      index.set(virtualPath, row);
    }
  }
  return index;
};
