import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import chardet from 'chardet';
import iconv from 'iconv-lite';
import { sha1 } from './hash.js';
import { fileExt, toPosix } from './files.js';

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

const normalizeEncoding = (value) => {
  if (!value) return null;
  return String(value).trim().replace(/_/g, '-').toLowerCase();
};

const detectEncoding = (buffer) => {
  if (!buffer || !buffer.length) return { encoding: null, confidence: null };
  try {
    const detected = chardet.analyse(buffer) || [];
    if (Array.isArray(detected) && detected.length) {
      const best = detected[0];
      return {
        encoding: normalizeEncoding(best?.name),
        confidence: Number.isFinite(best?.confidence) ? best.confidence : null
      };
    }
  } catch {}
  try {
    const detected = normalizeEncoding(chardet.detect(buffer));
    return { encoding: detected, confidence: null };
  } catch {}
  return { encoding: null, confidence: null };
};

const hasWindows1252Bytes = (buffer) => {
  if (!buffer || !buffer.length) return false;
  for (const byte of buffer) {
    if (byte >= 0x80 && byte <= 0x9f) return true;
  }
  return false;
};

const hasOnlyWindows1252Controls = (buffer) => {
  if (!buffer || !buffer.length) return false;
  let seen = false;
  for (const byte of buffer) {
    if (byte < 0x80) continue;
    if (byte > 0x9f) return false;
    seen = true;
  }
  return seen;
};

export const ENCODING_FALLBACK_CLASSES = Object.freeze({
  DOCUMENT: 'document',
  CONFIGURATION: 'configuration',
  SOURCE: 'source',
  VENDOR: 'vendor',
  UNKNOWN: 'unknown'
});

export const ENCODING_FALLBACK_RISKS = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
});

const DOCUMENT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.rst', '.adoc', '.asciidoc', '.tex', '.rtf', '.log', '.csv', '.tsv'
]);

const CONFIGURATION_EXTENSIONS = new Set([
  '.json', '.json5', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.xml', '.plist',
  '.properties', '.editorconfig', '.gitattributes', '.gitignore', '.npmrc', '.env',
  '.mustache', '.hbs', '.handlebars', '.jinja', '.jinja2', '.tmpl', '.template'
]);

const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.rb', '.php', '.java', '.scala', '.sc',
  '.kt', '.kts', '.swift', '.go', '.rs', '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp',
  '.cs', '.m', '.mm', '.dart', '.lua', '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.sql',
  '.r', '.pl', '.pm'
]);

const isVendorLikePath = (value) => {
  const text = toPosix(value).toLowerCase();
  return text.includes('/vendor/')
    || text.includes('/node_modules/')
    || text.includes('/third_party/')
    || text.includes('/third-party/')
    || text.includes('/external/');
};

/**
 * Classify fallback decoding so callers can distinguish benign legacy text
 * from higher-risk source degradation.
 *
 * @param {{
 *   usedFallback?:boolean,
 *   filePath?:string|null,
 *   confidence?:number|null
 * }} input
 * @returns {{
 *   encodingFallbackClass:string|null,
 *   encodingFallbackRisk:string|null
 * }}
 */
export const classifyEncodingFallback = ({
  usedFallback = false,
  filePath = null,
  confidence = null
} = {}) => {
  if (!usedFallback) {
    return {
      encodingFallbackClass: null,
      encodingFallbackRisk: null
    };
  }
  const normalizedPath = typeof filePath === 'string' ? toPosix(filePath).toLowerCase() : '';
  const ext = fileExt(normalizedPath || '');
  const lowConfidence = Number.isFinite(confidence) && confidence < 0.35;
  if (normalizedPath && isVendorLikePath(normalizedPath)) {
    return {
      encodingFallbackClass: ENCODING_FALLBACK_CLASSES.VENDOR,
      encodingFallbackRisk: lowConfidence ? ENCODING_FALLBACK_RISKS.MEDIUM : ENCODING_FALLBACK_RISKS.LOW
    };
  }
  if (DOCUMENT_EXTENSIONS.has(ext)) {
    return {
      encodingFallbackClass: ENCODING_FALLBACK_CLASSES.DOCUMENT,
      encodingFallbackRisk: lowConfidence ? ENCODING_FALLBACK_RISKS.MEDIUM : ENCODING_FALLBACK_RISKS.LOW
    };
  }
  if (CONFIGURATION_EXTENSIONS.has(ext)) {
    return {
      encodingFallbackClass: ENCODING_FALLBACK_CLASSES.CONFIGURATION,
      encodingFallbackRisk: lowConfidence ? ENCODING_FALLBACK_RISKS.HIGH : ENCODING_FALLBACK_RISKS.MEDIUM
    };
  }
  if (SOURCE_EXTENSIONS.has(ext)) {
    return {
      encodingFallbackClass: ENCODING_FALLBACK_CLASSES.SOURCE,
      encodingFallbackRisk: ENCODING_FALLBACK_RISKS.HIGH
    };
  }
  return {
    encodingFallbackClass: ENCODING_FALLBACK_CLASSES.UNKNOWN,
    encodingFallbackRisk: lowConfidence ? ENCODING_FALLBACK_RISKS.HIGH : ENCODING_FALLBACK_RISKS.MEDIUM
  };
};

export const decodeTextBuffer = (buffer, options = {}) => {
  if (!buffer || !buffer.length) {
    return {
      text: '',
      encoding: 'utf8',
      usedFallback: false,
      confidence: null,
      encodingFallbackClass: null,
      encodingFallbackRisk: null
    };
  }
  try {
    return {
      text: utf8Decoder.decode(buffer),
      encoding: 'utf8',
      usedFallback: false,
      confidence: null,
      encodingFallbackClass: null,
      encodingFallbackRisk: null
    };
  } catch {}
  const { encoding: detected, confidence } = detectEncoding(buffer);
  let encoding = detected || 'latin1';
  if (encoding === 'utf8' || encoding === 'utf-8') {
    encoding = 'latin1';
  }
  const confidenceScore = Number.isFinite(confidence) ? confidence : null;
  const preferWindows1252 = hasWindows1252Bytes(buffer) && (
    encoding === 'latin1'
    || encoding === 'iso-8859-1'
    || hasOnlyWindows1252Controls(buffer)
    || (confidenceScore !== null && confidenceScore < 0.6)
  );
  if (preferWindows1252) {
    encoding = 'windows-1252';
  }
  if (!iconv.encodingExists(encoding)) {
    encoding = 'latin1';
  }
  const fallbackClassification = classifyEncodingFallback({
    usedFallback: true,
    filePath: options.filePath || null,
    confidence
  });
  return {
    text: iconv.decode(buffer, encoding),
    encoding,
    usedFallback: true,
    confidence,
    ...fallbackClassification
  };
};

const ensureNotSymlink = async (filePath, options = {}) => {
  if (options.allowSymlink === true) return null;
  const stat = options.stat || await fsPromises.lstat(filePath);
  if (stat?.isSymbolicLink?.()) {
    const err = new Error(`Refusing to read symlink: ${filePath}`);
    err.code = 'ERR_SYMLINK';
    throw err;
  }
  return stat;
};

const ensureNotSymlinkSync = (filePath, options = {}) => {
  if (options.allowSymlink === true) return null;
  const stat = options.stat || fs.lstatSync(filePath);
  if (stat?.isSymbolicLink?.()) {
    const err = new Error(`Refusing to read symlink: ${filePath}`);
    err.code = 'ERR_SYMLINK';
    throw err;
  }
  return stat;
};

export const readTextFile = async (filePath, options = {}) => {
  await ensureNotSymlink(filePath, options);
  const buffer = options.buffer ?? await fsPromises.readFile(filePath);
  return decodeTextBuffer(buffer, { filePath });
};

export const readTextFileWithHash = async (filePath, options = {}) => {
  await ensureNotSymlink(filePath, options);
  const buffer = options.buffer ?? await fsPromises.readFile(filePath);
  const decoded = decodeTextBuffer(buffer, { filePath });
  const hash = sha1(buffer);
  return {
    ...decoded,
    hash,
    buffer
  };
};

export const readTextFileSync = (filePath, options = {}) => {
  ensureNotSymlinkSync(filePath, options);
  const buffer = options.buffer ?? fs.readFileSync(filePath);
  return decodeTextBuffer(buffer, { filePath });
};
