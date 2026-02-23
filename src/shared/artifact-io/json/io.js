import fs from 'node:fs';
import { toJsonTooLargeError } from '../limits.js';
import { rethrowIfTooLargeLike } from './error-classification.js';

/**
 * Stat a source and enforce the max-size guard before opening streams/readers.
 *
 * @param {string} targetPath
 * @param {number} maxBytes
 * @returns {fs.Stats}
 */
export const statWithinLimit = (targetPath, maxBytes) => {
  const stat = fs.statSync(targetPath);
  if (stat.size > maxBytes) {
    throw toJsonTooLargeError(targetPath, stat.size);
  }
  return stat;
};

/**
 * Read a binary payload after a caller already probed `stat`.
 *
 * Avoids duplicate stat calls on hot paths where `stat.size` is already known.
 *
 * @param {string} targetPath
 * @param {number} maxBytes
 * @param {fs.Stats} stat
 * @returns {Buffer}
 */
export const readBufferFromStat = (targetPath, maxBytes, stat) => {
  if (!stat || stat.size > maxBytes) {
    throw toJsonTooLargeError(targetPath, stat?.size ?? maxBytes);
  }
  try {
    const buffer = fs.readFileSync(targetPath);
    if (buffer.length > maxBytes) {
      throw toJsonTooLargeError(targetPath, buffer.length);
    }
    return buffer;
  } catch (err) {
    rethrowIfTooLargeLike(err, targetPath, stat.size);
    throw err;
  }
};

/**
 * Read a UTF-8 payload after a caller already probed `stat`.
 *
 * @param {string} targetPath
 * @param {number} maxBytes
 * @param {fs.Stats} stat
 * @returns {string}
 */
export const readUtf8FromStat = (targetPath, maxBytes, stat) => {
  if (!stat || stat.size > maxBytes) {
    throw toJsonTooLargeError(targetPath, stat?.size ?? maxBytes);
  }
  try {
    return fs.readFileSync(targetPath, 'utf8');
  } catch (err) {
    rethrowIfTooLargeLike(err, targetPath, stat.size);
    throw err;
  }
};

/**
 * Normalize an exclusive-end byte range to Node stream options.
 *
 * @param {{start:number,end:number}|null|undefined} byteRange
 * @returns {{start:number,end:number}|null}
 */
export const toInclusiveByteRange = (byteRange) => {
  if (!byteRange) return null;
  if (!Number.isFinite(byteRange.start) || !Number.isFinite(byteRange.end)) return null;
  return {
    start: Math.max(0, byteRange.start),
    end: Math.max(0, byteRange.end - 1)
  };
};
