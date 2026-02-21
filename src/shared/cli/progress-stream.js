import { parseProgressEventLine } from './progress-events.js';

const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;

const byteLength = (text) => Buffer.byteLength(String(text || ''), 'utf8');

const normalizeChunk = (chunk) => {
  if (chunk == null) return '';
  if (Buffer.isBuffer(chunk)) return chunk.toString('utf8');
  return String(chunk);
};

const normalizeEol = (text) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

export const createProgressLineDecoder = ({
  maxLineBytes = DEFAULT_MAX_LINE_BYTES,
  strict = true,
  onLine = null,
  onOverflow = null
} = {}) => {
  let carry = '';
  const maxBytes = Number.isFinite(Number(maxLineBytes)) && Number(maxLineBytes) > 0
    ? Math.floor(Number(maxLineBytes))
    : DEFAULT_MAX_LINE_BYTES;

  const emitLine = (line) => {
    if (!onLine) return;
    const event = parseProgressEventLine(line, { strict });
    onLine({ line, event });
  };

  const enforceBoundedCarry = () => {
    const size = byteLength(carry);
    if (size <= maxBytes) return;
    const overflow = size - maxBytes;
    const truncated = Buffer.from(carry, 'utf8').subarray(overflow).toString('utf8');
    carry = truncated;
    if (typeof onOverflow === 'function') {
      onOverflow({ overflowBytes: overflow });
    }
  };

  const push = (chunk) => {
    const text = normalizeEol(carry + normalizeChunk(chunk));
    const parts = text.split('\n');
    carry = parts.pop() || '';
    enforceBoundedCarry();
    for (const line of parts) {
      emitLine(line);
    }
  };

  const flush = () => {
    if (!carry) return;
    const line = carry;
    carry = '';
    emitLine(line);
  };

  return {
    push,
    flush
  };
};
