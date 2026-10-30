import assert from 'node:assert/strict';
import { createProviderJsonlDecoder, importProviderJsonlReport, runJsonlProvider } from '../../../src/index/tooling/provider-jsonl.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';

const request = { schemaVersion: 1, requestId: 'fixture-🧭', profileHash: 'a'.repeat(64), sourceSnapshotHash: 'b'.repeat(64),
  generation: { baseBuildId: 'fixture-build', semanticRevision: 0 } };
const output = { schemaVersion: 1, contexts: [], partitions: [], coverageRef: null, diagnosticsRef: null };
const hello = { type: 'hello', protocolVersion: 1, requestId: request.requestId, requestHash: semanticHash('tooling.jsonl-request.v1', request) };
const batch = { type: 'batch', requestId: request.requestId, sequence: 0, semanticFacts: output };
const final = { type: 'final', requestId: request.requestId, complete: true, batchCount: 1, partitionCount: 0,
  outputHash: semanticHash('tooling.jsonl-output.v1', output) };
const encode = values => Buffer.from(values.map(value => JSON.stringify(value)).join('\n') + '\n');
const bytes = encode([hello, batch, final]);
const decoder = createProviderJsonlDecoder({ request });
for (let offset = 0; offset < bytes.length; offset++) decoder.push(bytes.subarray(offset, offset + 1));
assert.equal(decoder.finish().batchCount, 1, 'split UTF-8 code points preserve request identity');
for (const messages of [[batch], [hello, batch], [hello, { ...batch, sequence: 1 }], [hello, batch, batch],
  [hello, batch, { ...final, complete: false }], [hello, batch, final, batch], [{ ...hello, protocolVersion: 2 }]]) {
  const value = createProviderJsonlDecoder({ request });
  assert.throws(() => { value.push(encode(messages)); value.finish(); }, { code: 'ERR_TOOLING_PROVIDER_PROTOCOL' });
}
const oversized = createProviderJsonlDecoder({ request, maxLineBytes: 16 });
assert.throws(() => oversized.push(encode([hello])), { code: 'ERR_TOOLING_PROVIDER_PROTOCOL' });
const invalid = createProviderJsonlDecoder({ request });
assert.throws(() => invalid.push(new Uint8Array([0xff])));
let admitted = 0;
const imported = await importProviderJsonlReport({ request, chunks: [bytes], semanticSink: async value => {
  admitted += 1; assert.deepEqual(value, output); return { accepted: 0, persisted: 0 };
} });
assert.equal(imported.admission.persisted, 0);
await assert.rejects(importProviderJsonlReport({ request, chunks: [encode([hello, batch])], semanticSink: async () => { admitted += 1; } }));
assert.equal(admitted, 1, 'no final receipt means no sink admission');
await assert.rejects(runJsonlProvider({ command: ['not-authorized'], profile: {}, request, repoRoot: process.cwd() }), { code: 'ERR_TOOLING_PROVIDER_DENIED' });
console.log('provider JSONL identity negotiation, bounded UTF-8 framing and complete final admission');
