import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSearchPayloadFromQuery, buildSearchParams } from '../../../tools/api/router/search.js';
import { buildMcpSearchArgs } from '../../../tools/mcp/tools/search-args.js';
import { createSearchValidator } from '../../../tools/api/validation.js';
import { createApiRouter } from '../../../tools/api/router.js';
import { closeRepoCacheEntry } from '../../../src/shared/repo-cache-config.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const validate = createSearchValidator();
const conflicts = [
  'snapshotId=snap-A&snapshot=snap-B', 'snapshot=snap-B&snapshotId=snap-A',
  'snapshotId=snap-A&snapshotId=snap-B', 'snapshotId=snap-B&snapshotId=snap-A',
  'snapshot=snap-A&snapshot=snap-B', 'asOf=build-A&as-of=build-B', 'as-of=build-B&asOf=build-A',
  'asOf=build-A&asOf=build-B', 'as-of=build-B&as-of=build-A'
];
const blanks = ['snapshot=', 'snapshotId=%20', 'asOf=', 'as-of=%20', 'snapshotId=&snapshotId=snap-A'];
for (const query of [...conflicts, ...blanks]) {
  const { payload, errors } = buildSearchPayloadFromQuery(new URLSearchParams(`q=needle&${query}`));
  assert.ok(errors.length || !validate(payload).ok, query + ' must fail before selector information is lost');
}
for (const [query, flag, expected] of [
  ['snapshot=snap-A', '--snapshot', 'snap-A'], ['snapshotId=snap-A', '--snapshot', 'snap-A'],
  ['snapshot=snap-A&snapshotId=snap-A', '--snapshot', 'snap-A'],
  ['snapshotId=snap-A&snapshotId=snap-A', '--snapshot', 'snap-A'],
  ['as-of=build-A', '--as-of', 'build-A'], ['asOf=build-A&as-of=build-A&asOf=build-A', '--as-of', 'build-A']
]) {
  const { payload, errors } = buildSearchPayloadFromQuery(new URLSearchParams(`q=needle&${query}`));
  assert.deepEqual(errors, []); assert.equal(validate(payload).ok, true);
  const result = buildSearchParams(null, payload, 'json');
  assert.equal(result.ok, true); assert.equal(result.args.filter(value => value === flag).length, 1);
  assert.equal(result.args[result.args.indexOf(flag) + 1], expected);
  const mcp = buildMcpSearchArgs(payload);
  assert.equal(mcp.filter(value => value === flag).length, 1); assert.equal(mcp[mcp.indexOf(flag) + 1], expected);
}
for (const payload of [
  { query: 'needle', snapshot: 'snap-A', snapshotId: 'snap-B' },
  ...['asOf', 'snapshot', 'snapshotId'].map(field => ({ query: 'needle', [field]: ' ' }))
]) {
  assert.equal(validate(payload).ok, false);
  assert.equal(buildSearchParams(null, payload, 'json').ok, false);
  assert.throws(() => buildMcpSearchArgs(payload), error => error.code === 'INVALID_REQUEST');
}
const ordinary = buildSearchPayloadFromQuery(new URLSearchParams('q=needle&path=src&path=tools&paths=docs'));
assert.deepEqual(ordinary.errors, []); assert.equal(validate(ordinary.payload).ok, true);
assert.deepEqual(ordinary.payload.path, ['src', 'tools', 'docs']);
assert.equal(Object.hasOwn(ordinary.payload, 'snapshotId'), false);
assert.ok(!buildSearchParams(null, ordinary.payload, 'json').args.includes('--snapshot'));

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-history-admission-'));
let searchAdmissions = 0;
const router = createApiRouter({ host: '127.0.0.1', defaultRepo: root, defaultOutput: 'json', metricsRegistry: null,
  repoCache: { shutdown(entry) { searchAdmissions++; closeRepoCacheEntry(entry); } } });
const server = http.createServer((req, res) => router.handleRequest(req, res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  for (const query of [...conflicts, ...blanks]) {
    const response = await fetch(`${base}/search?q=needle&${query}`);
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).code, 'INVALID_REQUEST');
  }
  for (const payload of [{ query: 'needle', snapshot: 'snap-A', snapshotId: 'snap-B' },
    { query: 'needle', asOf: 'build-A', snapshotId: 'snap-B' }, { query: 'needle', snapshotId: ' ' }]) {
    const response = await fetch(`${base}/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal(response.status, 400); assert.equal((await response.json()).code, 'INVALID_REQUEST');
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  await router.close();
  await fs.rm(root, { recursive: true, force: true });
}
assert.equal(searchAdmissions, 0, 'real GET/POST rejection must occur before search creates a repository cache entry');
console.log('Historical selectors retain alias/repetition intent and fail canonical admission before HTTP search dispatch.');
