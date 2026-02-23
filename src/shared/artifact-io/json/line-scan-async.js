import { parseJsonlLine } from '../jsonl.js';
import { toJsonTooLargeError } from '../limits.js';

const trimCr = (line) => (line.endsWith('\r') ? line.slice(0, -1) : line);

const forEachCompleteLineAsync = async (text, lineNumber, onLine) => {
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) !== 10) continue;
    lineNumber += 1;
    await onLine(trimCr(text.slice(start, i)), lineNumber);
    start = i + 1;
  }
  return { remaining: text.slice(start), lineNumber };
};

const emitFinalLineAsync = async (text, lineNumber, onLine) => {
  lineNumber += 1;
  await onLine(trimCr(text), lineNumber);
  return lineNumber;
};

/**
 * Parse JSONL rows from an in-memory buffer and await an async row callback.
 *
 * This mirrors stream scanning semantics, including trailing-newline handling,
 * without allocating an intermediate `entries[]` array.
 *
 * @param {Buffer} buffer
 * @param {string} sourcePath
 * @param {{
 *   maxBytes:number,
 *   requiredKeys?:string[]|null,
 *   validationMode?:'strict'|'trusted',
 *   onEntry:(entry:any)=>Promise<void>
 * }} [options]
 * @returns {Promise<{rows:number,bytes:number}>}
 */
export const scanJsonlBufferAsync = async (
  buffer,
  sourcePath,
  {
    maxBytes,
    requiredKeys = null,
    validationMode = 'strict',
    onEntry
  } = {}
) => {
  if (buffer.length > maxBytes) {
    throw toJsonTooLargeError(sourcePath, buffer.length);
  }
  const raw = buffer.toString('utf8');
  if (!raw.trim()) {
    return { rows: 0, bytes: buffer.length };
  }

  let rows = 0;
  let lineNumber = 0;
  const onLine = async (line, currentLineNumber) => {
    const entry = parseJsonlLine(
      line,
      sourcePath,
      currentLineNumber,
      maxBytes,
      requiredKeys,
      validationMode
    );
    if (entry === null) return;
    rows += 1;
    await onEntry(entry);
  };

  const state = await forEachCompleteLineAsync(raw, lineNumber, onLine);
  lineNumber = state.lineNumber;
  if (state.remaining.length) {
    await emitFinalLineAsync(state.remaining, lineNumber, onLine);
  } else if (raw.charCodeAt(raw.length - 1) === 10) {
    await emitFinalLineAsync('', lineNumber, onLine);
  }
  return { rows, bytes: buffer.length };
};
