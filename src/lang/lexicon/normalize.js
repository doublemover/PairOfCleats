const ASCII_TOKEN_PATTERN = /^[\x21-\x7E]+$/;
const REQUIRED_LIST_KEYS = ['keywords', 'literals'];
const OPTIONAL_LIST_KEYS = ['types', 'builtins', 'modules'];

const normalizeTokenList = (listName, value, { strict = true } = {}) => {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    if (!strict) return [];
    throw new Error(`${listName} must be an array`);
  }
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== 'string') {
      if (strict) throw new Error(`${listName} contains a non-string entry`);
      continue;
    }
    const token = raw.trim();
    if (!token) {
      if (strict) throw new Error(`${listName} contains an empty token`);
      continue;
    }
    if (token !== raw) {
      if (strict) throw new Error(`${listName} contains untrimmed token "${raw}"`);
      continue;
    }
    if (token !== token.toLowerCase()) {
      if (strict) throw new Error(`${listName} contains non-lowercase token "${raw}"`);
      continue;
    }
    if (!ASCII_TOKEN_PATTERN.test(token)) {
      if (strict) throw new Error(`${listName} contains non-ASCII token "${raw}"`);
      continue;
    }
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
};

const buildStopwords = ({ keywords, literals, types, builtins }) => ({
  relations: new Set([...keywords, ...literals]),
  ranking: new Set([...keywords, ...literals, ...types, ...builtins]),
  chargrams: new Set([...keywords, ...literals])
});

export const normalizeLookupToken = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  return trimmed || '';
};

export const buildBuiltInGenericLexiconPayload = () => ({
  formatVersion: 1,
  languageId: '_generic',
  keywords: ['break', 'case', 'catch', 'class', 'const', 'continue', 'do', 'else', 'for', 'function', 'if', 'import', 'let', 'new', 'return', 'switch', 'throw', 'try', 'var', 'while'],
  literals: ['false', 'nil', 'none', 'null', 'true', 'undefined'],
  types: [],
  builtins: [],
  modules: [],
  notes: ['Built-in fallback lexicon payload.']
});

export const normalizeWordlistPayload = (payload, { filePath = null, strict = true } = {}) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('wordlist payload must be an object');
  }

  if (Number(payload.formatVersion) !== 1) {
    throw new Error(`unsupported formatVersion "${payload.formatVersion}"`);
  }

  const languageId = typeof payload.languageId === 'string' ? payload.languageId.trim() : '';
  if (!languageId) {
    throw new Error('languageId is required');
  }

  const normalizedLists = {};
  for (const key of REQUIRED_LIST_KEYS) {
    if (!Array.isArray(payload[key])) {
      throw new Error(`${key} is required`);
    }
    normalizedLists[key] = normalizeTokenList(key, payload[key], { strict });
  }
  for (const key of OPTIONAL_LIST_KEYS) {
    normalizedLists[key] = normalizeTokenList(key, payload[key], { strict });
  }

  const notes = Array.isArray(payload.notes)
    ? payload.notes.filter((entry) => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean)
    : [];

  const stopwords = buildStopwords({
    keywords: normalizedLists.keywords,
    literals: normalizedLists.literals,
    types: normalizedLists.types,
    builtins: normalizedLists.builtins
  });

  return {
    formatVersion: 1,
    languageId,
    sourcePath: filePath || null,
    keywords: new Set(normalizedLists.keywords),
    literals: new Set(normalizedLists.literals),
    types: new Set(normalizedLists.types),
    builtins: new Set(normalizedLists.builtins),
    modules: new Set(normalizedLists.modules),
    notes,
    stopwords,
    counts: {
      keywords: normalizedLists.keywords.length,
      literals: normalizedLists.literals.length,
      types: normalizedLists.types.length,
      builtins: normalizedLists.builtins.length,
      modules: normalizedLists.modules.length,
      stopwordsRelations: stopwords.relations.size,
      stopwordsRanking: stopwords.ranking.size,
      stopwordsChargrams: stopwords.chargrams.size
    }
  };
};
