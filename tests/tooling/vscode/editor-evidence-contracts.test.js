import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { snapshotConfiguration, renderEffectiveSettings } = require('../../../extensions/vscode/effective-settings.js');
const { normalizeFilterPagination, mergeFilterPage, continuationInvocation } = require('../../../extensions/vscode/filter-pagination.js');
const { buildSemanticRequest, describeSemanticEvidence } = require('../../../extensions/vscode/semantic-evidence.js');
const { buildSearchArgs, buildSearchPayload } = require('../../../extensions/vscode/search-contract.js');

const source = {
  searchMode: { defaultValue: 'both', workspaceFolderValue: 'records' },
  cliPath: { defaultValue: '', globalValue: '/trusted/cli.js', workspaceFolderValue: '/project/cli.js' },
  env: { defaultValue: {}, globalValue: { PAIR_TOKEN: 'never display this' } }
};
const config = { inspect: key => source[key], get: key => source[key].workspaceFolderValue ?? source[key].globalValue ?? source[key].defaultValue };
const snapshot = snapshotConfiguration(config, Object.keys(source));
assert.equal(snapshot.get('searchMode'), 'records');
assert.equal(snapshot.get('cliPath'), '/trusted/cli.js');
assert.equal(snapshot.evidence.find(row => row.key === 'cliPath').ignoredWorkspaceValue, true);
assert.equal(snapshot.evidence.find(row => row.key === 'env').value, '[redacted]');
source.searchMode.workspaceFolderValue = 'prose';
assert.equal(snapshot.get('searchMode'), 'records', 'an in-flight snapshot does not observe later settings');
const rendered = renderEffectiveSettings({ snapshot, repoContext: { repoRoot: '/chosen' } });
assert.match(rendered, /Repository: \/chosen/);
assert.doesNotMatch(rendered, /never display this|\/project\/cli/);

const generation = { baseBuildId: 'build-a', semanticRevision: 0 };
const pagination = normalizeFilterPagination({ kind: 'filter', generation: 'a'.repeat(64), total: 4, returned: 2, hasMore: true, nextCursor: 'opaque' });
const previous = { pagination, hits: [{ section: 'code', chunkUid: 'a', file: 'a.js', name: 'same' }] };
const merged = mergeFilterPage(previous, { ...pagination, hasMore: false }, [
  { section: 'code', chunkUid: 'a', file: 'a.js', name: 'same' },
  { section: 'code', chunkUid: 'b', file: 'b.js', name: 'same' },
  { section: 'records', chunkUid: 'a', file: 'record.json', name: 'same' },
  { file: 'unknown-id.js', name: 'same' }
]);
assert.equal(merged.length, 4, 'only exact namespaced identities are deduplicated');
assert.throws(() => mergeFilterPage(previous, { ...pagination, generation: 'b'.repeat(64) }, []), /generation changed/);
const invocation = { kind: 'cli-search', command: 'node', args: ['cli.js', 'search', '--filter', 'lang:js', '--', ''] };
assert.deepEqual(continuationInvocation(invocation, 'next').args, ['cli.js', 'search', '--filter', 'lang:js', '--cursor', 'next', '--', '']);
assert.deepEqual(invocation.args, ['cli.js', 'search', '--filter', 'lang:js', '--', ''], 'frozen search scope remains intact');
assert.equal(continuationInvocation({ kind: 'api-search', payload: { query: '', type: 'function' } }, 'next').payload.cursor, 'next');
assert.equal(buildSearchArgs('', '/chosen', { mode: 'all', filter: 'lang:js' }).at(-1), '');
assert.equal(buildSearchPayload('', '/chosen', { mode: 'records', type: 'function' }).query, '');
assert.throws(() => buildSearchPayload('', '/chosen', { backend: 'tantivy' }), /API does not admit/);
assert.throws(() => buildSearchArgs('x', '/chosen', { mode: 'invented' }), /Unsupported search mode/);

const ref = { partitionId: `sy1:${'a'.repeat(64)}`, localId: 2 };
const find = buildSemanticRequest('find', '/chosen', generation, { field: 'sourcePath', value: 'a.js' });
assert.deepEqual(find.limits, { records: 128, bytes: 65536, workMs: 250 });
const detail = buildSemanticRequest('detail', '/chosen', generation, ref);
assert.deepEqual(detail.refs, [ref]);
assert.equal(detail.limits.rows, 512);
const trace = buildSemanticRequest('trace', '/chosen', generation, ref, { direction: 'downstream', depth: 999 });
assert.equal(trace.limits.depth, 64);
assert.equal(trace.limits.edges, 512);
const planned = buildSemanticRequest('enrichment', '/chosen', generation, ['task']);
assert.equal(planned.action, 'plan', 'editor enrichment starts with planning, never execution');
assert.match(describeSemanticEvidence({ generation, status: 'partial', frontier: [{ reason: 'work_budget' }] }), /does not prove absence of flow/);
assert.throws(() => buildSemanticRequest('find', '/chosen', null, {}), /pinned semantic generation/);
console.log('Editor settings snapshots, indexed continuation and bounded semantic request contracts passed');
