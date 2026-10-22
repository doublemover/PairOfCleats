import { createHash, randomUUID } from 'node:crypto';
import { stableStringify } from '../../shared/stable-json.js';

const fail = (message) => {
  throw Object.assign(new Error(message), { code: 'ERR_RETRIEVAL_FRONTIER_CONTRACT' });
};
const textId = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 4096 && Buffer.byteLength(value) <= 4096;
const plainRecord = value => value && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

/** Internal opt-in target. No finite ANN array can attest this capability. */
export const admitRrfTarget = (input) => {
  const fields = new Set(['formula', 'certificateTarget', 'rankDomain', 'resultUnit', 'tiePolicy',
    'zeroSupport', 'eligibility', 'repositoryId', 'generationId', 'universeId', 'queryId',
    'semanticWorldId', 'semanticSpecId', 'eligibilityReceiptId', 'k', 'channels', 'numericEvaluation']);
  if (!plainRecord(input) || input.formula !== 'weighted-rrf-v1'
    || input.certificateTarget !== 'pre-boost'
    || input.rankDomain !== 'after-filter'
    || input.resultUnit !== 'source-incarnation'
    || input.tiePolicy !== 'code-unit-id'
    || input.zeroSupport !== 'exclude'
    || input.eligibility !== 'complete-confirmed'
    || input.numericEvaluation !== 'binary64-channel-order-v1') fail('Unsupported RRF target semantics.');
  if (Object.keys(input).some(key => !fields.has(key))) fail('Unknown RRF target field.');
  for (const key of ['repositoryId', 'generationId', 'universeId', 'queryId', 'semanticWorldId',
    'semanticSpecId', 'eligibilityReceiptId']) {
    if (!textId(input[key])) fail(`Missing immutable target identity: ${key}.`);
  }
  if (!Number.isFinite(input.k) || input.k < 0) fail('RRF k must be finite and nonnegative.');
  if (!Array.isArray(input.channels) || !input.channels.length || input.channels.length > 32) {
    fail('Between 1 and 32 RRF channels are required.');
  }
  const ids = new Set();
  let weights = 0;
  for (const channel of input.channels) {
    if (!plainRecord(channel) || Object.keys(channel).some(key => !['id', 'representationId', 'capability', 'weight'].includes(key))
      || !textId(channel.id) || ids.has(channel.id) || !textId(channel.representationId)
      || channel.capability !== 'exact-ordered-prefix'
      || !Number.isFinite(channel.weight) || channel.weight < 0) fail('Invalid or approximate channel.');
    ids.add(channel.id);
    weights += channel.weight;
  }
  if (!Number.isFinite(weights) || weights <= 0) fail('RRF weights must have a finite positive sum.');
  // JSON-only values: avoid identity loss through undefined, nonfinite values or custom serialization.
  const serialized = stableStringify(input);
  if (Buffer.byteLength(serialized) > 65536) fail('RRF target exceeds the 64 KiB identity allowance.');
  const target = JSON.parse(serialized);
  if (stableStringify(target) !== serialized) fail('Target is not canonical JSON.');
  return freeze({ target, targetId: createHash('sha256').update(serialized).digest('hex') });
};

/**
 * Exact-prefix reducer. The caller owns source leases and ordered-prefix proof.
 * Updates are atomic: a rejected batch leaves both depth and candidates intact.
 * Capacity pauses do not discard facts and may be resumed with a larger allowance.
 */
export const createRrfFrontier = ({ target: input, maxRetainedBytes = 8 * 1024 * 1024 }) => {
  const { target, targetId } = admitRrfTarget(input);
  if (!Number.isSafeInteger(maxRetainedBytes) || maxRetainedBytes < 1) fail('Invalid retained-byte allowance.');
  const channels = target.channels.map(channel => ({ ...channel, depth: 0, exhausted: false }));
  const rows = new Map();
  const emitted = new Set();
  let retainedBytes = 0;
  let sequence = 0;
  let terminalFailure = null;
  const continuation = randomUUID();
  const contribution = (channel, rank) => channel.weight / (target.k + rank);
  const interval = (row) => {
    let lower = 0;
    let upper = 0;
    for (let i = 0; i < channels.length; i++) {
      const channel = channels[i];
      const rank = row.ranks[i];
      const known = rank == null ? 0 : contribution(channel, rank);
      lower += known;
      upper += rank != null || channel.exhausted ? known : contribution(channel, channel.depth + 1);
    }
    return { lower, upper };
  };
  const receipt = () => ({
    targetId, continuation, sequence,
    state: terminalFailure ? 'failed' : channels.every(channel => channel.exhausted) ? 'exhausted' : 'running',
    failure: terminalFailure,
    retainedBytes,
    enumerationComplete: !terminalFailure && channels.every(channel => channel.exhausted),
    semanticClosure: 'not-assessed',
    taskSupport: 'not-assessed',
    channels: channels.map(({ id, depth, exhausted }) => ({ id, depth, state: exhausted ? 'exhausted' : 'open' }))
  });
  return Object.freeze({
    target, targetId,
    assertContinuation(handle, expectedTargetId) {
      if (handle !== continuation || expectedTargetId !== targetId) fail('Lost or incompatible continuation.');
      if (terminalFailure) fail('Failed frontier cannot resume.');
    },
    setCapacity(bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < retainedBytes || bytes < 1) fail('Invalid retained-byte allowance.');
      maxRetainedBytes = bytes;
    },
    append({ channelId, expectedDepth, ids, exhausted = false }) {
      if (terminalFailure) fail('Failed frontier cannot advance.');
      const index = channels.findIndex(channel => channel.id === channelId);
      const channel = channels[index];
      if (!channel || channel.exhausted || expectedDepth !== channel.depth || !Array.isArray(ids)
        || typeof exhausted !== 'boolean' || !Number.isSafeInteger(channel.depth + ids.length)) {
        fail('Invalid, replayed or out-of-order prefix.');
      }
      const seen = new Set();
      const additions = [];
      let addedBytes = 0;
      for (const id of ids) {
        if (!textId(id) || seen.has(id) || rows.get(id)?.ranks[index] != null) fail('Duplicate or invalid source incarnation.');
        seen.add(id);
        if (!rows.has(id)) {
          const row = { id, ranks: channels.map(() => null) };
          // This is a serialized-state allowance, not a claim about VM heap/RSS.
          const bytes = Buffer.byteLength(JSON.stringify(row)) + channels.length * 16;
          additions.push([id, row]);
          addedBytes += bytes;
        }
      }
      if (retainedBytes + addedBytes > maxRetainedBytes) {
        return { ...receipt(), state: 'paused', reason: 'retained-byte-allowance', accepted: false };
      }
      for (const [id, row] of additions) rows.set(id, row);
      for (const id of ids) rows.get(id).ranks[index] = ++channel.depth;
      channel.exhausted = exhausted;
      retainedBytes += addedBytes;
      sequence++;
      return { ...receipt(), accepted: true };
    },
    takeCertified(limit) {
      if (!Number.isSafeInteger(limit) || limit < 0) fail('Invalid page limit.');
      if (terminalFailure) return { ...receipt(), hits: [] };
      const hits = [];
      while (hits.length < limit) {
        const candidates = [...rows.values()].filter(row => !emitted.has(row.id))
          .map(row => ({ row, bounds: interval(row) }))
          .sort((a, b) => b.bounds.lower - a.bounds.lower || compareId(a.row.id, b.row.id));
        const best = candidates[0];
        if (!best || best.bounds.lower <= 0) break;
        const unseen = channels.reduce((sum, channel) => sum + (channel.exhausted
          ? 0 : contribution(channel, channel.depth + 1)), 0);
        // Unknown unseen IDs cannot lose a tie by assumption.
        if (best.bounds.lower <= unseen && !channels.every(channel => channel.exhausted)) break;
        if (candidates.slice(1).some(other => best.bounds.lower < other.bounds.upper
          || best.bounds.lower === other.bounds.upper && compareId(best.row.id, other.row.id) > 0)) break;
        emitted.add(best.row.id);
        hits.push({ id: best.row.id, orderStatus: 'certified', position: emitted.size,
          scoreInterval: best.bounds,
          scoreStatus: best.bounds.lower === best.bounds.upper ? 'exact' : 'interval',
          certificateTarget: target.certificateTarget, targetId });
      }
      if (hits.length) sequence++;
      return { ...receipt(), hits };
    },
    inspect(id) {
      const row = rows.get(id);
      return row ? { id, scoreInterval: interval(row), emitted: emitted.has(id) } : null;
    },
    fail(reason) {
      if (!textId(reason)) fail('A failure reason is required.');
      terminalFailure = reason;
      sequence++;
      return receipt();
    },
    close() {
      rows.clear();
      emitted.clear();
      retainedBytes = 0;
      terminalFailure = 'closed';
    },
    receipt
  });
};
