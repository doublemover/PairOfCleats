import { TREE_SITTER_LANGUAGE_IDS } from './config.js';

function normalizeEnabled(value) {
  if (value === false) return false;
  if (value === 'off') return false;
  return true;
}

export function isTreeSitterEnabled(options, languageId) {
  const config = options?.treeSitter || {};
  const enabled = normalizeEnabled(config.enabled);
  if (!enabled) return false;
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

export function resolveEnabledTreeSitterLanguages(config = {}) {
  const options = { treeSitter: config };
  return TREE_SITTER_LANGUAGE_IDS.filter((id) => isTreeSitterEnabled(options, id));
}
