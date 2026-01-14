import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import chardet from 'chardet';
import iconv from 'iconv-lite';
import { sha1 } from './hash.js';

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

export const decodeTextBuffer = (buffer) => {
  if (!buffer || !buffer.length) {
    return {
      text: '',
      encoding: 'utf8',
      usedFallback: false,
      confidence: null
    };
  }
  try {
    return {
      text: utf8Decoder.decode(buffer),
      encoding: 'utf8',
      usedFallback: false,
      confidence: null
    };
  } catch {}
  const { encoding: detected, confidence } = detectEncoding(buffer);
  let encoding = detected || 'latin1';
  if (!iconv.encodingExists(encoding)) {
    encoding = 'latin1';
  }
  return {
    text: iconv.decode(buffer, encoding),
    encoding,
    usedFallback: true,
    confidence
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
  return decodeTextBuffer(buffer);
};

export const readTextFileWithHash = async (filePath, options = {}) => {
  await ensureNotSymlink(filePath, options);
  const buffer = options.buffer ?? await fsPromises.readFile(filePath);
  const decoded = decodeTextBuffer(buffer);
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
  return decodeTextBuffer(buffer);
};
