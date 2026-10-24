import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { captureSourceLinkedInput } from '../../../src/index/tooling/source-linked-input.js';
import { finalizeSourceLinkedReport } from '../../../src/index/tooling/source-linked-report.js';
import { prepareSemanticdbReferenceEvidence } from '../../../src/index/tooling/semanticdb-reference-evidence.js';
import { prepareProtoDescriptorEvidence } from '../../../src/index/tooling/proto-descriptor-evidence.js';
import { prepareShellcheckReportEvidence } from '../../../src/index/tooling/shellcheck-report-evidence.js';
import { canonicalSemanticJson, semanticHash } from '../../../src/index/semantic/identity.js';

// UNVALIDATED. Producer admission rejects before wire/library execution; a
// synthetic source map proves no independent compiler/runtime qualification.
const fail = message => Object.assign(new Error(message), { code: 'ERR_INPUT_FIXTURE' });
const domain = 'tooling.fixture-producing-receipt.v1';
const input = { value: ['名😀', false], generation: { baseBuildId: 'base', semanticRevision: 1 } };
const encoded = canonicalSemanticJson(input), maxBytes = Buffer.byteLength(encoded);
const capture = (value, bound = maxBytes) => captureSourceLinkedInput(value,
  { maxBytes: bound, fail, message: 'fixture input byte budget', domain });
const owned = capture(input);
assert.deepEqual(owned.value, input); assert.equal(owned.identity, semanticHash(domain, input));
assert.throws(() => capture(input, maxBytes - 1), { code: 'ERR_INPUT_FIXTURE' });
assert.throws(() => capture(input, encoded.length), { code: 'ERR_INPUT_FIXTURE' });
input.generation.semanticRevision = 2;
assert.equal(owned.value.generation.semanticRevision, 1);
let getterCalls = 0;
const active = { get payload() { getterCalls++; return null; } };
assert.throws(() => capture(active, 1024), /getters/); assert.equal(getterCalls, 0);
let enumerations = 0;
const hugeArray = new Proxy(Array(1000000), { ownKeys() { enumerations++; throw new Error('unbounded enumeration'); } });
assert.throws(() => capture(hugeArray, 1024), { code: 'ERR_INPUT_FIXTURE' }); assert.equal(enumerations, 0);
let deep = null;
for (let depth = 0; depth < 20000; depth++) deep = { nested: deep };
const deepEncoded = canonicalSemanticJson(deep, { maxBytes: 1024 * 1024 });
const deepOwned = capture(deep, 1024 * 1024);
assert.equal(deepOwned.identity, createHash('sha256').update(domain + '\0').update(deepEncoded).digest('hex'),
  'receipt hashing does not add an unbounded recursive second traversal');
const finalized = finalizeSourceLinkedReport({ deep }, { maxBytes: 1024 * 1024, fail, message: 'deep report byte budget' });
assert.equal(finalized.identity, createHash('sha256').update('tooling.source-linked-evidence.v1\0')
  .update('{"deep":' + deepEncoded + '}').digest('hex'), 'final report identity uses its already admitted canonical encoding');

for (const [prepare, code] of [[prepareSemanticdbReferenceEvidence, 'ERR_SEMANTICDB_EVIDENCE'],
  [prepareProtoDescriptorEvidence, 'ERR_PROTO_DESCRIPTOR_EVIDENCE'], [prepareShellcheckReportEvidence, 'ERR_SHELLCHECK_REPORT_EVIDENCE']]) {
  const options = { bytes: Buffer.from([0]), producingReceipt: { oversized: '\u0000'.repeat(180000) },
    expectedReceiptHash: 'a'.repeat(64), generation: { baseBuildId: 'base', semanticRevision: 0 },
    documents: new Map([['fixture', {}]]) };
  assert.throws(() => prepare(options), error => error.code === code && /receipt\/context byte budget/.test(error.message),
    'receipt expansion is charged before hashing, native/library decoding or source access');
  assert.throws(() => prepare({ ...options, producingReceipt: { sources: hugeArray } }), { code });
  assert.equal(enumerations, 0);
  assert.throws(() => prepare({ ...options, producingReceipt: active }), /getters/);
  assert.equal(getterCalls, 0);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => prepare({ ...options, producingReceipt: {}, signal: controller.signal }), { name: 'AbortError' });
}
console.log('source-linked receipts bound canonical capture, stable hashes and actual producer admission');
