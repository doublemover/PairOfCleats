import assert from 'node:assert/strict';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createLspObservationCollector } from '../../../src/integrations/tooling/providers/lsp/structured-observations.js';

const text = 'value();', uri = 'file:///request-admission/input.js';
const source = createSemanticSourceSnapshot({ bytes: Buffer.from(text), repositoryNamespace: 'request-admission',
  path: 'input.js', language: 'javascript' }).manifest;
const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } };
const identity = { sourceHash: source.byteHash, sourceUnitId: source.sourceUnitId,
  sessionId: 'session', profileId: 'profile', contextHash: 'a'.repeat(64), uri,
  generation: { baseBuildId: 'fixture', semanticRevision: 0 } };
const options = { identity, consumers: ['navigation', 'symbolDetail', 'hierarchyDetail'], projectReady: 'ready',
  sourceForUri: value => value === uri ? { source, text } : null };
const classes = ['definition', 'prepareCallHierarchy', 'prepareTypeHierarchy', 'incomingCalls', 'outgoingCalls', 'supertypes', 'subtypes'];
const requestBudgets = Object.fromEntries(classes.map(name => [name, { tryReserve: () => true }]));
const capabilities = Object.fromEntries(classes.map(name => [name, true]));

let release, requests = 0;
const params = { textDocument: { uri }, position: { line: 0, character: 0 } };
const collector = createLspObservationCollector({ ...options, capabilities, requestBudgets,
  request: (_method, requestParams) => {
    requests += 1;
    assert.ok(Object.isFrozen(requestParams));
    assert.ok(Object.isFrozen(requestParams.textDocument));
    assert.deepEqual(requestParams, { textDocument: { uri }, position: { line: 0, character: 0 } });
    return new Promise(resolve => { release = resolve; });
  } });
const pending = collector.acquire({ requestClass: 'definition', params });
params.textDocument.uri = 'file:///changed.js'; params.position.character = 7;
const duplicate = collector.acquire({ requestClass: 'definition',
  params: { textDocument: { uri }, position: { line: 0, character: 0 } }, unusedDisplayField: 'does-not-split-request' });
assert.equal(pending, duplicate, 'request identity uses the pinned admitted protocol inputs');
release([{ uri, range }]);
const observation = await pending;
assert.equal(requests, 1);
assert.equal(observation.params.textDocument.uri, uri);
assert.equal(observation.params.position.character, 0);
assert.deepEqual(observation.facts[0].target.span, [0, 5]);
await collector.acquire({ requestClass: 'definition', params: { textDocument: { uri }, position: { line: 0, character: 0 } } });
assert.equal(requests, 1, 'the response caches under the same request that was sent');
let getters = 0;
const unsafe = { textDocument: { uri }, position: {} };
Object.defineProperty(unsafe.position, 'line', { enumerable: true, get() { getters += 1; return 0; } });
assert.throws(() => collector.acquire({ requestClass: 'definition', params: unsafe }), /getters/u);
assert.equal(getters, 0);
assert.equal(requests, 1);

const item = { uri, name: 'value', kind: 12, range, selectionRange: range, data: { opaque: 'x'.repeat(2048) } };
const record = (owner, requestClass, payload, query = 0) => owner.record({ requestClass,
  params: { textDocument: { uri }, query }, response: { attempted: true, payload } });
const baseline = createLspObservationCollector(options);
const large = record(baseline, 'prepareCallHierarchy', [item]);
const projectedBytes = Buffer.byteLength(canonicalSemanticJson(large));
assert.ok(Buffer.byteLength(canonicalSemanticJson([item])) < projectedBytes - 1);
const bounded = createLspObservationCollector({ ...options, maxBytes: projectedBytes - 1 });
const discarded = record(bounded, 'prepareCallHierarchy', [item]);
assert.equal(discarded.reason, 'output_budget');
assert.deepEqual(bounded.metrics(), { requests: 0, facts: 0, bytes: 0, retainedItems: 0 },
  'rejected projection cannot retain uncharged raw hierarchy data or tokens');
assert.deepEqual(bounded.observations(), []);

let hierarchyRequests = 0;
const hierarchy = createLspObservationCollector({ ...options, capabilities, requestBudgets,
  request: async (method, requestParams) => {
    hierarchyRequests += 1;
    assert.equal(requestParams.item.data.opaque, item.data.opaque);
    assert.ok(Object.isFrozen(requestParams.item.data));
    if (method === 'callHierarchy/outgoingCalls') return [{ to: item, fromRanges: [range] }];
    if (method === 'typeHierarchy/supertypes') return [item];
    assert.fail(`unexpected hierarchy request ${method}`);
  } });
const call = record(hierarchy, 'prepareCallHierarchy', [item]);
const type = record(hierarchy, 'prepareTypeHierarchy', [item]);
const callToken = call.facts[0].itemToken, typeToken = type.facts[0].itemToken;
assert.notEqual(callToken, typeToken, 'identical opaque data does not collapse call/type protocol ownership');
await assert.rejects(hierarchy.hierarchy({ itemToken: callToken, requestClass: 'supertypes' }), { code: 'ERR_LSP_OBSERVATION_IDENTITY' });
await assert.rejects(hierarchy.hierarchy({ itemToken: typeToken, requestClass: 'outgoingCalls' }), { code: 'ERR_LSP_OBSERVATION_IDENTITY' });
assert.equal(hierarchyRequests, 0, 'cross-family opaque state is rejected before transport admission');
await hierarchy.hierarchy({ itemToken: callToken, requestClass: 'outgoingCalls' });
await hierarchy.hierarchy({ itemToken: typeToken, requestClass: 'supertypes' });
assert.equal(hierarchyRequests, 2);

const mutableIdentity = structuredClone(identity);
const pinnedIdentity = createLspObservationCollector({ ...options, identity: mutableIdentity });
mutableIdentity.uri = 'file:///wrong-origin.js';
const implicitOrigin = pinnedIdentity.record({ requestClass: 'definition', params: {}, response: { attempted: true,
  payload: [{ targetUri: uri, targetRange: range, targetSelectionRange: range, originSelectionRange: range }] } });
assert.deepEqual(implicitOrigin.facts[0].origin.span, [0, 5], 'origin fallback uses the captured session identity');

let current = true;
const stale = createLspObservationCollector({ ...options, isCurrent: () => current,
  sourceForUri: value => { current = false; return value === uri ? { source, text } : null; } });
assert.throws(() => record(stale, 'prepareCallHierarchy', [item]), { code: 'ERR_LSP_OBSERVATION_IDENTITY' });
assert.deepEqual(stale.metrics(), { requests: 0, facts: 0, bytes: 0, retainedItems: 0 });
assert.deepEqual(stale.observations(), [], 'a source-context change during projection cannot commit staged evidence');
console.log('structured LSP request, hierarchy family and retained admission lifetime test passed');
