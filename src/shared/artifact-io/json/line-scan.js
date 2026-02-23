import { parseJsonlLine } from '../jsonl.js';
import { toJsonTooLargeError } from '../limits.js';

/**
 * Normalize line terminators so CRLF sources are parsed like LF-only sources.
 *
 * @param {string} line
 * @returns {string}
 */
const trimCr = (line) => (line.endsWith('\r') ? line.slice(0, -1) : line);

/**
 * Visit all complete newline-terminated lines in `text`.
 *
 * Returns the trailing partial segment (if any) for the caller to carry into
 * the next chunk.
 *
 * @param {string} text
 * @param {number} lineNumber
 * @param {(line:string,lineNumber:number)=>void} onLine
 * @returns {{remaining:string,lineNumber:number}}
 */
const forEachCompleteLine = (text, lineNumber, onLine) => {
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) !== 10) continue;
    lineNumber += 1;
    onLine(trimCr(text.slice(start, i)), lineNumber);
    start = i + 1;
  }
  return { remaining: text.slice(start), lineNumber };
};

/**
 * Async variant of {@link forEachCompleteLine}.
 *
 * @param {string} text
 * @param {number} lineNumber
 * @param {(line:string,lineNumber:number)=>Promise<void>} onLine
 * @returns {Promise<{remaining:string,lineNumber:number}>}
 */
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

/**
 * Emit the final unterminated line segment.
 *
 * @param {string} text
 * @param {number} lineNumber
 * @param {(line:string,lineNumber:number)=>void} onLine
 * @returns {number}
 */
const emitFinalLine = (text, lineNumber, onLine) => {
  lineNumber += 1;
  onLine(trimCr(text), lineNumber);
  return lineNumber;
};

/**
 * Async variant of {@link emitFinalLine}.
 *
 * @param {string} text
 * @param {number} lineNumber
 * @param {(line:string,lineNumber:number)=>Promise<void>} onLine
 * @returns {Promise<number>}
 */
const emitFinalLineAsync = async (text, lineNumber, onLine) => {
  lineNumber += 1;
  await onLine(trimCr(text), lineNumber);
  return lineNumber;
};

/**
 * Parse JSONL entries from a single in-memory buffer.
 *
 * Empty buffers return zero rows. A trailing newline emits a final empty line
 * so strict/trusted parser behavior matches stream scanning.
 *
 * @param {Buffer} buffer
 * @param {string} sourcePath
 * @param {{
 *   maxBytes:number,
 *   requiredKeys?:string[]|null,
 *   validationMode?:'strict'|'trusted',
 *   onEntry?:(entry:any)=>void,
 *   collect?:any[]|null
 * }} [options]
 * @returns {{rows:number,bytes:number}}
 */
export const scanJsonlBuffer = (
  buffer,
  sourcePath,
  {
    maxBytes,
    requiredKeys = null,
    validationMode = 'strict',
    onEntry = null,
    collect = null
  } = {}
) => {
  if (buffer.length > maxBytes) {
    throw toJsonTooLargeError(sourcePath, buffer.length);
  }
  const raw = buffer.toString('utf8');
  if (!raw.trim()) return { rows: 0, bytes: buffer.length };

  let rows = 0;
  let lineNumber = 0;
  const onLine = (line, currentLineNumber) => {
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
    if (onEntry) onEntry(entry);
    if (collect) collect.push(entry);
  };

  const state = forEachCompleteLine(raw, lineNumber, onLine);
  lineNumber = state.lineNumber;
  if (state.remaining.length) {
    emitFinalLine(state.remaining, lineNumber, onLine);
  } else if (raw.charCodeAt(raw.length - 1) === 10) {
    emitFinalLine('', lineNumber, onLine);
  }
  return { rows, bytes: buffer.length };
};

/**
 * Parse JSONL entries from a stream while preserving line numbers across chunk
 * boundaries and enforcing total byte limits on the compressed/plain stream.
 *
 * @param {AsyncIterable<string|Buffer>} stream
 * @param {{
 *   targetPath:string,
 *   maxBytes:number,
 *   requiredKeys?:string[]|null,
 *   validationMode?:'strict'|'trusted',
 *   onEntry?:(entry:any)=>void,
 *   collect?:any[]|null
 * }} [options]
 * @returns {Promise<{rows:number,bytes:number}>}
 */
export const scanJsonlStream = async (
  stream,
  {
    targetPath,
    maxBytes,
    requiredKeys = null,
    validationMode = 'strict',
    onEntry = null,
    collect = null
  } = {}
) => {
  let buffer = '';
  let lineNumber = 0;
  let rows = 0;
  let bytes = 0;

  const onLine = (line, currentLineNumber) => {
    const entry = parseJsonlLine(
      line,
      targetPath,
      currentLineNumber,
      maxBytes,
      requiredKeys,
      validationMode
    );
    if (entry === null) return;
    rows += 1;
    if (onEntry) onEntry(entry);
    if (collect) collect.push(entry);
  };

  for await (const chunk of stream) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    bytes += typeof chunk === 'string' ? Buffer.byteLength(text, 'utf8') : chunk.length;
    if (bytes > maxBytes) {
      throw toJsonTooLargeError(targetPath, bytes);
    }

    buffer += text;
    const state = forEachCompleteLine(buffer, lineNumber, onLine);
    buffer = state.remaining;
    lineNumber = state.lineNumber;

    if (buffer.length > maxBytes) {
      throw toJsonTooLargeError(targetPath, Buffer.byteLength(buffer, 'utf8'));
    }
  }

  if (buffer.length) {
    emitFinalLine(buffer, lineNumber, onLine);
  }

  return { rows, bytes };
};

/**
 * Materialize parsed JSONL entries from a buffer.
 *
 * @param {Buffer} buffer
 * @param {string} sourcePath
 * @param {{maxBytes:number,requiredKeys?:string[]|null,validationMode?:'strict'|'trusted'}} [options]
 * @returns {{entries:any[],bytes:number}}
 */
export const parseJsonlBufferEntries = (
  buffer,
  sourcePath,
  { maxBytes, requiredKeys, validationMode } = {}
) => {
  const entries = [];
  const { bytes } = scanJsonlBuffer(buffer, sourcePath, {
    maxBytes,
    requiredKeys,
    validationMode,
    collect: entries
  });
  return { entries, bytes };
};

/**
 * Parse JSONL stream entries and dispatch each parsed row to an async callback.
 *
 * @param {AsyncIterable<string|Buffer>} stream
 * @param {{
 *   targetPath:string,
 *   maxBytes:number,
 *   requiredKeys?:string[]|null,
 *   validationMode?:'strict'|'trusted',
 *   onEntry:(entry:any)=>Promise<void>
 * }} [options]
 * @returns {Promise<{rows:number,bytes:number}>}
 */
export const parseJsonlStreamEntries = async (
  stream,
  {
    targetPath,
    maxBytes,
    requiredKeys,
    validationMode,
    onEntry
  } = {}
) => {
  let buffer = '';
  let lineNumber = 0;
  let rows = 0;
  let bytes = 0;

  const onLine = async (line, currentLineNumber) => {
    const entry = parseJsonlLine(
      line,
      targetPath,
      currentLineNumber,
      maxBytes,
      requiredKeys,
      validationMode
    );
    if (entry === null) return;
    rows += 1;
    await onEntry(entry);
  };

  for await (const chunk of stream) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    bytes += typeof chunk === 'string' ? Buffer.byteLength(text, 'utf8') : chunk.length;
    if (bytes > maxBytes) {
      throw toJsonTooLargeError(targetPath, bytes);
    }

    buffer += text;
    const state = await forEachCompleteLineAsync(buffer, lineNumber, onLine);
    buffer = state.remaining;
    lineNumber = state.lineNumber;

    if (buffer.length > maxBytes) {
      throw toJsonTooLargeError(targetPath, Buffer.byteLength(buffer, 'utf8'));
    }
  }

  if (buffer.length) {
    await emitFinalLineAsync(buffer, lineNumber, onLine);
  }

  return { rows, bytes };
};
