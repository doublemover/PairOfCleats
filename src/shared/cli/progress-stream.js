import { parseProgressEventLine } from './progress-events.js';
import { StringDecoder } from 'node:string_decoder';

const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;

const byteLength = (text) => Buffer.byteLength(String(text || ''), 'utf8');

const normalizeEol = (text) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const boundedUtf8Tail = (text, maxBytes) => {
  const buffer = Buffer.from(text, 'utf8');
  let start = Math.max(0, buffer.length - maxBytes);
  // A tail starts at a complete code point, never a decoded replacement fragment.
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;
  return buffer.subarray(start).toString('utf8');
};

export const createProgressLineDecoder = ({
  maxLineBytes = DEFAULT_MAX_LINE_BYTES,
  strict = true,
  onLine = null,
  onOverflow = null
} = {}) => {
  let carry = '';
  let carryTruncated = false, pendingCR = false;
  const decoder = new StringDecoder('utf8');
  const maxBytes = Number.isFinite(Number(maxLineBytes)) && Number(maxLineBytes) > 0
    ? Math.floor(Number(maxLineBytes))
    : DEFAULT_MAX_LINE_BYTES;

  const trimLine = (line) => {
    const size = byteLength(line);
    if (size <= maxBytes) return { line, truncated: false };
    const retained = boundedUtf8Tail(line, maxBytes);
    if (typeof onOverflow === 'function') onOverflow({ overflowBytes: size - byteLength(retained) });
    return { line: retained, truncated: true };
  };
  const emitLine = (line, previouslyTruncated = false) => {
    const bounded = trimLine(line);
    if (!onLine) return;
    const truncated = previouslyTruncated || bounded.truncated;
    const event = truncated ? null : parseProgressEventLine(bounded.line, { strict });
    onLine({ line: bounded.line, event, ...(truncated ? { truncated: true } : {}) });
  };

  const acceptText = (incoming, final = false) => {
    let chunk = (pendingCR ? '\r' : '') + incoming;
    pendingCR = !final && chunk.endsWith('\r');
    if (pendingCR) chunk = chunk.slice(0, -1);
    const text = normalizeEol(carry + chunk);
    const parts = text.split('\n');
    const priorTruncated = carryTruncated;
    const trailing = trimLine(parts.pop() || '');
    carry = trailing.line;
    carryTruncated = trailing.truncated || (parts.length === 0 && priorTruncated);
    for (let i = 0; i < parts.length; i++) {
      emitLine(parts[i], i === 0 && priorTruncated);
    }
  };
  const push = (chunk) => {
    if (chunk == null) return;
    acceptText(decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')));
  };

  const flush = () => {
    acceptText(decoder.end(), true);
    if (!carry) { carryTruncated = false; return; }
    const line = carry;
    carry = '';
    const truncated = carryTruncated;
    carryTruncated = false;
    emitLine(line, truncated);
  };

  return {
    push,
    flush
  };
};
