import { parseJsonlLine } from '../jsonl.js';
import { toJsonTooLargeError } from '../limits.js';

const trimCr = (line) => (line.endsWith('\r') ? line.slice(0, -1) : line);

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

const emitFinalLine = (text, lineNumber, onLine) => {
  lineNumber += 1;
  onLine(trimCr(text), lineNumber);
  return lineNumber;
};

const emitFinalLineAsync = async (text, lineNumber, onLine) => {
  lineNumber += 1;
  await onLine(trimCr(text), lineNumber);
  return lineNumber;
};

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
