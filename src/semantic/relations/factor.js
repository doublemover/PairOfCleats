import { randomUUID } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { prepareSemanticBatchEntry, semanticBatchEntryBytes } from '../../index/semantic/prepared-batch.js';

const owned = new WeakMap();
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const key = canonicalSemanticJson;
const make = node => {
  const handle = Object.freeze({ rootId: node.rootId, cardinality: node.count.toString(),
    schema: Object.freeze(node.schema.map(attribute => Object.freeze({ ...attribute }))),
    semantics: 'occurrence-bag', annotation: 'positive-natural-v1' });
  owned.set(handle, node);
  return handle;
};
const get = handle => { const node = owned.get(handle); if (!node) throw new TypeError('Owned factor relation required.'); return node; };
const tupleValue = (value, attribute) => value === null ? attribute.nullable === true
  : attribute.type === 'string' ? typeof value === 'string' && value.length <= 4096
    : attribute.type === 'integer' ? Number.isSafeInteger(value) : false;

/** Small flat reference provider; immutable rows reuse the existing prepared-row owner. */
export const createOccurrenceRelation = ({ world, relationId, atomRoleId, schema, rows,
  complete = false, maxRetainedBytes = 8 * 1024 * 1024 }) => {
  if (!world || !text(relationId) || !text(atomRoleId) || !Array.isArray(schema) || !schema.length || schema.length > 128
    || schema.some(attribute => Object.keys(attribute).length !== 3 || !text(attribute.name) || !['string', 'integer'].includes(attribute.type)
      || typeof attribute.nullable !== 'boolean') || new Set(schema.map(attribute => attribute.name)).size !== schema.length
    || !Array.isArray(rows) || rows.length > 65536 || typeof complete !== 'boolean'
    || !Number.isSafeInteger(maxRetainedBytes) || maxRetainedBytes < 1) throw new TypeError('Invalid occurrence relation descriptor.');
  const ids = new Set(), entries = [];
  let count = 0n, bytes = 0;
  for (const row of rows) {
    if (!text(row.occurrenceId) || !text(row.supportId) || !Array.isArray(row.tuple)
      || row.tuple.length !== schema.length || row.tuple.some((value, index) => !tupleValue(value, schema[index]))
      || typeof row.multiplicity !== 'string' || !/^[1-9][0-9]{0,127}$/.test(row.multiplicity)
      || !Object.hasOwn(row, 'sourceRef')) throw new TypeError('Invalid typed occurrence row.');
    const id = key([row.occurrenceId, row.supportId]);
    if (ids.has(id)) throw new TypeError('Duplicate occurrence/support identity.');
    ids.add(id);
    const prepared = prepareSemanticBatchEntry({ family: 'derived-occurrence-view', row });
    bytes += semanticBatchEntryBytes(prepared);
    if (bytes > maxRetainedBytes) throw new RangeError('Occurrence retention allowance exceeded; no relation published.');
    const multiplicity = BigInt(row.multiplicity);
    entries.push({ row: prepared.row, start: count, end: count + multiplicity });
    count += multiplicity;
  }
  const immutableWorld = JSON.parse(key(world));
  return make({ kind: 'leaf', world: immutableWorld, schema: JSON.parse(key(schema)), roles: [atomRoleId],
    entries, count, complete, depth: 1, rowWork: 1 + Math.ceil(Math.log2(entries.length + 1)) + schema.length, bytes,
    rootId: semanticHash('pairofcleats.occurrence-relation.v1', { world, relationId, atomRoleId, schema, complete,
      rows: entries.map(entry => entry.row) }) });
};

const compose = (kind, handles) => {
  if (!Array.isArray(handles) || !handles.length || handles.length > 128) throw new TypeError('Bounded factor children required.');
  const children = handles.map(get), first = children[0];
  if (children.some(child => key(child.world) !== key(first.world))) throw new TypeError('Factor worlds must match exactly.');
  const depth = 1 + Math.max(...children.map(child => child.depth));
  if (depth > 32) throw new RangeError('Factor depth allowance exceeded.');
  let schema, roles, count;
  if (kind === 'sum') {
    if (children.some(child => key(child.schema) !== key(first.schema) || key(child.roles) !== key(first.roles))) {
      throw new TypeError('Factor sums require identical attributes and original atom roles.');
    }
    schema = first.schema; roles = first.roles; count = children.reduce((sum, child) => sum + child.count, 0n);
  } else {
    schema = children.flatMap(child => child.schema); roles = children.flatMap(child => child.roles);
    if (schema.length > 1024 || new Set(schema.map(attribute => attribute.name)).size !== schema.length
      || new Set(roles).size !== roles.length) throw new TypeError('Factor products require disjoint attributes and original atom roles.');
    count = children.reduce((product, child) => product * child.count, 1n);
  }
  const rowWork = children.reduce((sum, child) => sum + child.rowWork, 1);
  if (!Number.isSafeInteger(rowWork)) throw new RangeError('Factor work exceeds supported exact accounting.');
  return make({ kind, children, world: first.world, schema, roles, count, depth, rowWork,
    complete: children.every(child => child.complete),
    rootId: semanticHash('pairofcleats.factor-relation.v1', { kind, children: handles.map(handle => handle.rootId) }) });
};
export const sumOccurrenceRelations = handles => compose('sum', handles);
export const productOccurrenceRelations = handles => compose('product', handles);

const rowAt = (node, ordinal) => {
  if (node.kind === 'leaf') {
    let low = 0, high = node.entries.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (node.entries[middle].end <= ordinal) low = middle + 1; else high = middle;
    }
    const entry = node.entries[low], row = entry.row;
    return { tuple: Object.fromEntries(node.schema.map((attribute, index) => [attribute.name, row.tuple[index]])), factorChoices: [],
      occurrences: [{ atomRoleId: node.roles[0], occurrenceId: row.occurrenceId, supportId: row.supportId,
        copyOrdinal: (ordinal - entry.start).toString(), sourceRef: row.sourceRef }] };
  }
  if (node.kind === 'sum') {
    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index];
      if (ordinal < child.count) {
        const result = rowAt(child, ordinal);
        return { ...result, factorChoices: [{ rootId: node.rootId, alternative: index }, ...result.factorChoices] };
      }
      ordinal -= child.count;
    }
  }
  const parts = [];
  for (let index = node.children.length - 1; index >= 0; index--) {
    const child = node.children[index];
    parts.unshift(rowAt(child, ordinal % child.count)); ordinal /= child.count;
  }
  return { tuple: Object.fromEntries(parts.flatMap(part => Object.entries(part.tuple))),
    occurrences: parts.flatMap(part => part.occurrences), factorChoices: parts.flatMap(part => part.factorChoices) };
};

/** Same-owner lazy bag cursor. Full cardinality is exact BigInt, never a rounded Number. */
export const openOccurrenceCursor = ({ relation, release = () => {} }) => {
  let node = get(relation), offset = 0n, closed = false;
  const continuation = randomUUID();
  return Object.freeze({
    next({ limit = 64, workBudget = 10000, maxBytes = 65536, signal,
      cursor = continuation, rootId = relation.rootId } = {}) {
      if (closed) throw new Error('Occurrence cursor closed.');
      if (cursor !== continuation || rootId !== relation.rootId) throw new Error('Incompatible occurrence continuation.');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256 || !Number.isSafeInteger(workBudget) || workBudget < 0
        || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('Invalid relation page allowance.');
      const items = [];
      let work = 0, bytes = 0, reason = null;
      while (items.length < limit && offset < node.count) {
        if (signal?.aborted) { reason = 'cancelled'; break; }
        if (work + node.rowWork > workBudget) { reason = 'work-budget'; break; }
        const row = rowAt(node, offset), rowBytes = Buffer.byteLength(key(row)) + 1;
        work += node.rowWork;
        if (bytes + rowBytes > maxBytes) { reason = 'response-byte-budget'; break; }
        items.push(row); bytes += rowBytes; offset++;
      }
      return { items, continuation, rootId, offset: offset.toString(), consumedWork: work, emittedBytes: bytes,
        state: reason ? 'paused' : offset === node.count ? 'exhausted' : 'running', reason,
        retainedEnumerationComplete: offset === node.count, capturedDomainComplete: node.complete,
        semanticClosure: 'not-implied', resumability: 'same-owner-only' };
    },
    close() { if (!closed) { closed = true; node = null; release(); } }
  });
};
