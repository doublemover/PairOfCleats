import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { prepareProtoDescriptorEvidence, PROTO_DESCRIPTOR_PROVIDER_DECLARATION } from '../../../src/index/tooling/proto-descriptor-evidence.js';
import { writeSourceLinkedEvidence } from '../../../src/index/tooling/source-linked-evidence.js';
import { readSourceLinkedEvidenceDetail } from '../../../src/semantic/source-linked-evidence-detail.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { assertProviderDeclaration } from '../../../src/index/tooling/provider-declaration.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { createSourceLinkedEvidenceFixture } from '../../helpers/source-linked-evidence-fixture.js';

// Authored wire-format fixture and synthetic producing receipt. No native protoc
// or Buf execution/qualification is implied by this source-only regression.
const require = createRequire(import.meta.url), descriptor = require('protobufjs/ext/descriptor');
const protobuf = require('protobufjs/light');
const dependency = '// 🧭 original\nsyntax = "proto3";\npackage demo;\n/*🧭*/ message Shared {\n\tstring value = 1;\n}\n';
const service = 'syntax = "proto3";\npackage demo;\nimport "dep.proto";\nmessage Request {\n\tShared item = 1;\n}\nservice Api {\n\trpc Fetch (Request) returns (Shared);\n}\n';
const location = (path, span) => ({ path, span });
const set = { file: [
  { name: 'dep.proto', package: 'demo', syntax: 'proto3', messageType: [{ name: 'Shared', field: [{ name: 'value', number: 1, label: 1, type: 9 }] }],
    options: { $unknowns: [protobuf.Writer.create().uint32((50000 << 3) | 0).uint32(7).finish()] },
    sourceCodeInfo: { location: [location([4, 0], [3, 9, 5, 1]), location([4, 0, 1], [3, 17, 23]),
      location([4, 0, 2, 0], [4, 8, 25]), location([4, 0, 2, 0, 1], [4, 15, 20])] } },
  { name: 'service.proto', package: 'demo', syntax: 'proto3', dependency: ['dep.proto'],
    messageType: [{ name: 'Request', field: [{ name: 'item', number: 1, label: 1, type: 11, typeName: '.demo.Shared' }] }],
    service: [{ name: 'Api', method: [{ name: 'Fetch', inputType: '.demo.Request', outputType: '.demo.Shared' }] }],
    sourceCodeInfo: { location: [location([3, 0], [2, 7, 18]), location([4, 0], [3, 0, 5, 1]), location([4, 0, 1], [3, 8, 15]),
      location([4, 0, 2, 0], [4, 8, 24]), location([4, 0, 2, 0, 1], [4, 15, 19]), location([4, 0, 2, 0, 6], [4, 8, 14]),
      location([6, 0], [6, 0, 8, 1]), location([6, 0, 1], [6, 8, 11]), location([6, 0, 2, 0], [7, 8, 45]),
      location([6, 0, 2, 0, 1], [7, 12, 17]), location([6, 0, 2, 0, 2], [7, 19, 26]), location([6, 0, 2, 0, 3], [7, 37, 43])] } }
] };
const f = await createSourceLinkedEvidenceFixture([
  { filename: 'dep.proto', language: 'proto', text: dependency }, { filename: 'service.proto', language: 'proto', text: service }
]);
try {
  assertProviderDeclaration(PROTO_DESCRIPTOR_PROVIDER_DECLARATION);
  const prepare = (input = set, changes = {}) => {
    const bytes = descriptor.FileDescriptorSet.encode(input).finish();
    const producingReceipt = { schemaVersion: 1, artifactHash: createHash('sha256').update(bytes).digest('hex'),
      generation: f.generation, profileHash: 'f'.repeat(64), configHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64),
      dependencyLockHash: 'c'.repeat(64), customOptionIdentity: 'd'.repeat(64), columnEncoding: 'protoc-byte-tab8-v1',
      includeRoots: ['fixture-explicit-include-root'], tool: { family: 'protoc', version: 'fixture-not-executed' },
      sources: [...f.sources].map(([filename, item]) => ({ descriptorPath: filename, sourcePath: filename,
        sourceUnitId: item.source.sourceUnitId, byteHash: item.source.byteHash, syntaxPartitionId: item.syntax.partitionId,
        syntaxHash: item.syntax.canonicalHash, mappingIdentity: item.source.mapping?.identity ?? null })) };
    return { bytes, producingReceipt, expectedReceiptHash: semanticHash('tooling.proto-descriptor-producing-receipt.v1', producingReceipt),
      generation: f.generation, documents: f.sources, ...changes };
  };
  const options = prepare(), prepared = prepareProtoDescriptorEvidence(options), report = prepared.report;
  assert.equal(prepared.status, 'partial');
  assert.equal(report.coverage.customOptionsInterpreted, false);
  assert.deepEqual(Buffer.from(report.descriptorArtifact.base64, 'base64'), Buffer.from(options.bytes));
  const dep = report.results.find(value => value.path === 'dep.proto'), query = report.results.find(value => value.path === 'service.proto');
  assert.equal(dependency.slice(...dep.declarations.find(value => value.qualifiedName === '.demo.Shared').target.span), 'Shared',
    'protoc byte columns preserve Unicode preceding a declaration on the same line');
  assert.equal(dep.declarations.find(value => value.family === 'field').number, 1);
  assert.equal(query.declarations.find(value => value.family === 'method').qualifiedName, '.demo.Api.Fetch');
  assert.ok(query.references.some(value => value.family === 'protoFieldType' && value.target?.path === 'dep.proto'));
  assert.ok(query.references.some(value => value.family === 'protoMethodOutput' && value.target?.path === 'dep.proto'));
  const written = await writeSourceLinkedEvidence({ report, sources: f.sources, state: f.state, policy: f.policy,
    semanticSink: createSemanticProviderResultSink({ state: f.state, runtime: f.runtime }) });
  const store = f.store([...f.syntaxPartitions, ...written.output.partitions]);
  const partition = written.output.partitions.find(value => value.sourceUnitId === query.sourceUnitId);
  const detail = await readSourceLinkedEvidenceDetail({ store, ref: { partitionId: partition.partitionId, localId: 0 }, targetStoreForSource: () => store });
  assert.ok(detail.navigationCandidates.some(value => value.family === 'protoMethodOutput' && value.path === 'dep.proto'));
  assert.equal(prepareProtoDescriptorEvidence({ ...options, producingReceipt: null }).report, null);
  assert.throws(() => prepareProtoDescriptorEvidence({ ...options, generation: { baseBuildId: 'wrong', semanticRevision: 0 } }), { code: 'ERR_PROTO_DESCRIPTOR_EVIDENCE' });
  const duplicate = structuredClone(set); duplicate.file[0].messageType.push({ name: 'Shared' });
  assert.throws(() => prepareProtoDescriptorEvidence(prepare(duplicate)), /Duplicate fully qualified/);
  const missing = structuredClone(set); missing.file[1].dependency = ['absent.proto'];
  assert.ok(prepareProtoDescriptorEvidence(prepare(missing)).report.results.find(value => value.path === 'service.proto')
    .diagnostics.some(value => value.code === 'unresolved_import'));
  const cyclic = structuredClone(set); cyclic.file[0].dependency = ['service.proto'];
  assert.ok(prepareProtoDescriptorEvidence(prepare(cyclic)).report.results.some(value => value.diagnostics.some(value => value.code === 'import_cycle')));
  const edition = structuredClone(set); edition.file[0].syntax = 'editions'; edition.file[0].edition = 1000;
  assert.equal(prepareProtoDescriptorEvidence(prepare(edition)).report.results.find(value => value.path === 'dep.proto').reason, 'unsupported_edition');
  assert.throws(() => prepareProtoDescriptorEvidence({ ...options, maxSymbols: 1 }), { code: 'ERR_PROTO_DESCRIPTOR_EVIDENCE' });
  const mutable = prepare(); mutable.generation = { ...f.generation };
  mutable.producingReceipt = JSON.parse(JSON.stringify(mutable.producingReceipt));
  const originalGeneration = { ...mutable.generation }, originalBytes = Buffer.from(mutable.bytes);
  let inspected = false;
  const pinned = prepareProtoDescriptorEvidence({ ...mutable, signal: { get aborted() {
    if (!inspected) {
      inspected = true; mutable.generation.semanticRevision++; mutable.producingReceipt.tool.version = 'caller-replaced'; mutable.bytes.fill(0);
    }
    return false;
  } } }).report;
  assert.ok(inspected); assert.deepEqual(pinned.generation, originalGeneration);
  assert.equal(pinned.producingTool.version, 'fixture-not-executed');
  assert.deepEqual(Buffer.from(pinned.descriptorArtifact.base64, 'base64'), originalBytes);
  console.log('binary linked Proto descriptor source/receipt identity, tab/Unicode mapping and canonical source detail');
} finally { await f.cleanup(); }
