import { compareStrings } from '../../../../../shared/sort.js';
import { fileExt } from '../../../../../shared/files.js';
import { log } from '../../../../../shared/progress.js';
import { getLanguageForFile } from '../../../../language-registry.js';
import {
  preloadTreeSitterLanguages,
  TREE_SITTER_LANGUAGE_IDS
} from '../../../../../lang/tree-sitter.js';

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
  const primary = resolveTreeSitterLanguageForEntry(entry);
  if (!primary) return { key: 'none', languages: [] };
  if (treeSitterOptions?.languagePasses !== false) {
    return { key: primary, languages: [primary] };
  }
  const languages = new Set([primary]);
  if (treeSitterOptions?.batchEmbeddedLanguages !== false && primary === 'html') {
    const maxLoaded = Number.isFinite(treeSitterOptions?.maxLoadedLanguages)
      ? Math.max(1, Math.floor(treeSitterOptions.maxLoadedLanguages))
      : null;
    const embeddedBudget = maxLoaded ? Math.max(0, maxLoaded - 1) : null;
    let embeddedCount = 0;
    for (const lang of HTML_EMBEDDED_LANGUAGES) {
      if (embeddedBudget != null && embeddedCount >= embeddedBudget) break;
      if (!TREE_SITTER_LANG_IDS.has(lang)) continue;
      languages.add(lang);
      embeddedCount += 1;
    }
  }
  const normalized = Array.from(languages).filter((lang) => TREE_SITTER_LANG_IDS.has(lang)).sort();
  const key = normalized.length ? normalized.join('+') : 'none';
  return { key, languages: normalized };
};

export const applyTreeSitterBatching = (entries, treeSitterOptions, envConfig, { allowReorder = true } = {}) => {
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
    entries.sort((a, b) => {
      const keyA = a.treeSitterBatchKey || 'none';
      const keyB = b.treeSitterBatchKey || 'none';
      const keyDelta = compareStrings(keyA, keyB);
      if (keyDelta !== 0) return keyDelta;
      return compareStrings(a.rel || '', b.rel || '');
    });
    entries.forEach((entry, index) => {
      entry.orderIndex = index;
    });
  }

  if (envConfig?.verbose === true && batchMeta.size > 1 && allowReorder) {
    const keys = Array.from(batchMeta.keys()).sort();
    log(`[tree-sitter] Batching files by language: ${keys.join(', ')}.`);
  }
};

const normalizeTreeSitterLanguages = (languages) => {
  const output = new Set();
  for (const language of languages || []) {
    if (TREE_SITTER_LANG_IDS.has(language)) output.add(language);
  }
  return Array.from(output).sort();
};

export const updateEntryTreeSitterBatch = (entry, languages) => {
  const normalized = normalizeTreeSitterLanguages(languages);
  entry.treeSitterBatchLanguages = normalized;
  entry.treeSitterBatchKey = normalized.length ? normalized.join('+') : 'none';
  entry.treeSitterAllowedLanguages = normalized;
};

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

export const resolveNextOrderIndex = (entries) => {
  let nextOrderIndex = 0;
  for (const entry of entries || []) {
    if (!entry || typeof entry !== 'object') continue;
    if (!Number.isFinite(entry.orderIndex)) {
      entry.orderIndex = nextOrderIndex;
    }
    nextOrderIndex = Math.max(nextOrderIndex, entry.orderIndex + 1);
  }
  return nextOrderIndex;
};

export const assignFileIndexes = (entries) => {
  if (!Array.isArray(entries)) return;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry || typeof entry !== 'object') continue;
    entry.fileIndex = i + 1;
  }
};

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

export const preloadTreeSitterBatch = async ({ languages, treeSitter, log: logFn }) => {
  if (!treeSitter || treeSitter.enabled === false) return;
  if (!Array.isArray(languages) || !languages.length) return;
  try {
    await preloadTreeSitterLanguages(languages, {
      log: logFn,
      parallel: false,
      maxLoadedLanguages: treeSitter.maxLoadedLanguages
    });
  } catch {
    // Best-effort preload; parsing will fall back if a grammar fails to load.
  }
};
