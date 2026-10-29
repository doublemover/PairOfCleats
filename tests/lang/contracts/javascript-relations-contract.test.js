#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseJavaScriptAst, getJavaScriptSyntaxIdentity } from '../../../src/lang/javascript/parse.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSemanticCollector } from '../../../src/index/semantic/javascript-collector.js';
import { createSyntaxPartitionId } from '../../../src/index/semantic/identity.js';
import { buildCodeRelations } from '../../../src/lang/javascript.js';
import { admitImportExtraction, canReuseImportExtraction, getImportExtraction } from '../../../src/shared/import-extraction.js';

const source = [
  'import client from "./client.js";',
  'export function run() {',
  '  return client.fetch("/api");',
  '}'
].join('\n');

const rel = buildCodeRelations(source, 'sample.js') || {};
admitImportExtraction(rel.importExtraction, rel.imports, { text: source });
assert.equal(getImportExtraction(rel.imports), rel.importExtraction);
assert.ok(canReuseImportExtraction(rel.importExtraction, rel.imports));
assert.equal(rel.importExtraction.producer.id, 'javascript-literal-imports');
assert.equal(rel.importExtraction.reusePolicy, 'retain-qualified-static-subset');
const staleSource = source.replace('./client.js', './other.js');
const staleRelations = buildCodeRelations(staleSource, 'sample.js', { ast: parseJavaScriptAst(source) });
assert.equal(staleRelations.importExtraction.state, 'unqualified');
assert.equal(canReuseImportExtraction(staleRelations.importExtraction, staleRelations.imports), false,
  'a source-mismatched syntax tree cannot qualify persisted import facts');
const injectedRelations = buildCodeRelations(source, 'sample.js', { ast: JSON.parse(JSON.stringify(parseJavaScriptAst(source))) });
assert.equal(canReuseImportExtraction(injectedRelations.importExtraction, injectedRelations.imports), false,
  'structural lookalikes do not acquire the parser owner identity');
const emptyImports = buildCodeRelations('export function only() { return 1; }', 'empty.js');
assert.deepEqual(emptyImports.imports, []);
assert.equal(emptyImports.importExtraction.recognition, 'empty');
assert.ok(canReuseImportExtraction(emptyImports.importExtraction, emptyImports.imports));
const calls = (Array.isArray(rel.calls) ? rel.calls : []).map(([id, callee]) => [rel.jsDeclarations.records[id].displayName, callee]);
const callDetails = Array.isArray(rel.callDetails) ? rel.callDetails : [];

assert.equal(calls.some(([from, to]) => from === 'run' && to === 'client.fetch'), true);
const detail = callDetails.find((entry) => entry.caller === 'run' && entry.callee === 'client.fetch');
assert.ok(detail, 'call detail should include caller/callee pair');
assert.equal(detail.calleeRaw, 'client.fetch');
assert.equal(detail.calleeNormalized, 'fetch');
assert.equal(detail.receiver, 'client');
assert.equal(Number.isFinite(detail.start), true);
assert.equal(Number.isFinite(detail.end), true);
assert.equal(Number.isFinite(detail.startLine), true);

console.log('javascript relations contract test passed');

const richText = '// 😀\r\nconst {x: renamed = 2, ...rest} = input; const a = [1,,...rest]; target?.method(' + Array.from({length: 300}, (_, i) => i).join(',') + '); new Float32Array(buffer, offset, count);';
const snapshot = createSemanticSourceSnapshot({ bytes: Buffer.from(richText), repositoryNamespace: 'fixture:js', path: 'input.js', language: 'javascript' });
const ast = parseJavaScriptAst(snapshot.text);
const partitionId = createSyntaxPartitionId({ sourceUnitId: snapshot.manifest.sourceUnitId,
  parser: getJavaScriptSyntaxIdentity(ast), extractor: { schemaVersion: 1, version: '1' }, structuralPolicy: {} });
const collect = (batchRows) => {
  const collector = createSemanticCollector({ ast, source: snapshot.manifest, partitionId }, { batchRows });
  const batches = [...collector.batches];
  assert.ok(batches.every(batch => batch.rows.length <= batchRows));
  return batches.flatMap(batch => batch.rows);
};
const fine = collect(7), coarse = collect(4096);
assert.deepEqual(fine, coarse, 'batch layout does not change source record identity or content');
const expressions = fine.filter(entry => entry.family === 'node' && entry.row.kind === 'expression').map(entry => entry.row);
const invocation = expressions.find(row => row.data.syntacticArgumentCount === 300);
assert.ok(invocation);
assert.equal(fine.filter(entry => entry.family === 'operand' && entry.row.parent.localId === invocation.id && entry.row.slot === 'argument').length, 300);
assert.ok(fine.some(entry => entry.family === 'operand' && entry.row.slot === 'receiver'));
assert.ok(fine.some(entry => entry.family === 'operand' && entry.row.flags.includes('hole')));
const name = fine.find(entry => entry.family === 'lookup' && entry.row.value === 'renamed').row.id;
assert.ok(fine.some(entry => entry.family === 'node' && entry.row.kind === 'declaration' && entry.row.data.nameId === name));
const constructor = expressions.find(row => row.data.invocationKind === 'construct');
assert.equal(richText.slice(...constructor.span), 'new Float32Array(buffer, offset, count)');
console.log('resumable JavaScript structural collection and UTF-16 coordinates passed');
