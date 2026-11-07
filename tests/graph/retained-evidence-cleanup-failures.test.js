import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { createRetainedEvidencePages } from '../../src/graph/retained-evidence-pages.js';
import { writeJsonLinesFileAsync } from '../../src/shared/json-stream/jsonl-write.js';
import { getContainedFileSession } from '../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';

// UNVALIDATED: real retained page/paired readers and original FileHandle faults.
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (error) { failed = true; failure = error; }
  assert.equal(failed, true, 'failed cleanup must withhold the page and cursor');
  return failure;
};
const visit = (failure, inspect) => {
  const queue = [failure], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); inspect(value);
    if (value === null || !['object', 'function'].includes(typeof value) || seen.has(value)) continue;
    seen.add(value);
    if (Object.hasOwn(value, 'cause')) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
};
const contains = (failure, expected) => {
  let found = false; visit(failure, value => { if (Object.is(value, expected)) found = true; }); return found;
};
const root = await makeTempDir('retained-evidence-cleanup-');
const originalOpen = fs.open, disposal = new Map();
try {
  const file = path.join(root, 'call_sites.jsonl'), offsets = file + '.offsets.bin';
  const rows = Array.from({ length: 48 }, (_, id) => ({ id, kind: 'retained', payload: 'x'.repeat(2048) }));
  await writeJsonLinesFileAsync(file, rows, { atomic: true, offsets: { path: offsets, atomic: true } });
  const pieces = [];
  for (const [name, location] of [['call_sites', file], ['call_sites_offsets', offsets]]) {
    const bytes = await fs.readFile(location);
    pieces.push({ name, path: path.basename(location), format: name === 'call_sites' ? 'jsonl' : 'bin',
      count: rows.length, bytes: bytes.length, checksum: 'sha256:' + createHash('sha256').update(bytes).digest('hex') });
  }
  assert.ok(pieces[0].bytes > 65536, 'keep both actual descriptors until page cleanup');
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'retained-cleanup', pieces };
  await fs.mkdir(path.join(root, 'pieces'));
  await fs.writeFile(path.join(root, 'pieces', 'manifest.json'), JSON.stringify(manifest));
  const create = matches => createRetainedEvidencePages({ indexDir: root, manifest, family: 'call_sites',
    ordering: 'fixture', errorPrefix: 'CALL_SITE', normalizeFilter: filter => filter,
    matches, validateRow: row => row.kind === 'retained' });
  const positive = await create(() => true).readPage({ limit: 2 });
  assert.deepEqual(positive.rows, rows.slice(0, 2)); assert.equal(typeof positive.cursor, 'string');

  const frozen = Object.freeze(Object.defineProperty(new Error('frozen original page failure'), 'code', { value: 'ORIGINAL_PAGE' }));
  let originalReady = false;
  const observed = Object.assign(new Error('independent original page work'), { cacheOwnershipPending: false,
    cacheOwnershipReleased() { assert.equal(this, observed); return originalReady; } });
  for (const primary of [null, undefined, false, 0, '', frozen, observed]) {
    const cleanup = primary === frozen ? false : Object.freeze(new Error('independent original descriptor close'));
    let allow = false, inspections = 0;
    const states = [];
    fs.open = async (location, ...args) => {
      const handle = await originalOpen(location, ...args);
      if (![file, offsets].includes(path.resolve(String(location)))) return handle;
      const read = handle.read, close = handle.close;
      const state = { handle, location: path.resolve(String(location)), reads: 0, closes: 0 }; states.push(state);
      disposal.set(handle, () => close.call(handle));
      handle.read = function(...values) { assert.equal(this, handle); state.reads++; return read.call(handle, ...values); };
      handle.close = async function() {
        assert.equal(this, handle); state.closes++;
        if (state.location === file && !allow) {
          if (primary === observed) observed.cacheOwnershipReleased = () => true;
          throw cleanup;
        }
        const result = await close.call(handle); disposal.delete(handle); return result;
      };
      return handle;
    };
    const failure = await rejected(() => create(() => { inspections++; throw primary; }).readPage());
    assert.equal(inspections, 1); assert.equal(contains(failure, primary), true); assert.equal(contains(failure, cleanup), true);
    assert.equal(states.length, 2); assert.ok(states.every(state => state.closes === 1));
    assert.equal(failure.cacheOwnershipReleased(), false);
    const sessions = new Set();
    visit(failure, value => { const session = getContainedFileSession(value); if (session) sessions.add(session); });
    assert.equal(sessions.size, 1, 'retain the exact failed descriptor without inventing group release authority');
    const reads = states.map(state => state.reads); allow = true;
    for (const session of sessions) {
      const receipt = await session.releaseAfterClose(); assert.equal(receipt.settled, true); assert.equal(receipt.pending, false);
    }
    if (primary === observed) {
      assert.equal(failure.cacheOwnershipReleased(), false, 'later observer replacement cannot settle original independent work');
      originalReady = true;
    }
    assert.equal(failure.cacheOwnershipReleased(), true); assert.deepEqual(states.map(state => state.reads), reads);
    assert.equal(inspections, 1, 'recovery cannot replay page selection or callback work');
    assert.ok(states.every(state => state.handle.fd === -1)); fs.open = originalOpen;
  }
  assert.equal(Object.hasOwn(frozen, 'cleanupError'), false);
  const after = await create(() => true).readPage({ limit: 2 }); assert.deepEqual(after.rows, rows.slice(0, 2));
} finally {
  fs.open = originalOpen;
  for (const dispose of disposal.values()) { try { await dispose(); } catch {} }
  await rmDirRecursive(root);
}
console.log('Retained page failures preserve falsey/frozen primary and independent descriptor cleanup causes.');
