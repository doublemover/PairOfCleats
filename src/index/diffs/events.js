import { stableStringify } from '../../shared/stable-json.js';

export const MODE_ORDER = ['code', 'prose', 'extracted-prose', 'records'];

const EVENT_ORDER = {
  'file.added': 1,
  'file.removed': 2,
  'file.modified': 3,
  'file.renamed': 4,
  'chunk.added': 5,
  'chunk.removed': 6,
  'chunk.modified': 7,
  'chunk.moved': 8,
  'relation.added': 9,
  'relation.removed': 10,
  'limits.chunkDiffSkipped': 11
};

const readModeTokens = (input) => (
  Array.isArray(input)
    ? input
    : String(input || '')
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter(Boolean)
);

const throwInvalidMode = (mode, invalidRequest) => {
  const message = `Invalid mode "${mode}". Use ${MODE_ORDER.join('|')}.`;
  if (typeof invalidRequest === 'function') {
    throw invalidRequest(message);
  }
  throw new Error(message);
};

const eventSortKey = (event) => {
  const file = String(event.file || '');
  const chunkId = String(event.chunkId || '');
  const relationKey = String(event.relationKey || '');
  const logicalKey = String(event.logicalKey || '');
  const beforeFile = String(event.beforeFile || '');
  const afterFile = String(event.afterFile || '');
  return `${file}|${beforeFile}|${afterFile}|${chunkId}|${logicalKey}|${relationKey}`;
};

export const normalizeModes = (input, { invalidRequest } = {}) => {
  const selected = [];
  for (const token of readModeTokens(input)) {
    const mode = String(token || '').trim().toLowerCase();
    if (!mode) continue;
    if (!MODE_ORDER.includes(mode)) {
      throwInvalidMode(mode, invalidRequest);
    }
    if (!selected.includes(mode)) selected.push(mode);
  }
  return selected.length ? selected : ['code'];
};

export const modeRank = (mode) => {
  const index = MODE_ORDER.indexOf(mode);
  return index === -1 ? MODE_ORDER.length : index;
};

export const summarizeMode = (events, mode, chunkDiffSkipped = null) => {
  const modeEvents = events.filter((event) => event.mode === mode);
  const files = { added: 0, removed: 0, modified: 0, renamed: 0 };
  const chunks = { added: 0, removed: 0, modified: 0, moved: 0 };
  const relations = { edgesAdded: 0, edgesRemoved: 0 };
  for (const event of modeEvents) {
    if (event.kind === 'file.added') files.added += 1;
    if (event.kind === 'file.removed') files.removed += 1;
    if (event.kind === 'file.modified') files.modified += 1;
    if (event.kind === 'file.renamed') files.renamed += 1;
    if (event.kind === 'chunk.added') chunks.added += 1;
    if (event.kind === 'chunk.removed') chunks.removed += 1;
    if (event.kind === 'chunk.modified') chunks.modified += 1;
    if (event.kind === 'chunk.moved') chunks.moved += 1;
    if (event.kind === 'relation.added') relations.edgesAdded += 1;
    if (event.kind === 'relation.removed') relations.edgesRemoved += 1;
  }
  return {
    files,
    chunks,
    relations,
    limits: chunkDiffSkipped || { chunkDiffSkipped: false, reason: null }
  };
};

export const sortEvents = (events) => (
  [...events].sort((left, right) => {
    const modeDelta = modeRank(left.mode) - modeRank(right.mode);
    if (modeDelta !== 0) return modeDelta;
    const typeDelta = (EVENT_ORDER[left.kind] || 999) - (EVENT_ORDER[right.kind] || 999);
    if (typeDelta !== 0) return typeDelta;
    return eventSortKey(left).localeCompare(eventSortKey(right));
  })
);

export const serializeEvent = (event) => stableStringify(event);

export const applyEventBounds = (events, { maxEvents, maxBytes }) => {
  const bounded = [];
  let bytes = 0;
  let truncated = false;
  let reason = null;
  for (const event of events) {
    if (bounded.length >= maxEvents) {
      truncated = true;
      reason = 'max-events';
      break;
    }
    const lineBytes = Buffer.byteLength(`${serializeEvent(event)}\n`, 'utf8');
    if (bytes + lineBytes > maxBytes) {
      truncated = true;
      reason = 'max-bytes';
      break;
    }
    bounded.push(event);
    bytes += lineBytes;
  }
  return { events: bounded, truncated, reason, bytes };
};

export const toEventCounts = (events) => {
  const byKind = {};
  for (const event of events) {
    const kind = String(event.kind || 'unknown');
    byKind[kind] = Number(byKind[kind] || 0) + 1;
  }
  return byKind;
};
