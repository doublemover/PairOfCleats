import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { finalizeSourceLinkedReport } from '../../../src/index/tooling/source-linked-report.js';
import { prepareProtoDescriptorEvidence, PROTO_DESCRIPTOR_PROVIDER_DECLARATION } from '../../../src/index/tooling/proto-descriptor-evidence.js';
import { collectGraphqlLinkedEvidence, GRAPHQL_LINKED_PROVIDER_DECLARATION } from '../../../src/index/tooling/graphql-linked-evidence.js';
import { canonicalSemanticJson, semanticHash } from '../../../src/index/semantic/identity.js';
import { createSourceLinkedEvidenceFixture } from '../../helpers/source-linked-evidence-fixture.js';

// Authored only. Application wire/schema APIs and actual producer admission,
// synthetic parser receipts; no protoc, GHC, language server or source executes.
const fail = message => Object.assign(new Error(message), { code: 'ERR_FIXTURE_REPORT_BOUND' });
const finalize = (report, maxBytes) => finalizeSourceLinkedReport(report, { maxBytes, fail, message: 'fixture report byte budget' });
const input = { schemaVersion: 1, kind: 'source-linked-evidence', payload: [{ name: '🧭名', text: 'a  b' }] };
const expected = { ...input, identity: semanticHash('tooling.source-linked-evidence.v1', input) };
const exactBytes = Buffer.byteLength(canonicalSemanticJson(expected));
const result = finalize(input, exactBytes);
assert.deepEqual(result, expected);
assert.throws(() => finalize(input, exactBytes - 1), { code: 'ERR_FIXTURE_REPORT_BOUND' }, 'the final identity field consumes bytes too');
assert.throws(() => finalize(input, canonicalSemanticJson(expected).length), { code: 'ERR_FIXTURE_REPORT_BOUND' },
  'UTF-8 bytes cannot be replaced by UTF-16 character counts');
input.payload[0].text = 'changed';
assert.equal(result.payload[0].text, 'a  b', 'retained metadata is pinned independently of caller-owned nested objects');
let getterCalls = 0;
const getter = { schemaVersion: 1 };
Object.defineProperty(getter, 'payload', { enumerable: true, get() { getterCalls++; return 'unexpected'; } });
assert.throws(() => finalize(getter, 1024), /getters/);
assert.equal(getterCalls, 0, 'canonical admission must reject a getter before any spread can invoke it');
assert.throws(() => finalize({ schemaVersion: 1, identity: 'a'.repeat(64) }, 1024), /unsigned report/);
const interrupted = new Error('finalization interrupted');
assert.throws(() => finalizeSourceLinkedReport({ payload: [] }, { maxBytes: 1024, fail, message: 'budget', check() { throw interrupted; } }),
  error => error === interrupted);

const require = createRequire(import.meta.url), descriptor = require('protobufjs/ext/descriptor');
let message = { name: 'Leaf_' + 'L'.repeat(115), field: Array.from({ length: 180 }, (_, index) =>
  ({ name: 'field_' + index + '_' + 'f'.repeat(110), number: index + 1, label: 1, type: 5 })) };
for (let depth = 0; depth < 50; depth++) message = { name: `Level_${depth}_` + 'N'.repeat(110), nestedType: [message] };
const lines = ['syntax = "proto3";'];
let current = message, levels = 0;
while (current) {
  lines.push(`message ${current.name} {`); levels++;
  if (current.nestedType) current = current.nestedType[0];
  else { for (const field of current.field) lines.push(`int32 ${field.name} = ${field.number};`); current = null; }
}
lines.push(...Array(levels).fill('}'));
const proto = await createSourceLinkedEvidenceFixture([{ filename: 'bounds.proto', language: 'proto', text: lines.join('\n') }]);
try {
  const bytes = descriptor.FileDescriptorSet.encode({ file: [{ name: 'bounds.proto', syntax: 'proto3', messageType: [message] }] }).finish();
  assert.ok(bytes.length < 256 * 1024, 'the small complete wire input fits its existing input allowance');
  const producingReceipt = { schemaVersion: 1, artifactHash: createHash('sha256').update(bytes).digest('hex'),
    generation: proto.generation, profileHash: 'f'.repeat(64), configHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64),
    dependencyLockHash: 'c'.repeat(64), customOptionIdentity: 'd'.repeat(64), columnEncoding: 'protoc-byte-tab8-v1',
    includeRoots: ['fixture-explicit-root'], tool: { family: 'protoc', version: 'fixture-not-executed' },
    sources: [...proto.sources].map(([filename, item]) => ({ descriptorPath: filename, sourcePath: filename,
      sourceUnitId: item.source.sourceUnitId, byteHash: item.source.byteHash, syntaxPartitionId: item.syntax.partitionId,
      syntaxHash: item.syntax.canonicalHash, mappingIdentity: item.source.mapping?.identity ?? null })) };
  assert.equal(PROTO_DESCRIPTOR_PROVIDER_DECLARATION.adapterVersion, '2');
  assert.throws(() => prepareProtoDescriptorEvidence({ bytes, producingReceipt,
    expectedReceiptHash: semanticHash('tooling.proto-descriptor-producing-receipt.v1', producingReceipt),
    generation: proto.generation, documents: proto.sources }), /Proto descriptor output byte budget/,
  'expanded fully qualified declaration metadata must fit the declared report allowance');
} finally { await proto.cleanup(); }

const schema = 'type Query { value: Int }', query = '{ ' + Array.from({ length: 2500 }, (_, index) => `v${index}: value`).join(' ') + ' }';
const graphql = await createSourceLinkedEvidenceFixture([
  { filename: 'schema.graphql', language: 'graphql', text: schema }, { filename: 'query.graphql', language: 'graphql', text: query }
]);
try {
  assert.equal(GRAPHQL_LINKED_PROVIDER_DECLARATION.adapterVersion, '2');
  assert.ok(Buffer.byteLength(schema + query) < 500 * 1024);
  assert.throws(() => collectGraphqlLinkedEvidence({ documents: graphql.sources, schemaPaths: ['schema.graphql'],
    documentPaths: ['query.graphql'], generation: graphql.generation, configHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64) }),
  /GraphQL report output byte budget/, 'repeated source targets must fit the complete declared output bound');
} finally { await graphql.cleanup(); }
console.log('source-linked producers bound complete identity-bearing reports before returning them');
