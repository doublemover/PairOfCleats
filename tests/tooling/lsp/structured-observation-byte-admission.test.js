import assert from 'node:assert/strict';
import { createLspObservationCollector } from '../../../src/integrations/tooling/providers/lsp/structured-observations.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';

// Authored only. Existing collector budgets, canonical snapshots and projector.
const text = 'value', uri = 'file:///fixture/input.lua';
const source = createSemanticSourceSnapshot({ bytes: Buffer.from(text), repositoryNamespace: 'bounded-observation', path: 'input.lua', language: 'lua' }).manifest;
const identity = { sessionId: 'session', profileId: 'profile', sourceHash: source.byteHash, sourceUnitId: source.sourceUnitId,
  contextHash: 'a'.repeat(64), generation: { baseBuildId: 'fixture', semanticRevision: 0 }, uri };
const options = { identity, consumers: ['navigation'], sourceForUri: target => target === uri ? { source, text } : null, projectReady: 'ready' };
const params = { textDocument: { uri }, position: { line: 0, character: 0 } };
const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } };
const request = { requestClass: 'definition', params, response: { attempted: true, payload: [{ uri, range }] } };
const reference = createLspObservationCollector(options).record(request);
const exactBytes = Buffer.byteLength(canonicalSemanticJson(reference));
const exact = createLspObservationCollector({ ...options, maxBytes: exactBytes });
assert.deepEqual(exact.record(request), reference);
assert.equal(exact.metrics().bytes, exactBytes);
assert.equal(exact.record(request), exact.record(request), 'cache reuse remains available when the retained allowance is full');
assert.equal(exact.metrics().bytes, exactBytes, 'a cached observation is charged once');
const next = exact.record({ ...request, params: { ...params, position: { line: 0, character: 1 } } });
assert.equal(next.reason, 'output_budget');
assert.equal(exact.observations().length, 1);
const short = createLspObservationCollector({ ...options, maxBytes: exactBytes - 1 });
assert.equal(short.record(request).reason, 'output_budget', 'the whole projected envelope consumes the allowance');
assert.deepEqual(short.metrics(), { requests: 0, facts: 0, bytes: 0, retainedItems: 0 });

let requests = 0, reservations = 0, projections = 0;
const limited = createLspObservationCollector({ ...options, maxBytes: 4096,
  sourceForUri: () => { projections++; return { source, text }; },
  capabilities: { definition: true }, requestBudgets: { definition: { tryReserve() { reservations++; return true; } } },
  request: async () => { requests++; return [{ uri, range }]; } });
const huge = 'x'.repeat(100000);
assert.equal(limited.record({ ...request, response: { attempted: true, payload: huge } }).reason, 'output_budget');
assert.equal(projections, 0, 'oversized raw data cannot enter projection');
assert.equal(limited.record({ ...request, params: { ...params, opaque: huge } }).reason, 'output_budget');
const refused = await limited.acquire({ requestClass: 'definition', params: { ...params, opaque: huge } });
assert.equal(refused.reason, 'output_budget');
assert.equal(requests, 0);
assert.equal(reservations, 0, 'oversized external options fail before request reservation');
assert.equal(limited.observations().length, 0);
assert.equal(limited.metrics().bytes, 0);
const accepted = await limited.acquire({ requestClass: 'definition', params });
assert.equal(accepted.facts[0].target.state, 'exact');
assert.equal(requests, 1);
assert.equal(reservations, 1);
assert.ok(limited.metrics().bytes <= 4096);
console.log('structured observations admit input and complete output under existing byte limits');
