import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { snapshotConfiguration, renderEffectiveSettings } = require('../../../extensions/vscode/effective-settings.js');
const { normalizeFilterPagination, mergeFilterPage, continuationInvocation } = require('../../../extensions/vscode/filter-pagination.js');
const { buildSemanticRequest, scalarLiteralSelector, qualifiedBindingSeed,
  createSemanticEvidenceWorkflow, describeSemanticEvidence } = require('../../../extensions/vscode/semantic-evidence.js');
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
const bound = { status: 'resolved', generation, binding: { status: 'resolved', targetId: JSON.stringify(ref) } };
assert.deepEqual(qualifiedBindingSeed(bound), { generation, selector: { target: ref } });
assert.equal(qualifiedBindingSeed({ ...bound, status: 'partial' }), null);
assert.equal(qualifiedBindingSeed({ ...bound, binding: { ...bound.binding, status: 'ambiguous' } }), null);
assert.equal(qualifiedBindingSeed({ ...bound, binding: { status: 'resolved', targetId: 'spelling-only' } }), null);
const find = buildSemanticRequest('find', '/chosen', generation, { field: 'sourcePath', value: 'a.js' });
assert.deepEqual(find.limits, { records: 128, bytes: 65536, workMs: 250 });
const detail = buildSemanticRequest('detail', '/chosen', generation, ref);
assert.deepEqual(detail.refs, [ref]);
assert.equal(detail.limits.rows, 512);
const trace = buildSemanticRequest('trace', '/chosen', generation, ref, { direction: 'downstream', depth: 999 });
assert.equal(trace.limits.depth, 64);
assert.equal(trace.limits.edges, 512);
const slotted = buildSemanticRequest('trace', '/chosen', generation, ref, { direction: 'upstream', depth: 3,
  kinds: ['argumentToParameter'], slot: { name: 'argument', ordinal: 2 } });
assert.deepEqual(slotted.slot, { name: 'argument', ordinal: 2 });
assert.deepEqual(slotted.kinds, ['argumentToParameter']);
assert.deepEqual(scalarLiteralSelector('string', ''), { literal: { type: 'string', representation: '""' } });
assert.equal(scalarLiteralSelector('string', '雪😀').literal.representation, '"雪😀"');
assert.equal(scalarLiteralSelector('boolean', 'false').literal.representation, 'false');
assert.equal(scalarLiteralSelector('null').literal.representation, 'null');
assert.equal(scalarLiteralSelector('number', '-0').literal.representation, '-0');
assert.equal(scalarLiteralSelector('bigint', '9007199254740993').literal.representation, '9007199254740993');
for (const [type, value] of [['number', 'Infinity'], ['number', '1\n'], ['bigint', '1n'], ['boolean', 'False']]) {
  assert.throws(() => scalarLiteralSelector(type, value), /representation/);
}
const planned = buildSemanticRequest('enrichment', '/chosen', generation, ['task']);
assert.equal(planned.action, 'plan', 'editor enrichment starts with planning, never execution');
assert.match(describeSemanticEvidence({ generation, status: 'partial', frontier: [{ reason: 'work_budget' }] }), /does not prove absence of flow/);
assert.throws(() => buildSemanticRequest('find', '/chosen', null, {}), /pinned semantic generation/);

const dispatched = [], errors = [];
let seedReads = 0;
const evidenceUi = { window: {
  async showQuickPick(items) { return items[0]; },
  async showInputBox() { throw new Error('A canonical cursor seed must not require a manually invented generation.'); },
  async showTextDocument() {}, async showErrorMessage(message) { errors.push(message); }
}, workspace: { async openTextDocument(document) { return document; } } };
const workflow = createSemanticEvidenceWorkflow({ vscode: evidenceUi,
  operations: { isCurrent: () => true, run: (_label, callback) => callback() },
  resolveRepo: async () => ({ repoRoot: '/chosen' }), chooseTransport: async () => ({ transport: 'cli' }),
  getCursorSeed: () => { seedReads += 1; return qualifiedBindingSeed(bound); },
  execute: async (operation, request) => {
    dispatched.push({ operation, request });
    return { generation, status: 'partial', records: [], edges: [], frontier: [{ reason: 'analysis_incomplete' }] };
  } });
await workflow();
assert.equal(seedReads, 2, 'cursor identity is rechecked after the native seed choice');
assert.equal(dispatched.length, 1);
assert.equal(dispatched[0].operation, 'find');
assert.deepEqual(dispatched[0].request.generation, generation);
assert.deepEqual(dispatched[0].request.selector, { target: ref });
assert.deepEqual(errors, []);
let resolvedFirstUse = 0, currentSeed = null;
const firstUse = createSemanticEvidenceWorkflow({ vscode: evidenceUi,
  operations: { isCurrent: () => true, run: (_label, callback) => callback() },
  resolveRepo: async () => ({ repoRoot: '/chosen' }), chooseTransport: async () => ({ transport: 'cli' }),
  getCursorSeed: () => currentSeed,
  resolveCursorSeed: async () => { resolvedFirstUse += 1; currentSeed = qualifiedBindingSeed(bound); return currentSeed; },
  execute: async (operation, request) => {
    assert.equal(operation, 'find');
    assert.deepEqual(request.selector, { target: ref });
    return { generation, status: 'partial', records: [], edges: [], frontier: [] };
  } });
await firstUse();
assert.equal(resolvedFirstUse, 1, 'first-use source selection delegates to the injected canonical navigation owner');
let generationDiscovery = 0;
const apiDiscovery = createSemanticEvidenceWorkflow({ vscode: evidenceUi,
  operations: { isCurrent: () => true, run: (_label, callback) => callback() },
  resolveRepo: async () => ({ repoRoot: '/chosen' }),
  chooseTransport: async () => ({ transport: 'api', execution: { capabilities: { 'semantic-find': true } } }),
  discoverGeneration: async () => { generationDiscovery += 1; return { generation,
    source: 'canonical-context-pack-semantic-section' }; },
  execute: async (operation, request) => {
    assert.equal(operation, 'find');
    assert.deepEqual(request.generation, generation);
    assert.deepEqual(request.selector, { field: 'chunkUid', value: 'selected-chunk' });
    return { generation, status: 'partial', records: [], edges: [], frontier: [] };
  } });
await apiDiscovery({ hit: { chunkUid: 'selected-chunk' } });
assert.equal(generationDiscovery, 1, 'API selector path receives the authoritative discovered generation without manual ID fabrication');
console.log('Editor settings snapshots, indexed continuation and bounded semantic request contracts passed');
