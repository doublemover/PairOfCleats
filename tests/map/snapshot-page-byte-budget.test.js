import assert from 'node:assert/strict';
import { MAP_MODEL_VERSION } from '../../src/map/constants.js';
import { MAP_DATA_PROTOCOL } from '../../src/map/isometric/client/data/protocol.js';
import { createMapSnapshotTransport } from '../../tools/analysis/map-snapshot-transport.js';
import { createSnapshotRowByteBudget } from '../../tools/analysis/map-snapshot-page-budget.js';

// Independent pre-change whole-envelope oracle: compare exact page membership,
// cursor and JSON bytes, not a timing threshold or a mirror byte formula.
const wrap = (request, value) => ({ protocol: MAP_DATA_PROTOCOL, snapshot: request.snapshot,
  request: request.request, revision: request.revision, kind: request.kind, ...value });
const normalOracle = (request, rows, maxBytes) => {
  const output = []; let next = request.cursor;
  while (next < Math.min(rows.length, request.cursor + request.limit)) {
    const trial = wrap(request, { cursor: request.cursor, next: next + 1 < rows.length ? next + 1 : null,
      total: rows.length, rows: [...output, rows[next]] });
    if (Buffer.byteLength(JSON.stringify(trial)) > maxBytes) {
      if (!output.length) throw new Error('record exceeds response budget');
      break;
    }
    output.push(rows[next++]);
  }
  return wrap(request, { cursor: request.cursor, next: next < rows.length ? next : null, total: rows.length, rows: output });
};
const searchOracle = (request, rows, maxBytes) => {
  const output = []; let closed = false;
  for (let ordinal = request.cursor; ordinal < rows.length && output.length < request.limit && !closed; ordinal++) {
    const trial = wrap(request, { rows: [...output, rows[ordinal]], cursor: request.cursor,
      next: Number.MAX_SAFE_INTEGER, total: Number.MAX_SAFE_INTEGER, complete: true });
    if (Buffer.byteLength(JSON.stringify(trial)) > maxBytes) {
      if (!output.length) throw new Error('record exceeds response budget');
      closed = true;
    } else output.push(rows[ordinal]);
  }
  return wrap(request, { rows: output, cursor: request.cursor,
    next: request.cursor + output.length < rows.length ? request.cursor + output.length : null,
    total: rows.length, complete: true });
};
const model = { version: MAP_MODEL_VERSION, nodes: Array.from({ length: 23 }, (_, fileRow) => ({
  id: fileRow, path: `dir/${fileRow}-😀-"quoted".ts`, name: `file\\${fileRow}`, category: fileRow % 2 ? null : 'code',
  members: Array.from({ length: 11 }, (_, memberOrdinal) => ({ id: memberOrdinal === 0 ? 0 : `opaque:${fileRow}:${memberOrdinal}:😀`,
    name: `symbol-${memberOrdinal}-\n-"-\\-😀`, kind: 'function', range: { startLine: memberOrdinal + 1, endLine: memberOrdinal + 2 } }))
})), edges: [] };
// Use unique typed IDs within the admitted source model.
for (let fileRow = 1; fileRow < model.nodes.length; fileRow++) model.nodes[fileRow].members[0].id = `zero:${fileRow}`;
model.edges = model.nodes.slice(1).map((file, row) => ({ from: { file: model.nodes[row].path }, to: { file: file.path }, type: 'import' }));
const files = model.nodes.map((file, row) => ({ id: file.id, path: file.path, name: file.name, category: file.category,
  type: 'file', ext: null, row, memberCount: file.members.length }));
const members = model.nodes[0].members.map((member, ordinal) => ({ id: member.id, name: member.name, kind: member.kind,
  type: null, range: member.range, exported: null, file: model.nodes[0].path, ordinal, address: { fileRow: 0, memberOrdinal: ordinal } }));
const edges = model.edges.map((edge, row) => ({ row, from: edge.from, to: edge.to, type: edge.type }));
const searchRows = model.nodes.flatMap((file, fileRow) => file.members.map((member, memberOrdinal) => ({
  type: 'member', id: member.id, file: file.path, name: member.name, range: member.range, address: { fileRow, memberOrdinal }
})));
for (const maxResponseBytes of [1024, 1536, 2048, 8192]) {
  const snapshotId = `pinned:row-bytes:${maxResponseBytes}`;
  const transport = createMapSnapshotTransport({ model, snapshotId, maxResponseBytes });
  try {
    for (const limit of [1, 3, 17, 80, 256]) {
      for (const [kind, rows] of [['files', files], ['members', members], ['edges', edges]]) {
        for (const cursor of [0, 1, rows.length - 1, rows.length]) {
          const request = { protocol: MAP_DATA_PROTOCOL, snapshot: snapshotId, request: 1, revision: 9, kind,
            cursor, limit, ...(kind === 'members' ? { fileRow: 0 } : {}) };
          const actual = transport.respond(request), expected = normalOracle(request, rows, maxResponseBytes);
          assert.equal(actual.toString(), JSON.stringify(expected)); assert(actual.length <= maxResponseBytes);
        }
      }
      for (const cursor of [0, 10, 99, searchRows.length - 1, searchRows.length]) {
        const request = { protocol: MAP_DATA_PROTOCOL, snapshot: snapshotId, request: 2, revision: 9,
          kind: 'search', query: 'symbol', entityType: 'member', cursor, limit };
        const expected = JSON.stringify(searchOracle(request, searchRows, maxResponseBytes));
        assert.equal(transport.respond(request).toString(), expected);
        const asynchronous = await transport.respondAsync(request);
        assert.equal(asynchronous.toString(), expected); assert(asynchronous.length <= maxResponseBytes);
      }
    }
  } finally { transport.dispose(); }
}

let reads = 0;
const countRows = Array.from({ length: 256 }, (_, id) => ({ id, get label() { reads++; return 'escaped "\\\n 😀'; } }));
const budget = createSnapshotRowByteBudget({ maxResponseBytes: 256 * 1024, emptyEnvelope: { rows: [], cursor: 0, next: null, total: 256 } });
for (const row of countRows) assert.equal(budget.admit(row), true);
assert.equal(reads, countRows.length, 'admission serializes each candidate once instead of every previously retained candidate');
const undefinedBudget = createSnapshotRowByteBudget({ maxResponseBytes: Buffer.byteLength('{"rows":[null]}'), emptyEnvelope: { rows: [] } });
assert.equal(undefinedBudget.admit(undefined), true, 'array undefined representation is budgeted as null');
assert.equal(undefinedBudget.admit(undefined), false);

let rangeReads = 0;
const instrumented = { version: MAP_MODEL_VERSION, nodes: [{ path: 'one.ts', members: Array.from({ length: 256 }, (_, id) => ({
  id, name: `symbol${id}`, range: { get startLine() { rangeReads++; return 1; }, endLine: 2 }
})) }], edges: [] };
const measured = createMapSnapshotTransport({ model: instrumented, snapshotId: 'pinned:row-visits' });
try {
  const response = measured.respond({ protocol: MAP_DATA_PROTOCOL, snapshot: 'pinned:row-visits', request: 1,
    revision: 0, kind: 'members', fileRow: 0, cursor: 0, limit: 256 });
  assert.equal(JSON.parse(response).rows.length, 256);
  assert.equal(rangeReads, 512, 'actual member response observes each row for one admission and one final encoding');
} finally { measured.dispose(); }

const oversized = createMapSnapshotTransport({ model: { version: MAP_MODEL_VERSION,
  nodes: [{ path: 'huge.ts', members: [{ id: 0, name: 'x'.repeat(4096) }] }], edges: [] }, snapshotId: 'pinned:too-large', maxResponseBytes: 1024 });
try {
  for (const kind of ['members', 'search']) {
    const request = { protocol: MAP_DATA_PROTOCOL, snapshot: 'pinned:too-large', request: 1, revision: 0, kind,
      fileRow: 0, query: 'x', cursor: 0, limit: 256 };
    assert.throws(() => oversized.respond(request), /response budget/);
    await assert.rejects(oversized.respondAsync(request), /response budget/);
  }
} finally { oversized.dispose(); }
console.log('Snapshot page UTF-8 byte/original-envelope parity and serialization-visit controls authored; execution deferred.');
