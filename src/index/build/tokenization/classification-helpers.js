import { CLIKE_RESERVED_WORDS, CPP_RESERVED_WORDS, OBJC_RESERVED_WORDS } from '../../constants.js';
import { COMMON_NAME_NODE_TYPES } from '../../../lang/tree-sitter/ast.js';
import { getNativeTreeSitterParser } from '../../../lang/tree-sitter/native-runtime.js';
import { isTreeSitterEnabled } from '../../../lang/tree-sitter/options.js';
import { resolveTreeSitterLanguageForSegment } from '../file-processor/tree-sitter.js';
import { JS_RESERVED_WORDS } from '../../../lang/javascript/constants.js';
import { TS_RESERVED_WORDS } from '../../../lang/typescript/constants.js';
import { PYTHON_RESERVED_WORDS } from '../../../lang/python/constants.js';
import { GO_RESERVED_WORDS } from '../../../lang/go.js';
import { JAVA_RESERVED_WORDS } from '../../../lang/java.js';
import { KOTLIN_RESERVED_WORDS } from '../../../lang/kotlin.js';
import { CSHARP_RESERVED_WORDS } from '../../../lang/csharp.js';
import { PHP_RESERVED_WORDS } from '../../../lang/php.js';
import { RUBY_RESERVED_WORDS } from '../../../lang/ruby.js';
import { LUA_RESERVED_WORDS } from '../../../lang/lua.js';
import { PERL_RESERVED_WORDS } from '../../../lang/perl.js';
import { SHELL_RESERVED_WORDS } from '../../../lang/shell.js';
import { RUST_RESERVED_WORDS } from '../../../lang/rust.js';
import { SWIFT_RESERVED_WORDS } from '../../../lang/swift.js';
import { SQL_RESERVED_WORDS } from '../../../lang/sql.js';
import { CSS_RESERVED_WORDS } from '../../../lang/css.js';
import { HTML_RESERVED_WORDS } from '../../../lang/html.js';

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

const buildTokenSetForLeaf = (raw, dictWords, dictConfig, ext, buildTokenSequence) => {
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

const TOKEN_CLASSIFICATION_TS_MAX_CHUNK_BYTES_DEFAULT = 24 * 1024;
const TOKEN_CLASSIFICATION_TS_MAX_FILE_BYTES_DEFAULT = 256 * 1024;
const TOKEN_CLASSIFICATION_TS_MAX_CHUNKS_PER_FILE_DEFAULT = 96;
const TOKEN_CLASSIFICATION_TS_MAX_BYTES_PER_FILE_DEFAULT = 384 * 1024;

const normalizePositiveIntOrNull = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.floor(parsed));
};

const resolveClassificationLimit = (value, fallback) => {
  const parsed = normalizePositiveIntOrNull(value);
  return parsed == null ? fallback : parsed;
};

export const createTokenClassificationRuntime = ({ context, fileBytes = null } = {}) => {
  const tokenClassification = context?.tokenClassification && typeof context.tokenClassification === 'object'
    ? context.tokenClassification
    : {};
  const maxChunkBytes = resolveClassificationLimit(
    tokenClassification.treeSitterMaxChunkBytes,
    TOKEN_CLASSIFICATION_TS_MAX_CHUNK_BYTES_DEFAULT
  );
  const maxFileBytes = resolveClassificationLimit(
    tokenClassification.treeSitterMaxFileBytes,
    TOKEN_CLASSIFICATION_TS_MAX_FILE_BYTES_DEFAULT
  );
  const maxChunksPerFile = resolveClassificationLimit(
    tokenClassification.treeSitterMaxChunksPerFile,
    TOKEN_CLASSIFICATION_TS_MAX_CHUNKS_PER_FILE_DEFAULT
  );
  const maxBytesPerFile = resolveClassificationLimit(
    tokenClassification.treeSitterMaxBytesPerFile,
    TOKEN_CLASSIFICATION_TS_MAX_BYTES_PER_FILE_DEFAULT
  );
  const normalizedFileBytes = normalizePositiveIntOrNull(fileBytes) || 0;
  const withinFileCap = maxFileBytes == null || normalizedFileBytes <= maxFileBytes;
  return {
    treeSitterEnabled: withinFileCap,
    treeSitterDisabledReason: withinFileCap ? null : 'file-size',
    maxChunkBytes,
    maxFileBytes,
    maxChunksPerFile,
    maxBytesPerFile,
    remainingChunks: maxChunksPerFile,
    remainingBytes: maxBytesPerFile,
    fileBytes: normalizedFileBytes
  };
};

const shouldUseTreeSitterClassification = ({ context, text }) => {
  const treeSitterConfig = context?.treeSitter;
  if (!treeSitterConfig || treeSitterConfig.enabled === false) return false;
  const tokenClassification = context?.tokenClassification && typeof context.tokenClassification === 'object'
    ? context.tokenClassification
    : {};
  const runtime = context?.tokenClassificationRuntime && typeof context.tokenClassificationRuntime === 'object'
    ? context.tokenClassificationRuntime
    : null;
  const maxChunkBytes = resolveClassificationLimit(
    tokenClassification.treeSitterMaxChunkBytes,
    runtime?.maxChunkBytes ?? TOKEN_CLASSIFICATION_TS_MAX_CHUNK_BYTES_DEFAULT
  );
  const chunkBytes = Buffer.byteLength(text || '', 'utf8');
  if (maxChunkBytes != null && chunkBytes > maxChunkBytes) return false;
  if (!runtime) return true;
  if (runtime.treeSitterEnabled === false) return false;
  if (runtime.remainingChunks <= 0) {
    runtime.treeSitterEnabled = false;
    runtime.treeSitterDisabledReason = runtime.treeSitterDisabledReason || 'chunk-budget';
    return false;
  }
  if (runtime.remainingBytes < chunkBytes) {
    runtime.treeSitterEnabled = false;
    runtime.treeSitterDisabledReason = runtime.treeSitterDisabledReason || 'byte-budget';
    return false;
  }
  runtime.remainingChunks -= 1;
  runtime.remainingBytes = Math.max(0, runtime.remainingBytes - chunkBytes);
  return true;
};

const classifyTokensWithTreeSitter = ({
  text,
  languageId,
  ext,
  dictWords,
  dictConfig,
  keywordSet,
  treeSitter,
  buildTokenSequence
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
  const parser = getNativeTreeSitterParser(resolvedLang, { treeSitter, suppressMissingLog: true });
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

    const leafTokens = buildTokenSetForLeaf(raw, dictWords, dictConfig, ext, buildTokenSequence);
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

/**
 * Classify token list into identifier/keyword/operator/literal buckets.
 * @param {{text:string,tokens:string[],languageId?:string,ext?:string,dictWords:Set<string>|{size:number,has:function},dictConfig:object,context?:object}} input
 * @param {function} buildTokenSequence
 * @returns {{identifierTokens:string[],keywordTokens:string[],operatorTokens:string[],literalTokens:string[]}}
 */
export const classifyTokenBucketsInternal = ({
  text,
  tokens,
  languageId,
  ext,
  dictWords,
  dictConfig,
  context
}, buildTokenSequence) => {
  if (!Array.isArray(tokens) || !tokens.length) {
    return { identifierTokens: [], keywordTokens: [], operatorTokens: [], literalTokens: [] };
  }
  const keywordSet = resolveKeywordSet(languageId);
  const treeSitterConfig = shouldUseTreeSitterClassification({ context, text })
    ? (context?.treeSitter || null)
    : { enabled: false };
  const treeSitterSets = classifyTokensWithTreeSitter({
    text,
    languageId,
    ext,
    dictWords,
    dictConfig,
    keywordSet,
    treeSitter: treeSitterConfig,
    buildTokenSequence
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
