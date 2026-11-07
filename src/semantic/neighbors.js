import { canonicalSemanticJson } from '../index/semantic/identity.js';
import { SEMANTIC_EDGE_KINDS } from '../contracts/schemas/semantic.js';
import { captureSemanticRecordRef } from './reader-input.js';
const fail = () => new TypeError('Invalid semantic neighbor request.');
const captureKinds = input => {
  if (!Array.isArray(input)) throw fail();
  const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 1) throw fail();
  const selected = new Set();
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !SEMANTIC_EDGE_KINDS.includes(descriptor.value)) throw fail();
    selected.add(descriptor.value);
  }
  return Object.freeze([...selected]);
};
/** Offset counts incident rows, including filtered rows; each call reads at most limit rows. */
export const createNeighborReader = getRelatedPage => {
  const read = async (ref, direction, kinds, options = {}) => {
    if (!['upstream', 'downstream'].includes(direction)) throw fail();
    ref = captureSemanticRecordRef(ref, fail);
    kinds = captureKinds(kinds);
    const { offset = 0, limit = 128, signal = null, metrics = null } = options;
    const page = await getRelatedPage(ref, 'semantic_edges', Object.freeze({ offset, limit, signal, metrics }));
    const endpoint = direction === 'downstream' ? 'from' : 'to';
    const identity = canonicalSemanticJson(ref);
    const entries = page.rows.map((row, index) => ({
      edge: kinds.includes(row.kind) && canonicalSemanticJson(row[endpoint]) === identity ? row : null,
      offset: offset + index + 1
    }));
    return { edges: entries.map(entry => entry.edge).filter(Boolean), entries, offset: page.offset, done: page.done };
  };
  // Trace can consume an incident-row batch without losing filtered-row cursor
  // positions. Test/custom readers without this capability retain one-row reads.
  read.supportsPositions = true;
  return read;
};
