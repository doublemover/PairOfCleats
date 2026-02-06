import { SimpleMinHash } from '../minhash.js';
import { CLIKE_RESERVED_WORDS, CPP_RESERVED_WORDS, OBJC_RESERVED_WORDS, STOP, SYN } from '../constants.js';
import { extractNgrams, extractPunctuationTokens, splitId, splitWordsWithDict, stem } from '../../shared/tokenize.js';
import { hashTokenId } from '../../shared/token-id.js';
import { buildChargramHashSet } from '../../shared/chargram-hash.js';
import { normalizeCodeDictLanguage } from '../../shared/code-dictionaries.js';
import { COMMON_NAME_NODE_TYPES } from '../../lang/tree-sitter/ast.js';
import { getTreeSitterParser } from '../../lang/tree-sitter/runtime.js';
import { isTreeSitterEnabled } from '../../lang/tree-sitter/options.js';
import { resolveTreeSitterLanguageForSegment } from './file-processor/tree-sitter.js';
import { JS_RESERVED_WORDS } from '../../lang/javascript/constants.js';
import { TS_RESERVED_WORDS } from '../../lang/typescript/constants.js';
import { PYTHON_RESERVED_WORDS } from '../../lang/python/constants.js';
import { GO_RESERVED_WORDS } from '../../lang/go.js';
import { JAVA_RESERVED_WORDS } from '../../lang/java.js';
import { KOTLIN_RESERVED_WORDS } from '../../lang/kotlin.js';
import { CSHARP_RESERVED_WORDS } from '../../lang/csharp.js';
import { PHP_RESERVED_WORDS } from '../../lang/php.js';
import { RUBY_RESERVED_WORDS } from '../../lang/ruby.js';
import { LUA_RESERVED_WORDS } from '../../lang/lua.js';
import { PERL_RESERVED_WORDS } from '../../lang/perl.js';
import { SHELL_RESERVED_WORDS } from '../../lang/shell.js';
import { RUST_RESERVED_WORDS } from '../../lang/rust.js';
import { SWIFT_RESERVED_WORDS } from '../../lang/swift.js';
import { SQL_RESERVED_WORDS } from '../../lang/sql.js';
import { CSS_RESERVED_WORDS } from '../../lang/css.js';
import { HTML_RESERVED_WORDS } from '../../lang/html.js';

const normalizeRange = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeDictWords = (dictWordsRaw) => {
  if (dictWordsRaw && typeof dictWordsRaw.has === 'function' && typeof dictWordsRaw.size === 'number') {
    return dictWordsRaw;
  }
  if (dictWordsRaw instanceof Set) {
    return dictWordsRaw;
  }
  if (Array.isArray(dictWordsRaw)) {
    return new Set(dictWordsRaw);
  }
  return new Set();
};

const normalizeCodeDictLanguages = (raw) => {
  if (!raw) return new Set();
  const entries = Array.isArray(raw) ? raw : (raw instanceof Set ? Array.from(raw) : [raw]);
  const out = new Set();
  for (const entry of entries) {
    const normalized = normalizeCodeDictLanguage(entry);
    if (normalized) out.add(normalized);
  }
  return out;
};

const normalizeCodeDictByLanguage = (raw) => {
  if (!raw) return new Map();
  const entries = raw instanceof Map ? Array.from(raw.entries()) : Object.entries(raw);
  const out = new Map();
  for (const [lang, words] of entries) {
    const normalized = normalizeCodeDictLanguage(lang);
    if (!normalized) continue;
    const dict = normalizeDictWords(words);
    if (dict.size) out.set(normalized, dict);
  }
  return out;
};

const getDictMaxTokenLength = (dict) => {
  if (!dict) return 0;
  const cached = dict.__maxTokenLength;
  if (Number.isFinite(cached) && cached > 0) return cached;
  const altMax = Number.isFinite(dict.maxLen) && dict.maxLen > 0 ? dict.maxLen : 0;
  if (altMax) return altMax;
  if (dict.__sharedDict) return 0;
  if (typeof dict[Symbol.iterator] !== 'function') return 0;
  let maxLen = 0;
  for (const word of dict) {
    if (typeof word === 'string' && word.length > maxLen) maxLen = word.length;
  }
  dict.__maxTokenLength = maxLen;
  return maxLen;
};

const buildCompositeDict = (baseDict, commonDict, languageDict) => {
  if (!commonDict?.size && !languageDict?.size) return baseDict;
  const size = (baseDict?.size || 0) + (commonDict?.size || 0) + (languageDict?.size || 0);
  const maxLen = Math.max(
    getDictMaxTokenLength(baseDict),
    getDictMaxTokenLength(commonDict),
    getDictMaxTokenLength(languageDict)
  );
  return {
    size,
    maxLen,
    __maxTokenLength: maxLen,
    has: (value) => (
      (baseDict?.has && baseDict.has(value))
      || (commonDict?.has && commonDict.has(value))
      || (languageDict?.has && languageDict.has(value))
    )
  };
};

const RESERVED_WORDS_BY_LANGUAGE = new Map([
  ['javascript', JS_RESERVED_WORDS],
  ['typescript', TS_RESERVED_WORDS],
  ['tsx', TS_RESERVED_WORDS],
  ['jsx', JS_RESERVED_WORDS],
  ['clike', CLIKE_RESERVED_WORDS],
  ['cpp', CPP_RESERVED_WORDS],
  ['objc', OBJC_RESERVED_WORDS],
  ['python', PYTHON_RESERVED_WORDS],
  ['go', GO_RESERVED_WORDS],
  ['java', JAVA_RESERVED_WORDS],
  ['kotlin', KOTLIN_RESERVED_WORDS],
  ['csharp', CSHARP_RESERVED_WORDS],
  ['php', PHP_RESERVED_WORDS],
  ['ruby', RUBY_RESERVED_WORDS],
  ['lua', LUA_RESERVED_WORDS],
  ['perl', PERL_RESERVED_WORDS],
  ['shell', SHELL_RESERVED_WORDS],
  ['rust', RUST_RESERVED_WORDS],
  ['swift', SWIFT_RESERVED_WORDS],
  ['sql', SQL_RESERVED_WORDS],
  ['css', CSS_RESERVED_WORDS],
  ['scss', CSS_RESERVED_WORDS],
  ['html', HTML_RESERVED_WORDS]
]);

const LITERAL_KEYWORDS = new Set([
  'true',
  'false',
  'null',
  'nil',
  'none',
  'undefined'
]);

const OPERATOR_TOKEN_RE = /^[=<>!:+\-*/%&|^~.?]{1,4}$|^[()[\]{}.,;:]$/;
const NUMBER_TOKEN_RE = /^-?(?:0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d+(?:\.\d+)?)(?:e[+-]?\d+)?$/i;

const normalizeLanguageId = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const resolveKeywordSet = (languageId) => {
  const normalized = normalizeLanguageId(languageId);
  if (!normalized) return null;
  return RESERVED_WORDS_BY_LANGUAGE.get(normalized) || null;
};

const isOperatorToken = (token) => typeof token === 'string' && OPERATOR_TOKEN_RE.test(token);

const isNumericToken = (token) => {
  if (typeof token !== 'string') return false;
  const normalized = token.replace(/_/g, '');
  if (!normalized) return false;
  return NUMBER_TOKEN_RE.test(normalized);
};

const isIdentifierNodeType = (type) => {
  if (!type) return false;
  if (COMMON_NAME_NODE_TYPES.has(type)) return true;
  if (type.endsWith('_identifier')) return true;
  if (type.endsWith('identifier')) return true;
  return false;
};

const isLiteralNodeType = (type, raw) => {
  const normalized = typeof type === 'string' ? type.toLowerCase() : '';
  if (!normalized && !raw) return false;
  if (normalized.includes('string')) return true;
  if (normalized.includes('char')) return true;
  if (normalized.includes('regex')) return true;
  if (normalized.includes('number') || normalized.includes('integer') || normalized.includes('float')
    || normalized.includes('decimal')) return true;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return false;
  if (trimmed.startsWith('"') || trimmed.startsWith('\'') || trimmed.startsWith('`')) return true;
  if (isNumericToken(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  if (LITERAL_KEYWORDS.has(lower)) return true;
  return false;
};

const isKeywordNodeType = (type, raw, keywordSet) => {
  if (!keywordSet || typeof keywordSet.has !== 'function') return false;
  if (typeof type === 'string' && keywordSet.has(type)) return true;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (normalized && keywordSet.has(normalized)) return true;
  }
  return false;
};

const buildTokenSetForLeaf = (raw, dictWords, dictConfig, ext) => {
  if (!raw) return [];
  return buildTokenSequence({
    text: raw,
    mode: 'code',
    ext,
    dictWords,
    dictConfig,
    includeSeq: false
  }).tokens;
};

const classifyTokensWithTreeSitter = ({
  text,
  languageId,
  ext,
  dictWords,
  dictConfig,
  keywordSet,
  treeSitter
}) => {
  if (!text) return null;
  const resolvedLang = resolveTreeSitterLanguageForSegment(languageId, ext);
  if (!resolvedLang) return null;
  const options = treeSitter ? { treeSitter } : null;
  if (options && !isTreeSitterEnabled(options, resolvedLang)) return null;
  if (treeSitter) {
    const maxBytesRaw = Number(treeSitter.maxBytes);
    if (Number.isFinite(maxBytesRaw) && maxBytesRaw > 0) {
      const byteLen = Buffer.byteLength(text, 'utf8');
      if (byteLen > maxBytesRaw) return null;
    }
  }
  const parser = getTreeSitterParser(resolvedLang, { treeSitter, suppressMissingLog: true });
  if (!parser) return null;
  let tree;
  try {
    tree = parser.parse(text);
  } catch {
    return null;
  }
  const root = tree?.rootNode;
  if (!root) return null;

  const identifiers = new Set();
  const keywords = new Set();
  const operators = new Set();
  const literals = new Set();

  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    const childCount = Number.isFinite(node.childCount)
      ? node.childCount
      : (Number.isFinite(node.namedChildCount) ? node.namedChildCount : 0);
    if (childCount > 0) {
      for (let i = childCount - 1; i >= 0; i -= 1) {
        const child = typeof node.child === 'function'
          ? node.child(i)
          : (typeof node.namedChild === 'function' ? node.namedChild(i) : null);
        if (child) stack.push(child);
      }
      continue;
    }

    const isMissing = node.isMissing === true
      || (typeof node.isMissing === 'function' && node.isMissing());
    if (isMissing) continue;
    const isExtra = node.isExtra === true
      || (typeof node.isExtra === 'function' && node.isExtra());
    if (isExtra) continue;

    const raw = text.slice(node.startIndex, node.endIndex);
    if (!raw || !raw.trim()) continue;

    const type = typeof node.type === 'string' ? node.type : '';
    let bucket = null;
    if (isLiteralNodeType(type, raw)) {
      bucket = 'literal';
    } else if (isOperatorToken(raw) || (type && type.toLowerCase().includes('operator'))) {
      bucket = 'operator';
    } else if (isKeywordNodeType(type, raw, keywordSet)) {
      bucket = 'keyword';
    } else if (isIdentifierNodeType(type)) {
      bucket = 'identifier';
    }

    const leafTokens = buildTokenSetForLeaf(raw, dictWords, dictConfig, ext);
    if (!leafTokens.length) continue;
    for (const tok of leafTokens) {
      if (bucket === 'literal') literals.add(tok);
      else if (bucket === 'operator') operators.add(tok);
      else if (bucket === 'keyword') keywords.add(tok);
      else if (bucket === 'identifier') identifiers.add(tok);
    }
  }

  if (tree && typeof tree.delete === 'function') {
    try {
      tree.delete();
    } catch {
      // ignore
    }
  }

  return {
    identifiers,
    keywords,
    operators,
    literals
  };
};

export const classifyTokenBuckets = ({
  text,
  tokens,
  languageId,
  ext,
  dictWords,
  dictConfig,
  context
}) => {
  if (!Array.isArray(tokens) || !tokens.length) {
    return { identifierTokens: [], keywordTokens: [], operatorTokens: [], literalTokens: [] };
  }
  const keywordSet = resolveKeywordSet(languageId);
  const treeSitterConfig = context?.treeSitter || null;
  const treeSitterSets = classifyTokensWithTreeSitter({
    text,
    languageId,
    ext,
    dictWords,
    dictConfig,
    keywordSet,
    treeSitter: treeSitterConfig
  });

  const identifierTokens = [];
  const keywordTokens = [];
  const operatorTokens = [];
  const literalTokens = [];

  const hasTreeSitter = !!treeSitterSets;
  for (const token of tokens) {
    if (!token) continue;
    const normalized = typeof token === 'string' ? token.toLowerCase() : token;
    let bucket = null;
    if (hasTreeSitter && treeSitterSets) {
      if (treeSitterSets.operators?.has(token)) bucket = 'operator';
      else if (treeSitterSets.literals?.has(token) || treeSitterSets.literals?.has(normalized)) bucket = 'literal';
      else if (treeSitterSets.keywords?.has(token) || treeSitterSets.keywords?.has(normalized)) bucket = 'keyword';
      else if (treeSitterSets.identifiers?.has(token) || treeSitterSets.identifiers?.has(normalized)) {
        bucket = 'identifier';
      }
    }
    if (!bucket) {
      if (isOperatorToken(token)) bucket = 'operator';
      else if (isNumericToken(token) || (typeof normalized === 'string' && LITERAL_KEYWORDS.has(normalized))) {
        bucket = 'literal';
      } else if (keywordSet && typeof keywordSet.has === 'function' && keywordSet.has(normalized)) {
        bucket = 'keyword';
      } else {
        bucket = 'identifier';
      }
    }
    if (bucket === 'operator') operatorTokens.push(token);
    else if (bucket === 'literal') literalTokens.push(token);
    else if (bucket === 'keyword') keywordTokens.push(token);
    else identifierTokens.push(token);
  }

  return {
    identifierTokens,
    keywordTokens,
    operatorTokens,
    literalTokens
  };
};

/**
 * Build a tokenization context shared across chunks.
 * @param {{dictWords:Set<string>|string[]|{size:number,has:function},dictConfig:object,postingsConfig:object}} input
 * @returns {object}
 */
export function createTokenizationContext(input) {
  const dictWords = normalizeDictWords(input?.dictWords);
  const codeDictWords = normalizeDictWords(input?.codeDictWords);
  const codeDictWordsByLanguage = normalizeCodeDictByLanguage(input?.codeDictWordsByLanguage);
  const codeDictLanguages = input?.codeDictLanguages == null
    ? null
    : normalizeCodeDictLanguages(input.codeDictLanguages);
  const dictConfig = input?.dictConfig || {};
  const postingsConfig = input?.postingsConfig || {};
  const tokenClassification = postingsConfig?.tokenClassification && typeof postingsConfig.tokenClassification === 'object'
    ? postingsConfig.tokenClassification
    : { enabled: false };
  const treeSitter = input?.treeSitter || null;
  const phraseMinN = normalizeRange(postingsConfig.phraseMinN, 2);
  const phraseMaxN = Math.max(phraseMinN, normalizeRange(postingsConfig.phraseMaxN, 4));
  const chargramMinN = normalizeRange(postingsConfig.chargramMinN, 3);
  const chargramMaxN = Math.max(chargramMinN, normalizeRange(postingsConfig.chargramMaxN, 5));
  const chargramMaxTokenLength = postingsConfig.chargramMaxTokenLength == null
    ? null
    : Math.max(2, Math.floor(Number(postingsConfig.chargramMaxTokenLength)));
  const chargramSourceRaw = typeof postingsConfig.chargramSource === 'string'
    ? postingsConfig.chargramSource.trim().toLowerCase()
    : '';
  const chargramSource = ['full', 'fields'].includes(chargramSourceRaw)
    ? chargramSourceRaw
    : 'fields';
  return {
    dictWords,
    codeDictWords,
    codeDictWordsByLanguage,
    codeDictLanguages,
    codeDictCache: new Map(),
    dictConfig,
    phraseMinN,
    phraseMaxN,
    chargramMinN,
    chargramMaxN,
    chargramMaxTokenLength,
    chargramSource,
    phraseEnabled: postingsConfig.enablePhraseNgrams !== false,
    chargramEnabled: postingsConfig.enableChargrams !== false,
    tokenClassification,
    treeSitter
  };
}

/**
 * Allocate reusable buffers for tokenization to reduce allocations.
 * @returns {{tokens:string[],seq:string[],scratch:string[],scratch2:string[],chargramSet:Set<string>,minhash:SimpleMinHash}}
 */
export function createTokenizationBuffers() {
  return {
    tokens: [],
    seq: [],
    tokenIds: [],
    scratch: [],
    scratch2: [],
    chargramSet: new Set(),
    minhash: new SimpleMinHash()
  };
}

/**
 * Resolve dictionary words for tokenization based on mode/language.
 * @param {{context:object,mode:string,languageId?:string|null}} input
 * @returns {{size:number,has:function}|Set<string>}
 */
export function resolveTokenDictWords({ context, mode, languageId = null }) {
  const baseDict = context?.dictWords || new Set();
  if (mode !== 'code') return baseDict;
  const allowed = context?.codeDictLanguages;
  const normalizedLang = normalizeCodeDictLanguage(languageId);
  if (allowed instanceof Set) {
    if (!allowed.size) return baseDict;
    if (!normalizedLang || !allowed.has(normalizedLang)) return baseDict;
  }
  const commonDict = context?.codeDictWords;
  const languageDict = normalizedLang
    ? context?.codeDictWordsByLanguage?.get(normalizedLang)
    : null;
  if (!commonDict?.size && !languageDict?.size) return baseDict;
  const cache = context?.codeDictCache;
  const cacheKey = normalizedLang || '__common__';
  if (cache?.has(cacheKey)) return cache.get(cacheKey);
  const combined = buildCompositeDict(baseDict, commonDict, languageDict);
  if (cache) cache.set(cacheKey, combined);
  return combined;
}

const normalizeToken = (value) => {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 127) return value.normalize('NFKD');
  }
  return value;
};

/**
 * Build tokens and optional synonym-expanded sequence for indexing.
 * @param {{text:string,mode:'code'|'prose',ext?:string,dictWords:Set<string>|{size:number,has:function},dictConfig:object,buffers?:object,includeSeq?:boolean}} input
 * @returns {{tokens:string[],seq:string[]}}
 */
export function buildTokenSequence({
  text,
  mode,
  ext,
  dictWords,
  dictConfig,
  buffers = null,
  includeSeq = true
}) {
  const useBuffers = !!buffers;
  const tokensOut = useBuffers ? buffers.tokens : [];
  const seqOut = includeSeq ? (useBuffers ? buffers.seq : []) : null;
  const scratch = useBuffers ? buffers.scratch : [];
  const scratch2 = useBuffers ? buffers.scratch2 : [];
  if (useBuffers) {
    tokensOut.length = 0;
    if (buffers.seq) buffers.seq.length = 0;
    scratch.length = 0;
    scratch2.length = 0;
  }

  const baseTokens = splitId(text);
  for (const token of baseTokens) {
    scratch.push(normalizeToken(token));
  }
  if (mode === 'code') {
    const punctuation = extractPunctuationTokens(text);
    for (const token of punctuation) scratch.push(token);
  }

  let working = scratch;
  if (!(mode === 'prose' && ext === '.md')) {
    for (const token of working) {
      const parts = splitWordsWithDict(token, dictWords, dictConfig);
      if (Array.isArray(parts) && parts.length) {
        for (const part of parts) scratch2.push(part);
      }
    }
    working = scratch2;
  }

  if (mode === 'prose') {
    for (const token of working) {
      if (STOP.has(token)) continue;
      tokensOut.push(token);
      tokensOut.push(stem(token));
    }
  } else {
    for (const token of working) tokensOut.push(token);
  }

  let hasSynonyms = false;
  if (includeSeq) {
    for (const token of tokensOut) {
      if (SYN[token]) {
        hasSynonyms = true;
        break;
      }
    }
    if (hasSynonyms) {
      for (const token of tokensOut) {
        seqOut.push(token);
        if (SYN[token]) seqOut.push(SYN[token]);
      }
    }
  }

  // When buffers are supplied we still return cloned output arrays so callers
  // can retain per-chunk token lists without being mutated by the next chunk.
  const tokens = useBuffers ? tokensOut.slice() : tokensOut;
  if (!includeSeq) {
    return { tokens, seq: [] };
  }
  if (!hasSynonyms) {
    return { tokens, seq: tokens };
  }
  return {
    tokens,
    seq: useBuffers ? seqOut.slice() : seqOut
  };
}

/**
 * Build hashed chargrams from tokens with configurable n-gram limits.
 * @param {string[]} tokens
 * @param {{chargramMinN:number,chargramMaxN:number,chargramMaxTokenLength?:number}} options
 * @param {{chargramSet:Set<string>}|null} [buffers]
 * @returns {string[]}
 */
export function buildChargramsFromTokens(tokens, options, buffers = null) {
  const { chargramMinN, chargramMaxN, chargramMaxTokenLength } = options;
  const charSet = buildChargramHashSet(tokens, {
    minN: chargramMinN,
    maxN: chargramMaxN,
    maxTokenLength: Number.isFinite(chargramMaxTokenLength) ? chargramMaxTokenLength : null
  }, buffers);
  const out = Array.from(charSet);
  if (buffers?.chargramSet) charSet.clear();
  return out;
}

const computeTokenStats = (tokens) => {
  const freq = Object.create(null);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    freq[token] = (freq[token] || 0) + 1;
  }
  const counts = Object.values(freq);
  const unique = counts.length;
  let sum = 0;
  for (let i = 0; i < counts.length; i += 1) sum += counts[i];
  let entropy = 0;
  if (sum) {
    for (let i = 0; i < counts.length; i += 1) {
      const ratio = counts[i] / sum;
      entropy -= ratio * Math.log2(ratio);
    }
  }
  return { unique, entropy, sum };
};

/**
 * Tokenize chunk text into tokens/sequence and a minhash signature.
 *
 * NOTE: We intentionally do not materialize phrase ngrams or chargrams here. Those are
 * derived (and often very large) and should only exist as short-lived locals during
 * postings construction to avoid retaining them on chunk payloads.
 * @param {{text:string,mode:'code'|'prose',ext:string,context:object}} input
 * @returns {{tokens:string[],seq:string[],minhashSig:number[],stats:object}}
 */
export function tokenizeChunkText(input) {
  const { text, mode, ext, context, buffers = null, languageId = null } = input;
  const dictConfig = context?.dictConfig || {};
  const dictWords = resolveTokenDictWords({ context, mode, languageId });

  const { tokens, seq } = buildTokenSequence({
    text,
    mode,
    ext,
    dictWords,
    dictConfig,
    buffers
  });

  const tokenIdsOut = buffers?.tokenIds || [];
  if (buffers?.tokenIds) tokenIdsOut.length = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    tokenIdsOut.push(hashTokenId(tokens[i]));
  }
  const tokenIds = buffers?.tokenIds ? tokenIdsOut.slice() : tokenIdsOut;

  const classificationEnabled = context?.tokenClassification?.enabled === true && mode === 'code';
  const classification = classificationEnabled
    ? classifyTokenBuckets({
      text,
      tokens,
      languageId,
      ext,
      dictWords,
      dictConfig,
      context
    })
    : null;

  // Phrase ngrams and chargrams are built in appendChunk() where they can be
  // immediately consumed to update postings maps and then discarded.

  const mh = buffers?.minhash || new SimpleMinHash();
  if (buffers?.minhash) mh.reset();
  for (let i = 0; i < tokens.length; i += 1) {
    mh.update(tokens[i]);
  }

  return {
    tokens,
    seq,
    tokenIds,
    minhashSig: buffers?.minhash ? mh.hashValues.slice() : mh.hashValues,
    stats: computeTokenStats(tokens),
    ...(classification ? {
      identifierTokens: classification.identifierTokens,
      keywordTokens: classification.keywordTokens,
      operatorTokens: classification.operatorTokens,
      literalTokens: classification.literalTokens
    } : {})
  };
}
