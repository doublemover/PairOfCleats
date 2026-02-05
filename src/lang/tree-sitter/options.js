import { TREE_SITTER_LANGUAGE_IDS } from './config.js';

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

const DEFAULT_DISABLED_LANGUAGES = new Set();

export function isTreeSitterEnabled(options, languageId) {
  const config = options?.treeSitter || {};
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
  if (languageId
    && DEFAULT_DISABLED_LANGUAGES.has(languageId)
    && !Object.prototype.hasOwnProperty.call(langs, languageId)) {
    return false;
  }
  if (languageId && Object.prototype.hasOwnProperty.call(langs, languageId)) {
    return normalizeEnabled(langs[languageId]);
  }
  if ((languageId === 'cpp' || languageId === 'objc')
    && Object.prototype.hasOwnProperty.call(langs, 'clike')) {
    return normalizeEnabled(langs.clike);
  }
  return true;
}

export function resolveEnabledTreeSitterLanguages(config = {}) {
  const options = { treeSitter: config };
  return TREE_SITTER_LANGUAGE_IDS.filter((id) => isTreeSitterEnabled(options, id));
}
