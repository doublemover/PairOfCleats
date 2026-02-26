import { computeSegmentUid } from '../identity/chunk-uid.js';

/** Schema version for CDC segmentation metadata. */
export const CDC_SEGMENTATION_VERSION = '1.0.0';

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
  if (cfg.minFileBytes > 0 && input.length < cfg.minFileBytes) {
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
  const minBytes = cfg.minBytes;
  const maxBytes = cfg.maxBytes;
  const windowBytes = cfg.windowBytes;
  const mask = (1 << cfg.maskBits) - 1;
  const segments = [];
  let start = 0;
  let size = 0;
  let hash = 0;
  const total = input.length;
  for (let i = 0; i < total; i += 1) {
    const code = input.charCodeAt(i) & 0xff;
    hash = ((hash << 1) + GEAR_TABLE[code]) >>> 0;
    size += 1;
    const canAnchor = size >= minBytes && size >= windowBytes;
    const shouldCut = (canAnchor && (hash & mask) === 0) || size >= maxBytes;
    if (!shouldCut) continue;
    segments.push({
      type: 'cdc',
      languageId,
      start,
      end: i + 1,
      parentSegmentId: null,
      meta: {
        algorithm: 'cdc',
        cdc: {
          minBytes: cfg.minBytes,
          avgBytes: cfg.avgBytes,
          maxBytes: cfg.maxBytes,
          windowBytes: cfg.windowBytes,
          maskBits: cfg.maskBits,
          minFileBytes: cfg.minFileBytes
        }
      }
    });
    start = i + 1;
    size = 0;
    hash = 0;
  }
  if (start < total) {
    segments.push({
      type: 'cdc',
      languageId,
      start,
      end: total,
      parentSegmentId: null,
      meta: {
        algorithm: 'cdc',
        cdc: {
          minBytes: cfg.minBytes,
          avgBytes: cfg.avgBytes,
          maxBytes: cfg.maxBytes,
          windowBytes: cfg.windowBytes,
          maskBits: cfg.maskBits,
          minFileBytes: cfg.minFileBytes
        }
      }
    });
  }
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
