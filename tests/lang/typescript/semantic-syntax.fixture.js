import assert from 'node:assert/strict';
import { createTypeScriptSyntaxContext, prepareTypeScriptSyntax,
  getTypeScriptSyntaxIdentity } from '../../../src/lang/typescript/syntax-context.js';
import { createTypeScriptSemanticCollector, TYPESCRIPT_ADAPTER_VERSION } from '../../../src/index/semantic/typescript-collector.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSyntaxPartitionId, canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { validateSemanticRecord } from '../../../src/contracts/validators/semantic.js';
import { buildTypeScriptChunks } from '../../../src/lang/typescript/chunks.js';
import { buildTypeScriptRelations } from '../../../src/lang/typescript/relations.js';

const text = [
  'import { original as alias } from "dep";',
  'export { alias as renamed }; export * from "other";',
  'const unicode = "😀é";',
  'const {a: {b = fallback()}, ...rest} = input;',
  'const [first, , ...tail] = values;',
  'const array = [1, , ...values];',
  'const object = { key: unicode, [first]: tail, ...rest, alias };',
  'class Box { constructor(public value: number) {} method(x: number) { return x; } }',
  'new Box(1); service?.method?.(1,2,3,4,5,unicode);',
  'tag`hello ${unicode}`; import("dynamic"); service?.method(unicode);',
  'const siblings = [() => alias, () => alias];',
  'function large() { return call(' + Array.from({ length: 300 }, (_, i) => i).join(',') + '); }'
].join('\r\n');
const snapshot = createSemanticSourceSnapshot({ bytes: Buffer.from(text), repositoryNamespace: 'ts-fixture', path: 'syntax.ts', language: 'typescript' });
const context = createTypeScriptSyntaxContext();
const options = { ext: '.ts', typeScriptSyntaxContext: context };
const syntax = prepareTypeScriptSyntax(text, options);
const chunks = buildTypeScriptChunks(text, { ...options, parser: 'typescript' });
assert.ok(chunks.length);
assert.equal(prepareTypeScriptSyntax(text, options).sourceFile, syntax.sourceFile);
assert.equal(context.parses, 1);
assert.equal(context.reuses, 2);
const before = canonicalSemanticJson(buildTypeScriptRelations(text, chunks, { ext: '.ts' }));
const after = canonicalSemanticJson(buildTypeScriptRelations(text, chunks, options));
assert.equal(after, before, 'relations remain equivalent under cache reuse');
assert.equal(context.babelParses, 1);
assert.equal(context.babelReuses, 1, 'imports and relation summary share Babel syntax');
const suppliedContext = createTypeScriptSyntaxContext();
assert.equal(prepareTypeScriptSyntax(text, { ...options, typeScriptSyntaxContext: suppliedContext, sourceFile: syntax.sourceFile }).sourceFile, syntax.sourceFile);
assert.equal(suppliedContext.parses, 0);
assert.equal(suppliedContext.reuses, 1);
const parser = getTypeScriptSyntaxIdentity(syntax.sourceFile);
assert.equal(parser.version, syntax.ts.version);
const partitionId = createSyntaxPartitionId({ sourceUnitId: snapshot.manifest.sourceUnitId, parser,
  extractor: { schemaVersion: 1, version: TYPESCRIPT_ADAPTER_VERSION }, structuralPolicy: { structure: 'complete', adapterVersion: 1 } });
const args = { ast: syntax.sourceFile, ts: syntax.ts, source: snapshot.manifest, partitionId };
const collect = (policy) => {
  const collector = createTypeScriptSemanticCollector(args, policy);
  const rows = [];
  let expectedSequence = 0;
  for (const batch of collector.batches) {
    assert.equal(batch.sequence, expectedSequence++);
    assert.ok(batch.rows.length <= policy.batchRows && batch.byteCount <= policy.batchBytes);
    for (const entry of batch.rows) {
      const result = validateSemanticRecord(entry.family, entry.row, { sourceLength: text.length, structuralSlots: collector.structuralSlots });
      assert.equal(result.ok, true, JSON.stringify(result.errors) + canonicalSemanticJson(entry));
      rows.push(entry);
    }
  }
  assert.equal(collector.summary.state, 'complete');
  return rows;
};
const rows = collect({ batchRows: 7, batchBytes: 4096 });
assert.equal(canonicalSemanticJson(rows), canonicalSemanticJson(collect({ batchRows: 97, batchBytes: 32768 })));
const nodes = rows.filter((entry) => entry.family === 'node').map((entry) => entry.row);
const operands = rows.filter((entry) => entry.family === 'operand').map((entry) => entry.row);
assert.deepEqual(nodes.map((node) => node.id), Array.from({ length: nodes.length }, (_, i) => i));
const findKind = (kind) => nodes.filter((node) => node.kind === 'expression' && node.data.astKind === kind);
const large = findKind('CallExpression').find((node) => node.data.syntacticArgumentCount === 300);
assert.ok(large);
assert.ok(operands.some((row) => row.parent.localId === large.id && row.slot === 'argument' && row.ordinal === 299));
const optional = findKind('CallExpression').find((node) => node.data.invocationKind === 'optionalCall');
assert.ok(operands.some((row) => row.parent.localId === optional.id && row.slot === 'argument' && row.ordinal === 5));
assert.ok(findKind('NewExpression').some((node) => node.data.invocationKind === 'construct'));
const tagged = findKind('TaggedTemplateExpression').find((node) => node.data.invocationKind === 'tag');
assert.ok(tagged);
assert.ok(operands.some((row) => row.parent.localId === tagged.id && row.slot === 'argument'));
assert.equal(findKind('CallExpression').filter((node) => node.data.invocationKind === 'optionalCall').length, 2);
assert.ok(findKind('CallExpression').some((node) => node.data.invocationKind === 'import'));
assert.equal(operands.filter((row) => row.flags.includes('hole')).length, 2);
assert.ok(operands.some((row) => row.flags.includes('spread')));
assert.ok(operands.some((row) => row.flags.includes('rest')));
assert.equal(nodes.filter((node) => node.kind === 'scope' && node.data.scopeKind === 'ArrowFunction').length, 2);
const unicode = nodes.find((node) => node.kind === 'literal' && text.slice(...node.span) === '"😀é"');
assert.ok(unicode);
assert.equal(unicode.span[1] - unicode.span[0], 5);
for (const node of nodes) if (node.kind === 'occurrence') assert.ok(!node.data.roles.includes('resolved'));
const abort = new AbortController();
const cancelled = createTypeScriptSemanticCollector({ ...args, signal: abort.signal }, { batchRows: 1, batchBytes: 4096 });
assert.equal(cancelled.batches.next().done, false);
abort.abort();
assert.throws(() => cancelled.batches.next(), /abort/i);
assert.equal(cancelled.summary.state, 'partial');
assert.throws(() => [...createTypeScriptSemanticCollector(args, { batchRows: 1, batchBytes: 1 }).batches], /allowance/);
const recovered = prepareTypeScriptSyntax('const = ;', { ext: '.ts' });
const recoveredSnapshot = createSemanticSourceSnapshot({ bytes: Buffer.from('const = ;'), repositoryNamespace: 'ts-fixture', path: 'recovered.ts', language: 'typescript' });
const recovery = createTypeScriptSemanticCollector({ ast: recovered.sourceFile, ts: recovered.ts, source: recoveredSnapshot.manifest, partitionId });
[...recovery.batches];
assert.equal(recovery.summary.state, 'partial');
assert.throws(() => createTypeScriptSemanticCollector({ ...args, source: { ...snapshot.manifest, textHash: '0'.repeat(64) } }), /mismatch/);

// Awaiting a blocked sink does not advance the resumable producer.
let release;
const blocked = new Promise((resolve) => { release = resolve; });
const pending = createTypeScriptSemanticCollector(args, { batchRows: 1, batchBytes: 4096 });
let writes = 0;
const drain = (async () => { for (const batch of pending.batches) { writes += 1; if (writes === 1) await blocked; assert.ok(batch.rows.length); } })();
await Promise.resolve();
const observed = pending.summary.nodes;
await Promise.resolve();
assert.equal(pending.summary.nodes, observed);
assert.equal(writes, 1);
release();
await drain;
assert.equal(pending.summary.state, 'complete');
console.log('TypeScript semantic syntax fixture passed');
