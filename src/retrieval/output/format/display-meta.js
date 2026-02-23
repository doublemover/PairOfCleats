import { sha1 } from '../../../shared/hash.js';
import { buildLocalCacheKey } from '../../../shared/cache-key.js';
import { ANSI, boldText, stripAnsi } from './ansi.js';

export const formatInferredEntry = (entry) => {
  if (!entry?.type) return '';
  const parts = [];
  if (entry.source) parts.push(entry.source);
  if (Number.isFinite(entry.confidence)) parts.push(entry.confidence.toFixed(2));
  const suffix = parts.length ? ` (${parts.join(', ')})` : '';
  return `${entry.type}${suffix}`;
};

export const formatInferredEntries = (entries, limit = 3) => {
  if (!Array.isArray(entries) || !entries.length) return '';
  return entries.slice(0, limit).map(formatInferredEntry).filter(Boolean).join(', ');
};

export const formatInferredMap = (map, limit = 3) => {
  if (!map || typeof map !== 'object') return '';
  const entries = Object.entries(map).slice(0, limit).map(([name, items]) => {
    const formatted = formatInferredEntries(items, 2);
    return formatted ? `${name}=${formatted}` : '';
  }).filter(Boolean);
  return entries.join(', ');
};

export const toArray = (value) => (Array.isArray(value) ? value : []);

export const formatLastModified = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const now = Date.now();
  const diffMs = Math.max(0, now - date.getTime());
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  if (diffMs <= weekMs) {
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = String(date.getFullYear()).slice(-2);
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${month}/${day}/${year} ${hours}:${minutes}${period}`;
};

export const INDENT = '     ';

/**
 * Locale-neutral comparator for deterministic ordering across environments.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number}
 */
export const compareText = (a, b) => {
  const left = String(a || '');
  const right = String(b || '');
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

export const buildQueryHash = (queryTokens, rx) => {
  const tokens = Array.isArray(queryTokens) ? queryTokens.join('|') : '';
  const rxSig = rx ? `${rx.source}/${rx.flags}` : '';
  return sha1(`${tokens}:${rxSig}`);
};

export const buildFormatCacheKey = ({
  chunk,
  index,
  mode,
  queryHash,
  matched,
  explain
}) => buildLocalCacheKey({
  namespace: 'format',
  payload: {
    mode,
    index,
    file: chunk.file,
    start: chunk.start,
    end: chunk.end,
    matched: Boolean(matched),
    explain: Boolean(explain),
    queryHash
  }
}).key;

/**
 * Build comma-delimited wrapped lines while preserving ANSI-aware width checks.
 *
 * @param {string} label
 * @param {Array<unknown>} items
 * @param {{indent?:string,maxWidth?:number}} [options]
 * @returns {string[]}
 */
export const buildWrappedLines = (label, items, { indent = INDENT, maxWidth = 110 } = {}) => {
  if (!Array.isArray(items) || !items.length) return [];
  const prefix = `${indent}${label} `;
  const pad = ' '.repeat(stripAnsi(prefix).length);
  let line = prefix;
  const lines = [];
  items.forEach((item, index) => {
    const text = String(item);
    const sep = (line === prefix) ? '' : ', ';
    if (stripAnsi(line + sep + text).length > maxWidth && line !== prefix) {
      lines.push(line.trimEnd());
      line = pad + text;
    } else {
      line += sep + text;
    }
    if (index === items.length - 1) {
      lines.push(line);
    }
  });
  return lines;
};

export const formatWrappedList = (label, items, options) => {
  const lines = buildWrappedLines(label, items, options);
  if (!lines.length) return '';
  return lines.map((line) => `${line}\n`).join('');
};

export const buildVerticalLines = (label, items, { indent = INDENT } = {}) => {
  if (!Array.isArray(items) || !items.length) return [];
  const prefix = `${indent}${label} `;
  const pad = ' '.repeat(stripAnsi(prefix).length);
  const lines = [`${prefix}${items[0]}`];
  for (const item of items.slice(1)) {
    lines.push(`${pad}${item}`);
  }
  return lines;
};

export const formatVerticalList = (label, items, options) => {
  const lines = buildVerticalLines(label, items, options);
  if (!lines.length) return '';
  return lines.map((line) => `${line}\n`).join('');
};

/**
 * Convert control-flow counters into printable pluralized labels.
 *
 * @param {object|null} controlFlow
 * @returns {Array<{label:string,value:number}>}
 */
export const formatControlFlow = (controlFlow) => {
  if (!controlFlow) return [];
  const parts = [];
  const push = (label, value) => {
    if (!Number.isFinite(value) || value <= 0) return;
    let plural = value === 1 ? label : `${label}s`;
    if (label === 'Branch' && value !== 1) plural = 'Branches';
    parts.push({ label: plural, value });
  };
  push('Branch', controlFlow.branches);
  push('Loop', controlFlow.loops);
  push('Return', controlFlow.returns);
  push('Break', controlFlow.breaks);
  push('Continue', controlFlow.continues);
  push('Throw', controlFlow.throws);
  push('Await', controlFlow.awaits);
  push('Yield', controlFlow.yields);
  return parts;
};

/**
 * Style function/class signatures by emphasizing symbol name and argument list.
 *
 * @param {string|null|undefined} signature
 * @param {string|null|undefined} nameLabel
 * @returns {string}
 */
export const formatSignature = (signature, nameLabel) => {
  const raw = String(signature || '').trim();
  if (!raw) return '';
  const styleNameArgs = (name, args, rest = '') => {
    const argsStyled = args.length
      ? `${ANSI.bold}${ANSI.fgBrightWhite}${args}${ANSI.reset}`
      : '';
    return `${boldText(name)}${boldText('(')}${argsStyled}${boldText(')')}${rest}`;
  };
  if (nameLabel) {
    const index = raw.indexOf(nameLabel);
    if (index !== -1) {
      const before = raw.slice(0, index);
      const after = raw.slice(index + nameLabel.length);
      if (after.startsWith('(')) {
        const closeIdx = after.indexOf(')');
        if (closeIdx !== -1) {
          const args = after.slice(1, closeIdx);
          const rest = after.slice(closeIdx + 1);
          return `${before}${styleNameArgs(nameLabel, args, rest)}`;
        }
      }
      return `${before}${boldText(nameLabel)}${after}`;
    }
  }
  const match = raw.match(/^([A-Za-z0-9_$\.]+)\((.*)\)(.*)$/);
  if (match) {
    return styleNameArgs(match[1], match[2], match[3]);
  }
  return raw;
};
