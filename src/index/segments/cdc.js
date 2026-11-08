import { computeSegmentUid } from '../identity/chunk-uid.js';

/** Schema version for CDC segmentation metadata. */
export const CDC_SEGMENTATION_VERSION = '2.0.0';

const DEFAULT_CDC_OPTIONS = {
  minBytes: 4 * 1024,
  avgBytes: 16 * 1024,
  maxBytes: 64 * 1024,
  windowBytes: 64,
  maskBits: 13,
  minFileBytes: 256 * 1024
};

const GEAR_TABLE = (() => {
  const table = new Uint32Array(256);
  let seed = 0x12345678;
  for (let i = 0; i < 256; i += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    table[i] = seed;
  }
  return table;
})();

const normalizeInt = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

/**
 * Normalize CDC segmentation options with defaults and bounds.
 * @param {object} [options]
 * @returns {{minBytes:number,avgBytes:number,maxBytes:number,windowBytes:number,maskBits:number,minFileBytes:number}}
 */
export const normalizeCdcOptions = (options = {}) => {
  const cfg = options && typeof options === 'object' ? options : {};
  const avgBytes = normalizeInt(cfg.avgBytes, DEFAULT_CDC_OPTIONS.avgBytes, { min: 1 });
  const minBytes = normalizeInt(cfg.minBytes, DEFAULT_CDC_OPTIONS.minBytes, { min: 1 });
  const maxBytes = normalizeInt(cfg.maxBytes, DEFAULT_CDC_OPTIONS.maxBytes, { min: minBytes });
  const windowBytes = normalizeInt(cfg.windowBytes, DEFAULT_CDC_OPTIONS.windowBytes, { min: 1 });
  const maskBits = normalizeInt(
    cfg.maskBits,
    Math.max(4, Math.min(20, Math.round(Math.log2(avgBytes)))),
    { min: 1, max: 30 }
  );
  const minFileBytes = normalizeInt(
    cfg.minFileBytes,
    DEFAULT_CDC_OPTIONS.minFileBytes,
    { min: 0 }
  );
  return {
    minBytes,
    avgBytes,
    maxBytes,
    windowBytes,
    maskBits,
    minFileBytes
  };
};

/**
 * Build CDC segment ranges for the provided text.
 * @param {{text:string,languageId?:string|null,options?:object}} input
 * @returns {Array<object>}
 */
export const buildCdcSegments = ({ text, languageId = null, options = {} }) => {
  const input = typeof text === 'string' ? text : '';
  if (!input) return [];
  const cfg = normalizeCdcOptions(options);
  if (cfg.minFileBytes > 0 && Buffer.byteLength(input, 'utf8') < cfg.minFileBytes) {
    return [{
      type: 'cdc',
      languageId,
      start: 0,
      end: input.length,
      parentSegmentId: null,
      meta: {
        algorithm: 'cdc',
        cdc: {
          minBytes: cfg.minBytes,
          avgBytes: cfg.avgBytes,
          maxBytes: cfg.maxBytes,
          windowBytes: cfg.windowBytes,
          maskBits: cfg.maskBits,
          minFileBytes: cfg.minFileBytes,
          bypassedByMinFileBytes: true
        }
      }
    }];
  }
  const mask = (1 << cfg.maskBits) - 1;
  const segments = [];
  let start = 0;
  let size = 0;
  let hash = 0;
  const append = (end) => {
    if (end <= start) return;
    segments.push({ type: 'cdc', languageId, start, end, parentSegmentId: null,
      meta: { algorithm: 'cdc', cdc: { ...cfg, encoding: 'utf8',
        ...(size > cfg.maxBytes ? { oversizeScalar: true } : {}) } } });
    start = end;
    size = 0;
    hash = 0;
  };
  const hashByte = byte => { hash = ((hash << 1) + GEAR_TABLE[byte]) >>> 0; };
  for (let offset = 0; offset < input.length;) {
    const original = input.codePointAt(offset);
    const width = original > 0xffff ? 2 : 1;
    // A lone surrogate has the same U+FFFD byte meaning as Buffer UTF-8 encoding.
    const code = original >= 0xd800 && original <= 0xdfff ? 0xfffd : original;
    const byteLength = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (size > 0 && size + byteLength > cfg.maxBytes) append(offset);
    if (byteLength === 1) hashByte(code);
    else if (byteLength === 2) { hashByte(0xc0 | (code >> 6)); hashByte(0x80 | (code & 63)); }
    else if (byteLength === 3) {
      hashByte(0xe0 | (code >> 12)); hashByte(0x80 | ((code >> 6) & 63)); hashByte(0x80 | (code & 63));
    } else {
      hashByte(0xf0 | (code >> 18)); hashByte(0x80 | ((code >> 12) & 63));
      hashByte(0x80 | ((code >> 6) & 63)); hashByte(0x80 | (code & 63));
    }
    size += byteLength;
    offset += width;
    const canAnchor = size >= cfg.minBytes && size >= cfg.windowBytes;
    if ((canAnchor && (hash & mask) === 0) || size >= cfg.maxBytes) append(offset);
  }
  append(input.length);
  return segments;
};

/**
 * Build CDC segments and assign deterministic segment UIDs.
 * @param {{text:string,languageId?:string|null,options?:object}} input
 * @returns {Promise<Array<object>>}
 */
export const segmentWithCdc = async ({ text, languageId = null, options = {} }) => {
  const input = typeof text === 'string' ? text : '';
  const segments = buildCdcSegments({ text: input, languageId, options });
  if (!segments.length) return segments;
  for (const segment of segments) {
    const segmentText = input.slice(segment.start, segment.end);
    const uid = await computeSegmentUid({
      segmentText,
      segmentType: segment.type || 'cdc',
      languageId: segment.languageId || languageId || null
    });
    if (uid) segment.segmentUid = uid;
  }
  return segments;
};
