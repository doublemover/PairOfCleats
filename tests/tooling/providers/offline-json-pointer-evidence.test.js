import assert from 'node:assert/strict';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { collectJsonReferenceEvidence } from '../../../src/index/tooling/config-reference-evidence.js';

const item = (path, text) => ({ text, source: createSemanticSourceSnapshot({ bytes: Buffer.from(text), path,
  repositoryNamespace: 'offline-json-fixture', language: 'json' }).manifest });
const documents = new Map([
  ['input.json', item('input.json', '{"value":{"$ref":"schema.json#/$defs/a~1b"},"remote":{"$ref":"https://example.invalid/schema"}}')],
  ['schema.json', item('schema.json', '{"$defs":{"a/b":{"type":"string"}}}')],
  ['cycle.json', item('cycle.json', '{"a":{"$ref":"#/b"},"b":{"$ref":"#/a"}}')],
  ['duplicates.json', item('duplicates.json', '{"x":1,"x":2,"use":{"$ref":"#/x"}}')],
  ['strict.json', item('strict.json', '{/* comment */"x":1,}')],
  ['comments.jsonc', item('comments.jsonc', '{/* comment */"x":"🧭",}')]
]);
const result = collectJsonReferenceEvidence({ documents, maxMs: 1000 });
const source = result.results.find(value => value.path === 'input.json');
assert.equal(source.references[0].status, 'resolved');
assert.equal(source.references[0].target.pointer, '/$defs/a~1b');
assert.equal(source.references[1].reason, 'remote_or_absolute_reference_denied');
assert.equal(result.results.find(value => value.path === 'cycle.json').references[0].reason, 'local_reference_cycle');
const duplicates = result.results.find(value => value.path === 'duplicates.json');
assert.ok(duplicates.diagnostics.some(value => value.code === 'duplicate_document_path'));
assert.equal(duplicates.references[0].reason, 'ambiguous_duplicate_key');
assert.ok(result.results.find(value => value.path === 'strict.json').diagnostics.some(value => value.code === 'syntax_error'));
assert.equal(result.results.find(value => value.path === 'comments.jsonc').diagnostics.length, 0);
assert.equal(source.schemaIdentity, null, 'reference resolution does not pretend schema validation ran');
const escaped = new Map([['input.json', item('input.json', '{"$ref":"../../outside.json"}')]]);
assert.equal(collectJsonReferenceEvidence({ documents: escaped, maxMs: 1000 }).results[0].references[0].reason, 'reference_path_escape');
console.log('offline exact JSON Pointer ranges, strict JSON/JSONC, duplicate ambiguity and cycles');
