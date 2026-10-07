import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createProtoStructureParser, parseProtoStructure } from '../../../src/shared/proto-structure.js';
import { chunkProto, createProtoChunker } from '../../../src/index/chunking/dispatch/schema-chunkers.js';
import { collectProtoImports, createProtoImportCollector } from '../../../src/index/language-registry/import-collectors/proto.js';
import { createProtoManagedAdapter } from '../../../src/index/language-registry/adapters/heuristic.js';

const protobuf = createRequire(import.meta.url)('protobufjs');
const forbidden = () => { throw new Error('Excluded loading/resolution/codegen/RPC path'); };
protobuf.Root.prototype.load = forbidden;
protobuf.Root.prototype.loadSync = forbidden;
protobuf.Root.prototype.resolveAll = forbidden;
protobuf.Type.prototype.setup = forbidden;
protobuf.util.codegen = forbidden;
const text = [
  'syntax = "proto3";',
  'package fixture;',
  'import "real.proto"; import weak "weak.proto";',
  '/* 🚀 message Phantom { string fake = 1; }',
  'rpc Ghost (FakeRequest) returns (FakeReply); */',
  'option java_package = "message StringGhost {} rpc StringRpc (Fake) returns (Fake);";',
  'message Real {',
  '  string original_name = 1;',
  '  Child child = 2;',
  '  message Nested { string value = 1; }',
  '  oneof choice { string first = 3; Child second = 4; }',
  '}',
  'message Child { string id = 1; }',
  'service Actual { rpc Fetch (stream Real) returns (Child); }',
  ''
].join('\r\n');
const structure = parseProtoStructure(text);
assert.equal(structure.parser, 'protobufjs-reflection');
assert.equal(structure.coverage, 'partial');
assert.equal(structure.rangeSource, 'application-lexer');
assert.equal(parseProtoStructure(text), structure);
assert.ok(Object.isFrozen(structure.headings) && Object.isFrozen(structure.headings[0]));
const chunks = chunkProto(text);
assert.deepEqual(chunks.map((chunk) => chunk.name), ['syntax', 'package fixture', 'message Real',
  'message Nested', 'oneof choice', 'message Child', 'service Actual', 'rpc Fetch']);
assert.ok(chunks.every((chunk) => chunk.meta.astRange === undefined && chunk.meta.rangeSource === 'application-lexer'
  && chunk.start <= chunk.meta.lexicalRange.start && chunk.end >= chunk.meta.lexicalRange.end));
assert.equal(text.slice(chunks[2].meta.lexicalRange.start, chunks[2].meta.lexicalRange.end), 'message Real {');
assert.equal(chunks[3].meta.reflectionName, '.fixture.Real.Nested');
assert.ok(chunks.every((chunk, index) => index === 0 || chunk.start === chunks[index - 1].end));
assert.deepEqual(collectProtoImports(text), ['real.proto', 'weak.proto']);
const adapter = createProtoManagedAdapter();
const relations = adapter.buildRelations({ text, options: {} });
assert.deepEqual(relations.exports, ['Actual', 'Child', 'Fetch', 'Nested', 'Real']);
assert.deepEqual(relations.usages, ['Child', 'Real']);
assert.ok(relations.calls.every((edge) => !edge.includes('Ghost') && !edge.includes('FakeReply')));
assert.equal(adapter.capabilityProfile.state, 'partial');
assert.equal(adapter.extractDocMeta({ chunk: chunks[2] }).source, 'managed-proto-reflection+lexical');
const sameLine = 'syntax="proto3";/* 🚀 */message A {} message B {}';
assert.deepEqual(chunkProto(sameLine).map((chunk) => chunk.name), ['syntax', 'message A', 'message B']);
assert.equal(chunkProto(sameLine)[1].start, sameLine.indexOf('message A'));
const escaped = String.raw`syntax="proto3";option java_package="escaped \" message Phantom{}";message Real{}`;
assert.deepEqual(chunkProto(escaped).map((chunk) => chunk.name), ['syntax', 'message Real']);
assert.deepEqual(chunkProto('syntax="proto3";option java_package="message Real{}";message Real{}')
  .map((chunk) => chunk.name), ['syntax', 'message Real'], 'same-name string text is not a second real declaration');
assert.equal(parseProtoStructure('').parser, 'protobufjs-reflection');
for (const declaration of ['syntax="proto2";', 'syntax="proto3";', 'edition="2023";', 'edition="2024";', 'edition="2026";']) {
  assert.equal(parseProtoStructure(`${declaration}message Tiny {}`).reason, null);
}
const extension = 'syntax="proto2";import "descriptor.proto";extend .google.protobuf.MessageOptions{optional string text=50001;}';
assert.ok(chunkProto(extension).some((chunk) => chunk.name === 'extend .google.protobuf.MessageOptions'));
assert.ok(adapter.buildRelations({ text: extension, options: {} }).usages.includes('.google.protobuf.MessageOptions'));
assert.deepEqual(collectProtoImports('/* ignored */ import public "one" "two.proto";'), ['onetwo.proto']);

for (const source of ['syntax="proto3"; message Broken {', '/* message Phantom {}',
  'option java_package="message Phantom {}', 'edition="2025";message Phantom{}',
  'syntax="proto3";message Phantom{ string field=; }']) {
  assert.equal(chunkProto(source)[0].name, 'proto', 'failure never revives a regex declaration');
  assert.ok(chunkProto(source)[0].meta.parserFallbackReason);
  assert.deepEqual(collectProtoImports(source), []);
  assert.deepEqual(adapter.buildRelations({ text: source, options: {} }).exports, []);
}
assert.equal(parseProtoStructure('edition="2024";import option "options.proto";').reason, 'unsupported-option-import');
let loads = 0;
const missing = createProtoStructureParser({ loadParser: () => { loads += 1; throw new Error('Controlled missing parser'); } });
assert.equal(createProtoChunker({ parseStructure: missing })('message Phantom{}')[0].name, 'proto');
assert.deepEqual(createProtoImportCollector({ parseStructure: missing })('import "file.proto";'), []);
assert.deepEqual(createProtoManagedAdapter({ parseStructure: missing }).buildRelations({ text: 'message Phantom{}', options: {} }).exports, []);
assert.equal(loads, 1);
assert.equal(parseProtoStructure('x'.repeat(786433)).reason, 'source-limit');
assert.equal(parseProtoStructure('\n'.repeat(5001)).reason, 'line-limit');
assert.equal(parseProtoStructure('x'.repeat(8193)).reason, 'token-length-limit');
assert.equal(parseProtoStructure(';'.repeat(32769)).reason, 'token-limit');
assert.equal(parseProtoStructure('{'.repeat(65) + '}'.repeat(65)).reason, 'depth-limit');
const crowdedRoot = new protobuf.Root();
for (let index = 0; index < 4097; index += 1) crowdedRoot.add(new protobuf.Type(`T${index}`));
assert.equal(createProtoStructureParser({ now: () => 0, loadParser: () => ({ ...protobuf,
  parse: () => ({ root: crowdedRoot }) }) })('message A{}').reason, 'node-limit');
const lineLimited = { collectorScanBudget: { maxLines: 3, maxMs: 0 } };
assert.deepEqual(collectProtoImports(text, lineLimited), ['real.proto', 'weak.proto']);
assert.deepEqual(adapter.buildRelations({ text, options: lineLimited }).exports, []);
assert.deepEqual(adapter.buildRelations({ text, options: lineLimited }).usages, []);
assert.deepEqual(collectProtoImports(text, { collectorScanBudget: { maxMatches: 1, maxMs: 0 } }), ['real.proto']);
assert.deepEqual(collectProtoImports(text, { collectorScanBudget: { maxChars: 100, maxMs: 0 } }), []);
let clock = 0;
const timed = createProtoStructureParser({ now: () => clock, loadParser: () => ({ ...protobuf, parse: (...args) => {
  clock += 101;
  return protobuf.parse(...args);
} }) });
assert.equal(timed('syntax="proto3";message A{}').reason, 'time-limit');
assert.ok(timed('syntax="proto3";message A{}').metrics.elapsedMs >= 100);
let lexicalClock = 0;
let enteredVendor = 0;
const lexicalExpired = createProtoStructureParser({ now: () => (lexicalClock += 101), loadParser: () => ({ ...protobuf,
  parse: (...args) => { enteredVendor += 1; return protobuf.parse(...args); } }) });
assert.equal(lexicalExpired('message A{}').reason, 'time-limit');
assert.equal(enteredVendor, 0, 'expired lexical admission does not enter the vendor parser');
clock = 0;
const scanTimed = createProtoStructureParser({ loadParser: () => ({ ...protobuf, parse: (...args) => {
  clock += 31;
  return protobuf.parse(...args);
} }) });
const diagnostics = [];
assert.deepEqual(createProtoImportCollector({ parseStructure: scanTimed })('import "file.proto";', {
  collectorNow: () => clock, collectorScanBudget: { maxMs: 30 }, collectorDiagnostics: diagnostics
}), []);
assert.ok(diagnostics.some((row) => row.reasons.includes('scan_time')));
for (const mode of ['chunk', 'import', 'relation']) {
  let callerClock = 0;
  let vendorCalls = 0;
  const parseStructure = createProtoStructureParser({ now: () => callerClock, loadParser: () => ({ ...protobuf,
    parse: (...args) => { vendorCalls += 1; callerClock += 11; return protobuf.parse(...args); } }) });
  const source = 'syntax="proto3";import "owned.proto";message Real{}';
  const options = { collectorNow: () => callerClock, collectorScanBudget: { maxMs: 10 } };
  if (mode === 'chunk') assert.equal(createProtoChunker({ parseStructure })(source,
    { treeSitter: { byLanguage: { proto: { maxParseMs: 10 } } } })[0].name, 'proto');
  if (mode === 'import') assert.deepEqual(createProtoImportCollector({ parseStructure })(source, options), []);
  if (mode === 'relation') assert.deepEqual(createProtoManagedAdapter({ parseStructure }).buildRelations({ text: source, options }).exports, []);
  assert.equal(vendorCalls, 1, 'only one bounded synchronous vendor attempt');
  callerClock = 0;
  const result = parseStructure(source, { maxMs: 10 });
  assert.equal(result.reason, 'time-limit');
  assert.equal(result.metrics.effectiveLimitMsAtEntry, 10);
  assert.equal(result.metrics.measuredOverrunMs, 1, 'synchronous overrun is recorded, not erased');
}
let deniedVendorCalls = 0;
const expiredCaller = createProtoStructureParser({ loadParser: () => ({ ...protobuf, parse: (...args) => {
  deniedVendorCalls += 1; return protobuf.parse(...args);
} }) });
assert.equal(expiredCaller('message A{}', { remainingMs: () => 0 }).reason, 'time-limit');
assert.equal(deniedVendorCalls, 0);
console.log('Protobuf reflection and explicit lexical ranges exclude comment/string phantoms with bounded fail-safe degradation');
