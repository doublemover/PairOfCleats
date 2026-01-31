const LANGUAGE_ALIASES = new Map([
  ['js', 'javascript'],
  ['jsx', 'javascript'],
  ['javascript', 'javascript'],
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['typescript', 'typescript']
]);

export const CODE_DICT_DIR_NAME = 'code-dicts';
export const CODE_DICT_COMMON_FILE = 'common-code.txt';

export const DEFAULT_CODE_DICT_LANGUAGES = Object.freeze(['typescript']);

export const normalizeCodeDictLanguage = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  return LANGUAGE_ALIASES.get(trimmed) || trimmed;
};

export const normalizeCodeDictLanguages = (languages) => {
  if (!languages) return new Set();
  const entries = Array.isArray(languages)
    ? languages
    : (languages instanceof Set ? Array.from(languages) : [languages]);
  const out = new Set();
  for (const entry of entries) {
    const normalized = normalizeCodeDictLanguage(entry);
    if (normalized) out.add(normalized);
  }
  return out;
};
