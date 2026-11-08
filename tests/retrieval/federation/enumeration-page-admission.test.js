import assert from 'node:assert/strict';
import { enumerateWorkspace, withoutCursor } from '../../../src/retrieval/federation/enumeration.js';

assert.deepEqual(withoutCursor(['--cursor=outer', '--file', 'file.js', '--', '--cursor', 'literal']),
  ['--file', 'file.js', '--', '--cursor', 'literal']);
assert.deepEqual(withoutCursor(['--cursor', 'outer', '--', '--cursor=literal']), ['--', '--cursor=literal']);

const tasks = [{ repo: { repoId: 'repo', repoRootCanonical: process.cwd() }, mode: 'code' }];
const common = { tasks, args: ['--type', 'function'], manifestHash: 'admitted-generation',
  verifyGeneration: async () => {} };
const hit = { id: 0, chunkUid: 'uid' };
const page = () => ({ code: [hit], pagination: { returned: 1, hasMore: true, nextCursor: 'local-next' } });
const first = await enumerateWorkspace({ ...common, search: async () => page() });
assert.equal(first.pagination.hasMore, true);
const originalCursor = first.pagination.nextCursor;

const malformed = [
  null,
  { ok: false, code: [hit], pagination: { nextCursor: null } },
  { code: [hit], pagination: 'present' },
  { code: [hit], pagination: [] },
  { code: {}, pagination: { nextCursor: null } },
  { code: [null], pagination: { nextCursor: null } },
  { code: [hit], pagination: { nextCursor: '' } },
  { code: [hit], pagination: { nextCursor: 7 } },
  { code: [hit], pagination: { nextCursor: 'x'.repeat(8193) } },
  { code: [hit], pagination: { nextCursor: 'local-next', returned: 0 } },
  { code: [hit], pagination: { nextCursor: 'local-next', returned: 1.5 } },
  { code: [hit], pagination: { nextCursor: 'local-next', hasMore: false } },
  { code: [hit], pagination: { nextCursor: null, hasMore: true } },
  { code: [], pagination: { nextCursor: 'another-page' } }
];
for (const result of malformed) {
  await assert.rejects(enumerateWorkspace({ ...common, search: async () => result }), { code: 'INVALID_REQUEST' });
}
await assert.rejects(enumerateWorkspace({ ...common, cursor: originalCursor,
  search: async () => page() }), /did not advance/);
const final = await enumerateWorkspace({ ...common, cursor: originalCursor,
  search: async () => ({ code: [hit], pagination: { returned: 1, hasMore: false, nextCursor: null } }) });
assert.equal(final.pagination.hasMore, false);
assert.equal(final.pagination.nextCursor, null);

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
for (const value of [null, [], false, 0, 'string']) {
  await assert.rejects(enumerateWorkspace({ ...common, cursor: encode(value), search: async () => page() }), { code: 'INVALID_REQUEST' });
}
const decoded = JSON.parse(Buffer.from(originalCursor, 'base64url').toString());
for (const patch of [{ timeAnchor: 8.64e15 + 1 }, { localCursor: '' }, { localCursor: 'x'.repeat(8193) }, { position: tasks.length }]) {
  await assert.rejects(enumerateWorkspace({ ...common, cursor: encode({ ...decoded, ...patch }),
    search: async () => page() }), { code: 'INVALID_REQUEST' });
}

// Abort after an already-started operation returns and after the final
// generation fence must both prevent successful continuation publication.
for (const phase of ['search', 'generation']) {
  const controller = new AbortController();
  await assert.rejects(enumerateWorkspace({ ...common, signal: controller.signal,
    search: async () => { if (phase === 'search') controller.abort(); return page(); },
    verifyGeneration: async () => { if (phase === 'generation') controller.abort(); }
  }), { name: 'AbortError' });
}
console.log('Federated enumeration admits bounded advancing pages and preserves literal option tails.');
