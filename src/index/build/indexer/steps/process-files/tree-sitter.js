import { compareStrings } from '../../../../../shared/sort.js';
import { fileExt } from '../../../../../shared/files.js';
import { log } from '../../../../../shared/progress.js';
import { getLanguageForFile } from '../../../../language-registry.js';
import { TREE_SITTER_LANGUAGE_IDS } from '../../../../../lang/tree-sitter.js';
import { isDocsPath, shouldPreferInfraProse } from '../../../mode-routing.js';

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);
const TREE_SITTER_EXT_MAP = new Map([
  ['.tsx', 'tsx'],
  ['.jsx', 'jsx'],
  ['.ts', 'typescript'],
  ['.cts', 'typescript'],
  ['.mts', 'typescript'],
  ['.js', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.jsm', 'javascript'],
  ['.py', 'python'],
  ['.json', 'json'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
  ['.toml', 'toml'],
  ['.xml', 'xml'],
  ['.md', 'markdown'],
  ['.mdx', 'markdown'],
  ['.css', 'css'],
  ['.scss', 'css'],
  ['.sass', 'css'],
  ['.less', 'css'],
  ['.c', 'clike'],
  ['.h', 'clike'],
  ['.m', 'objc'],
  ['.mm', 'objc'],
  ['.cpp', 'cpp'],
  ['.cc', 'cpp'],
  ['.cxx', 'cpp'],
  ['.hpp', 'cpp'],
  ['.hh', 'cpp'],
  ['.hxx', 'cpp'],
  ['.html', 'html'],
  ['.htm', 'html']
]);
const HTML_EMBEDDED_LANGUAGES = ['javascript', 'css'];
const DOC_TREE_SITTER_SKIP_LANGUAGES = new Set([
  'yaml',
  'json',
  'toml',
  'markdown',
  'html',
  'javascript',
  'typescript',
  'tsx',
  'jsx',
  'css'
]);

const resolveTreeSitterLanguageForEntry = (entry) => {
  const extRaw = typeof entry?.ext === 'string' && entry.ext ? entry.ext : fileExt(entry?.abs || entry?.rel || '');
  const ext = typeof extRaw === 'string' ? extRaw.toLowerCase() : '';
  const extLang = ext ? TREE_SITTER_EXT_MAP.get(ext) : null;
  if (extLang && TREE_SITTER_LANG_IDS.has(extLang)) return extLang;
  const lang = getLanguageForFile(ext, entry?.rel || '');
  const languageId = lang?.id || null;
  return languageId && TREE_SITTER_LANG_IDS.has(languageId) ? languageId : null;
};

const resolveTreeSitterBatchInfo = (entry, treeSitterOptions) => {
  const relPath = typeof entry?.rel === 'string' ? entry.rel : '';
  if (shouldPreferInfraProse({ relPath })) return { key: 'none', languages: [] };
  const primary = resolveTreeSitterLanguageForEntry(entry);
  if (!primary) return { key: 'none', languages: [] };
  if (isDocsPath(relPath) && DOC_TREE_SITTER_SKIP_LANGUAGES.has(primary)) {
    return { key: 'none', languages: [] };
  }
  if (treeSitterOptions?.languagePasses !== false) {
    return { key: primary, languages: [primary] };
  }
  const languages = new Set([primary]);
  const explicit = Array.isArray(entry?.treeSitterBatchLanguages) ? entry.treeSitterBatchLanguages : null;
  const embedded = Array.isArray(entry?.treeSitterEmbeddedLanguages) ? entry.treeSitterEmbeddedLanguages : null;
  for (const list of [explicit, embedded]) {
    if (!Array.isArray(list)) continue;
    for (const lang of list) {
      if (TREE_SITTER_LANG_IDS.has(lang)) languages.add(lang);
    }
  }
  if (treeSitterOptions?.batchEmbeddedLanguages !== false && primary === 'html') {
    for (const lang of HTML_EMBEDDED_LANGUAGES) {
      if (!TREE_SITTER_LANG_IDS.has(lang)) continue;
      languages.add(lang);
    }
  }
  const normalized = Array.from(languages).filter((lang) => TREE_SITTER_LANG_IDS.has(lang)).sort();
  const key = normalized.length ? normalized.join('+') : 'none';
  return { key, languages: normalized };
};

/**
 * Attach tree-sitter batch metadata to entries and optionally reorder by batch
 * key for parser-cache locality.
 *
 * @param {Array<object>} entries
 * @param {object} treeSitterOptions
 * @param {object} envConfig
 * @param {{allowReorder?:boolean}} [options]
 * @returns {void}
 */
export const applyTreeSitterBatching = (
  entries,
  treeSitterOptions,
  envConfig,
  {
    allowReorder = true,
    windowRanges = null
  } = {}
) => {
  if (!treeSitterOptions || treeSitterOptions.enabled === false) return;
  if (treeSitterOptions.batchByLanguage === false) return;
  if (!Array.isArray(entries) || entries.length < 2) return;

  const batchMeta = new Map();
  for (const entry of entries) {
    const info = resolveTreeSitterBatchInfo(entry, treeSitterOptions);
    entry.treeSitterBatchKey = info.key;
    entry.treeSitterBatchLanguages = info.languages;
    entry.treeSitterAllowedLanguages = info.languages;
    batchMeta.set(info.key, info.languages);
  }

  if (allowReorder) {
    const sortBatchSlice = (slice) => {
      slice.sort((a, b) => {
        const keyA = a.treeSitterBatchKey || 'none';
        const keyB = b.treeSitterBatchKey || 'none';
        const keyDelta = compareStrings(keyA, keyB);
        if (keyDelta !== 0) return keyDelta;
        return compareStrings(a.rel || '', b.rel || '');
      });
      return slice;
    };
    const windows = Array.isArray(windowRanges)
      ? windowRanges
        .filter((window) => Number.isFinite(window?.startSeq) && Number.isFinite(window?.endSeq))
        .map((window) => ({
          startSeq: Math.floor(window.startSeq),
          endSeq: Math.floor(window.endSeq)
        }))
        .sort((left, right) => left.startSeq - right.startSeq)
      : [];
    if (windows.length === 0) {
      sortBatchSlice(entries);
    } else {
      const grouped = windows.map((window) => ({ window, entries: [] }));
      const overflow = [];
      for (const entry of entries) {
        const orderIndex = Number.isFinite(entry?.orderIndex)
          ? Math.floor(entry.orderIndex)
          : null;
        if (!Number.isFinite(orderIndex)) {
          overflow.push(entry);
          continue;
        }
        const group = grouped.find(({ window }) => orderIndex >= window.startSeq && orderIndex <= window.endSeq);
        if (group) group.entries.push(entry);
        else overflow.push(entry);
      }
      const reordered = [];
      for (const group of grouped) {
        sortBatchSlice(group.entries);
        reordered.push(...group.entries);
      }
      if (overflow.length) {
        sortBatchSlice(overflow);
        reordered.push(...overflow);
      }
      for (let i = 0; i < reordered.length; i += 1) {
        entries[i] = reordered[i];
      }
    }
    entries.forEach((entry, index) => {
      entry.processingOrderIndex = index;
    });
  }

  if (envConfig?.verbose === true && batchMeta.size > 1 && allowReorder) {
    const keys = Array.from(batchMeta.keys()).sort();
    log(`[tree-sitter] Batching files by language: ${keys.join(', ')}.`);
  }
};

/**
 * Normalize a language list to supported tree-sitter ids.
 *
 * @param {Array<string>} languages
 * @returns {Array<string>}
 */
export const normalizeTreeSitterLanguages = (languages) => {
  const output = new Set();
  for (const language of languages || []) {
    if (TREE_SITTER_LANG_IDS.has(language)) output.add(language);
  }
  return Array.from(output).sort();
};

/**
 * Overwrite an entry's batch metadata from an explicit language list.
 *
 * @param {object} entry
 * @param {Array<string>} languages
 * @returns {void}
 */
export const updateEntryTreeSitterBatch = (entry, languages) => {
  const normalized = normalizeTreeSitterLanguages(languages);
  entry.treeSitterBatchLanguages = normalized;
  entry.treeSitterBatchKey = normalized.length ? normalized.join('+') : 'none';
  entry.treeSitterAllowedLanguages = normalized;
};

/**
 * Stable sort entries by defer flag, then batch key, then path.
 *
 * @param {Array<object>} entries
 * @returns {void}
 */
export const sortEntriesByTreeSitterBatchKey = (entries) => {
  entries.sort((a, b) => {
    const deferA = a.treeSitterDeferredToEnd ? 1 : 0;
    const deferB = b.treeSitterDeferredToEnd ? 1 : 0;
    if (deferA !== deferB) return deferA - deferB;
    const keyA = a.treeSitterBatchKey || 'none';
    const keyB = b.treeSitterBatchKey || 'none';
    const keyDelta = compareStrings(keyA, keyB);
    if (keyDelta !== 0) return keyDelta;
    return compareStrings(a.rel || '', b.rel || '');
  });
};

/**
 * Ensure all entries have monotonic order indexes and return the next slot.
 *
 * @param {Array<object>} entries
 * @returns {number}
 */
export const resolveNextOrderIndex = (entries) => {
  let nextOrderIndex = 0;
  for (const entry of entries || []) {
    if (!entry || typeof entry !== 'object') continue;
    if (!Number.isFinite(entry.orderIndex)) {
      const canonical = Number.isFinite(entry.canonicalOrderIndex) ? entry.canonicalOrderIndex : nextOrderIndex;
      entry.orderIndex = canonical;
    }
    nextOrderIndex = Math.max(nextOrderIndex, entry.orderIndex + 1);
  }
  return nextOrderIndex;
};

/**
 * Assign one-based `fileIndex` values in current array order.
 *
 * @param {Array<object>} entries
 * @returns {void}
 */
export const assignFileIndexes = (entries) => {
  if (!Array.isArray(entries)) return;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry || typeof entry !== 'object') continue;
    entry.fileIndex = i + 1;
  }
};

/**
 * Group contiguous entries by batch key.
 *
 * @param {Array<object>} entries
 * @returns {Array<{key:string,languages:Array<string>,entries:Array<object>}>}
 */
export const buildTreeSitterEntryBatches = (entries) => {
  const batches = [];
  let current = null;
  for (const entry of entries) {
    const key = entry.treeSitterBatchKey || 'none';
    const languages = Array.isArray(entry.treeSitterBatchLanguages) ? entry.treeSitterBatchLanguages : [];
    if (!current || current.key !== key) {
      current = { key, languages, entries: [] };
      batches.push(current);
    }
    current.entries.push(entry);
  }
  return batches;
};

/**
 * Collect distinct language ids referenced by entry batch metadata.
 *
 * @param {Array<object>} entries
 * @returns {Array<string>}
 */
export const collectTreeSitterBatchLanguages = (entries) => {
  const languages = new Set();
  for (const entry of entries || []) {
    const batchLanguages = Array.isArray(entry?.treeSitterBatchLanguages)
      ? entry.treeSitterBatchLanguages
      : [];
    for (const language of batchLanguages) {
      if (TREE_SITTER_LANG_IDS.has(language)) languages.add(language);
    }
  }
  return Array.from(languages).sort();
};

/**
 * Build a preload plan ordered by descending language frequency.
 *
 * @param {Array<object>} entries
 * @returns {{languages:Array<string>,counts:Map<string,number>}}
 */
export const resolveTreeSitterPreloadPlan = (entries) => {
  const counts = new Map();
  for (const entry of entries || []) {
    const batchLanguages = Array.isArray(entry?.treeSitterBatchLanguages)
      ? entry.treeSitterBatchLanguages
      : [];
    const seen = new Set();
    for (const language of batchLanguages) {
      if (!TREE_SITTER_LANG_IDS.has(language)) continue;
      if (seen.has(language)) continue;
      seen.add(language);
      counts.set(language, (counts.get(language) || 0) + 1);
    }
  }
  const ordered = Array.from(counts.entries())
    .sort((a, b) => {
      const countDelta = b[1] - a[1];
      if (countDelta !== 0) return countDelta;
      return compareStrings(a[0], b[0]);
    })
    .map(([language]) => language);
  return { languages: ordered, counts };
};

/**
 * Placeholder preload hook for tree-sitter language batches.
 *
 * @param {{languages:Array<string>,treeSitter?:object,log?:(line:string)=>void}} input
 * @returns {Promise<void>}
 */
export const preloadTreeSitterBatch = async ({ languages, treeSitter, log: logFn }) => {
  if (!treeSitter || treeSitter.enabled === false) return;
  if (!Array.isArray(languages) || !languages.length) return;
  void logFn;
};
