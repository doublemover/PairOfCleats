import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSemanticServingFixture } from '../../helpers/semantic-serving-fixture.js';
import { buildSemanticContextSection } from '../../../src/context-pack/semantic.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';

const fixture = await createSemanticServingFixture(), originalOpen = fs.open, disposal = new Map();
const input = { repoRoot: fixture.root, indexDir: fixture.indexDir, primary: { file: 'original.js' } };
const reject = async run => {
  let failure, rejected = false;
  try { await run(); } catch (error) { rejected = true; failure = error; }
  assert.equal(rejected, true, 'original resource failure must withhold the optional section'); return failure;
};
const contains = (failure, expected) => {
  const queue = [failure], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); if (value === expected) return true;
    if (!value || !['object', 'function'].includes(typeof value) || seen.has(value)) continue;
    seen.add(value); if (Object.hasOwn(value, 'cause')) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
  return false;
};
try {
  const section = await buildSemanticContextSection(input);
  assert.equal(section.status, 'partial'); assert.equal(section.discovery.records.length, 2);
  assert.equal(section.detail.records.length, 2); assert.equal(section.trace.records[0].id, 0);
  assert.equal(section.excerpts[0].text, 'first();');
  assert.ok(section.followUps.every(row => row.request.repoRoot === fixture.root
    && row.request.generation.baseBuildId === fixture.generation.baseBuildId));
  for (const phase of ['metadata', 'excerpt']) {
    let deny = true, state;
    const primary = Object.freeze(Object.assign(new Error('original ' + phase + ' descriptor close failed'), {
      code: phase === 'metadata' ? 'ENOENT' : 'ERR_SEMANTIC_OUTPUT_LIMIT'
    }));
    fs.open = async (file, ...args) => {
      const handle = await originalOpen(file, ...args), read = handle.read, close = handle.close;
      const filename = path.resolve(String(file)).toLowerCase();
      const selected = phase === 'metadata' ? filename.endsWith('semantic_manifest.json') : filename.endsWith('.utf8');
      if (!selected) return handle;
      state = { handle, reads: 0, closes: 0 }; disposal.set(handle, () => close.call(handle));
      handle.read = function (...readArgs) { state.reads++; return read.call(handle, ...readArgs); };
      handle.close = async function () {
        state.closes++; if (deny) throw primary;
        const value = await close.call(handle); disposal.delete(handle); return value;
      };
      return handle;
    };
    try {
      const failure = await reject(() => buildSemanticContextSection(input));
      assert.equal(contains(failure, primary), true); assert.equal(failure.cacheOwnershipReleased(), false);
      assert.equal(state.closes, 1); const reads = state.reads; deny = false;
      await getContainedFileSession(failure).releaseAfterClose();
      assert.equal(state.handle.fd, -1); assert.equal(state.reads, reads); assert.equal(state.closes, 2);
      assert.equal(failure.cacheOwnershipReleased(), true);
    } finally { fs.open = originalOpen; }
  }
  {
    let closeStarted, finishClose, returned = false;
    const started = new Promise(resolve => { closeStarted = resolve; }), closing = new Promise(resolve => { finishClose = resolve; });
    const pending = buildSemanticContextSection({ ...input, async openStore(options) {
      const opened = await openPublishedSemanticStore(options);
      return { ...opened, close() { closeStarted(); return closing; } };
    } });
    const completion = pending.then(value => { returned = true; return value; });
    await Promise.race([started, completion]); assert.equal(returned, false);
    finishClose(); assert.equal((await pending).status, 'partial');
  }
  {
    const closeFailure = Object.freeze(Object.assign(new Error('settled store close is still a failure'), { code: 'ENOENT' }));
    const failure = await reject(() => buildSemanticContextSection({ ...input, async openStore(options) {
      return { ...await openPublishedSemanticStore(options), close: async () => { throw closeFailure; } };
    } }));
    assert.equal(failure, closeFailure, 'cleanup failure cannot become an ordinary missing-family diagnostic');
  }
  {
    const controller = new AbortController(); let reads = 0, closes = 0;
    fs.open = async (file, ...args) => {
      const handle = await originalOpen(file, ...args), read = handle.read, close = handle.close;
      handle.read = async function (...readArgs) { reads++; const value = await read.call(handle, ...readArgs); controller.abort(); return value; };
      handle.close = async function () { closes++; return close.call(handle); }; return handle;
    };
    try { await assert.rejects(buildSemanticContextSection({ ...input, signal: controller.signal }), { code: 'ABORT_ERR' }); }
    finally { fs.open = originalOpen; }
    assert.equal(reads, 1); assert.equal(closes, 1, 'context composition passes cancellation into its first metadata owner');
  }
  {
    const missing = Object.assign(new Error('registered family absent'), { code: 'ERR_SEMANTIC_UNAVAILABLE' });
    const ordinary = await buildSemanticContextSection({ ...input, openStore: async () => { throw missing; } });
    assert.equal(ordinary.status, 'unavailable'); assert.match(ordinary.warnings[0], /ERR_SEMANTIC_UNAVAILABLE/);
  }
} finally {
  fs.open = originalOpen; for (const dispose of disposal.values()) await dispose(); await fixture.cleanup();
}
console.log('Semantic context composition preserves original reader failures and awaits every owned store cleanup.');
