import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertTuiSearchRequest } from '../../src/contracts/validators/tui-search.js';
import { STRING_FLAG_FIELDS, INTEGER_MIN_ZERO_FLAG_FIELDS, REPEATED_LIST_FIELDS } from '../../src/shared/search-request.js';
import { createTuiSearchSession } from '../../tools/tui/operator/search.js';

const request = { repoPath: process.cwd(), search: { query: 'alpha', mode: 'all', backend: 'memory', top: 5 } };
const resultId = randomUUID(), hitId = 'a'.repeat(64);
assert.equal(assertTuiSearchRequest('query', request), request);
assertTuiSearchRequest('describe', {});
assertTuiSearchRequest('status', {});
assertTuiSearchRequest('readiness', {});
const session = createTuiSearchSession({ toolRoot: process.cwd() });
const descriptor = session.describe({});
assert.deepEqual(descriptor.resultModes, ['code', 'prose', 'extracted-prose', 'records']);
assert.equal(descriptor.schema.properties.cursor, undefined);
descriptor.schema.properties.backend.enum.push('invented');
assert.equal(session.describe({}).schema.properties.backend.enum.includes('invented'), false,
  'caller metadata mutation cannot poison the canonical schema or future descriptions');
await session.dispose();
assertTuiSearchRequest('continue', { resultId });
assertTuiSearchRequest('source', { resultId, hitId });
assertTuiSearchRequest('open', { resultId, hitId, editor: 'code', confirmed: true, sourceHash: `sha1:${'a'.repeat(40)}` });
assertTuiSearchRequest('dispatch', { proto: 'poc.tui@1', op: 'search:run', jobId: 'search-1', method: 'query', params: request });
for (const [field] of STRING_FLAG_FIELDS) {
  assertTuiSearchRequest('query', { ...request, search: { [field]: 'alpha', query: 'alpha' } });
}
for (const [field] of INTEGER_MIN_ZERO_FLAG_FIELDS) {
  assertTuiSearchRequest('query', { ...request, search: { [field]: 0 } });
}
for (const [field] of REPEATED_LIST_FIELDS) {
  assertTuiSearchRequest('query', { ...request, search: { [field]: ['alpha', 'beta'] } });
}
const rejects = (kind, value) => assert.throws(() => assertTuiSearchRequest(kind, value), { code: 'ERR_TUI_SEARCH_REQUEST' });
rejects('readiness', { prerequisites: true });
rejects('status', { recoverResources: true });
for (const search of [{}, { query: 'alpha', unknown: true }, { query: 'alpha', top: -1 },
  { query: 'alpha', top: NaN }, { query: 'alpha', backend: 'invented' },
  { query: 'alpha', asOf: 'commit:a', snapshot: 'other' }, { query: 'alpha', cursor: 'forged' },
  { query: 'alpha', output: 'full' }, { query: 'alpha', repoPath: '../other' },
  { query: 'x'.repeat(128 * 1024) }]) rejects('query', { ...request, search });
rejects('query', { ...request, repoPath: 'bad\0path' });
rejects('continue', { resultId, cursor: 'forged' });
rejects('source', { resultId, hitId, path: '../private' });
rejects('source', { resultId, hitId: 'unknown' });
rejects('open', { resultId, hitId, editor: 'code', confirmed: false, sourceHash: `sha1:${'a'.repeat(40)}` });
rejects('open', { resultId, hitId, editor: 'arbitrary-command', confirmed: true, sourceHash: `sha1:${'a'.repeat(40)}` });
rejects('dispatch', { proto: 'poc.tui@1', op: 'search:run', jobId: 'bad\njob', method: 'query', params: request });
const cyclic = {}; cyclic.self = cyclic;
rejects('query', { ...request, search: cyclic });
let deep = {}; for (let i = 0; i < 25; i++) deep = { nested: deep };
rejects('query', { ...request, search: deep });
rejects('query', Object.assign(Object.create({ inherited: true }), request));
console.log('Native search envelopes preserve canonical predicates and reject malformed or forged authority');
