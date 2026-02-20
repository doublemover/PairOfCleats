import {
  buildTreeSitterChunks,
  getTreeSitterStats
} from '../tree-sitter.js';

function normalizeEnabled(value) {
  if (value === false) return false;
  if (value === true) return true;

  if (typeof value === 'number') {
    if (value === 0) return false;
    if (value === 1) return true;
  }

  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'off' || v === 'false' || v === '0' || v === 'no') return false;
    if (v === 'on' || v === 'true' || v === '1' || v === 'yes') return true;
  }

  return true;
}

function isLanguageEnabled(treeSitterConfig, languageId) {
  const config = treeSitterConfig && typeof treeSitterConfig === 'object' ? treeSitterConfig : {};
  const enabled = normalizeEnabled(config.enabled);
  if (!enabled) return false;

  const allowedRaw = config.allowedLanguages;
  if (Array.isArray(allowedRaw) && allowedRaw.length) {
    const allowed = new Set(allowedRaw);
    if (languageId) {
      if (allowed.has(languageId)) {
        // allowed
      } else if ((languageId === 'cpp' || languageId === 'objc') && allowed.has('clike')) {
        // allow clike gate for cpp/objc
      } else {
        return false;
      }
    }
  }
  const langs = config.languages || {};
  if (languageId && Object.prototype.hasOwnProperty.call(langs, languageId)) {
    return normalizeEnabled(langs[languageId]);
  }
  if ((languageId === 'cpp' || languageId === 'objc')
    && Object.prototype.hasOwnProperty.call(langs, 'clike')) {
    return normalizeEnabled(langs.clike);
  }
  return true;
}

function resolveLanguageForExt(languageId, ext) {
  const normalizedExt = typeof ext === 'string' ? ext.toLowerCase() : '';
  if (normalizedExt === '.tsx') return 'tsx';
  if (normalizedExt === '.jsx') return 'jsx';
  if (normalizedExt === '.ts' || normalizedExt === '.cts' || normalizedExt === '.mts') return 'typescript';
  if (normalizedExt === '.js' || normalizedExt === '.mjs' || normalizedExt === '.cjs' || normalizedExt === '.jsm') {
    return 'javascript';
  }
  if (normalizedExt === '.py') return 'python';
  if (normalizedExt === '.json') return 'json';
  if (normalizedExt === '.yaml' || normalizedExt === '.yml') return 'yaml';
  if (normalizedExt === '.toml') return 'toml';
  if (normalizedExt === '.xml') return 'xml';
  if (normalizedExt === '.md' || normalizedExt === '.mdx') return 'markdown';
  if (languageId) return languageId;
  if (!normalizedExt) return null;
  if (normalizedExt === '.m' || normalizedExt === '.mm') return 'objc';
  if (normalizedExt === '.cpp' || normalizedExt === '.cc' || normalizedExt === '.cxx'
    || normalizedExt === '.hpp' || normalizedExt === '.hh' || normalizedExt === '.hxx') return 'cpp';
  if (normalizedExt === '.c' || normalizedExt === '.h') return 'clike';
  return null;
}

/**
 * Piscina worker entrypoint.
 *
 * Note: Worker threads do not share the main thread's module state.
 * Parsing always uses the native tree-sitter runtime in-thread.
 */
export async function parseTreeSitter(payload = {}) {
  const { text = '', languageId = null, ext = null, treeSitter = null } = payload;
  const strict = treeSitter?.strict === true;

  const resolvedId = resolveLanguageForExt(languageId, ext);
  if (resolvedId && !isLanguageEnabled(treeSitter, resolvedId)) {
    return null;
  }

  try {
    const result = buildTreeSitterChunks({
      text,
      languageId,
      ext,
      options: { treeSitter }
    });
    if (strict && (!Array.isArray(result) || result.length === 0)) {
      throw new Error(`Tree-sitter worker returned no chunks for ${resolvedId || languageId || 'unknown'}.`);
    }
    return result;
  } catch (err) {
    if (strict) throw err;
    return null;
  }
}

export function treeSitterWorkerStats() {
  return getTreeSitterStats();
}
