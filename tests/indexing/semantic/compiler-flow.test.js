import { collectCompilerStorageFlow } from '../../../src/index/semantic/compiler-storage-flow.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareTypeScriptSyntax, getTypeScriptSyntaxIdentity } from '../../../src/lang/typescript/syntax-context.js';
import { createTypeScriptSemanticCollector } from '../../../src/index/semantic/typescript-collector.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSyntaxPartitionId } from '../../../src/index/semantic/identity.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { writeSemanticAnalysis } from '../../../src/index/semantic/analysis-write.js';
import { collectCompilerFlow } from '../../../src/index/semantic/compiler-flow.js';
import { createTypeScriptNodeIndex } from '../../../src/index/tooling/typescript/node-index.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { createArtifactSemanticStore } from '../../../src/semantic/artifact-store.js';
const text = [
  'function choose(flag: boolean) { let x = 0; if (flag) x = 1; else x = 2; return x; }',
  'function loop(n: number) { let x = 0; while (x < n) { x += 1; } return x; }',
  'function finish() { let x = 0; try { x = 1; return x; } finally { x = 2; } }',
  'function caught() { let x = 0; try { throw 1; } catch (e) { x = 2; } return x; }',
  'function fields(key: string) { const obj = {meta: {scale: 2}, get effect() { return 9; }}; const alias = obj; alias.meta.scale = 3; const value = obj.meta.scale; return [value, obj[key], obj.effect]; }',
  'function payload(value: unknown) { try { throw value; } catch (error) { return error; } }',
  'function mutate(box: {value: number}, input: number) { box.value = input; return box.value; }',
  'function replaced() { try { return 1; } finally { return 2; } }',
  'function suppressed() { try { return 1; } finally { throw 2; } }',
  'function classWrites() { let x = 0; class C { static { x = 1; } value = (x = 2); } return x; }',
  'function guarded(fn: any, value: any) { let x = 0; fn?.(x = 1); const y = value ?? x; switch(y) { case 0: x = 2; } return x; }'
].join('\r\n');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-cfg-'));
try {
  const bytes = Buffer.from(text), source = createSemanticSourceSnapshot({ bytes, repositoryNamespace: 'cfg-fixture', path: 'flow.ts', language: 'typescript' }).manifest;
  const syntax = prepareTypeScriptSyntax(text, { ext: '.ts', fileName: 'flow.ts' }), { ts, sourceFile } = syntax;
  const options = { noLib: true, noResolve: true };
  const host = ts.createCompilerHost(options); host.getSourceFile = file => file === sourceFile.fileName ? sourceFile : undefined;
  const program = ts.createProgram([sourceFile.fileName], options, host), checker = program.getTypeChecker();
  const partitionId = createSyntaxPartitionId({ sourceUnitId: source.sourceUnitId, parser: getTypeScriptSyntaxIdentity(sourceFile),
    extractor: { schemaVersion: 1, version: '2' }, structuralPolicy: { structure: 'complete' } });
  const collector = createTypeScriptSemanticCollector({ ast: sourceFile, ts, source, partitionId });
  const rows = [...collector.batches].flatMap(batch => batch.rows), expressions = new Map(), declarations = new Map();
  for (const { family, row } of rows) if (family === 'node' && row.span) {
    const key = row.span.join(':');
    if (row.kind === 'expression') expressions.set(key, { partitionId, localId: row.id });
    if (row.kind === 'declaration') declarations.set(key, { partitionId, localId: row.id });
  }
  const policy = normalizeSemanticConfig({ enabled: true, profile: 'rich' }), diskAccount = createSemanticDiskAccount(64 * 1024 * 1024);
  const partition = await writeSemanticAnalysis({ rows, policy, stagingRoot: root, source, sourceBytes: bytes, partitionId,
    producerHash: 'a'.repeat(64), policyHash: 'b'.repeat(64), diskAccount, structuralSlots: collector.structuralSlots });
  const nodeIndex = createTypeScriptNodeIndex(ts, sourceFile, () => null);
  const expressionFor = node => node ? expressions.get(node.getStart(sourceFile) + ':' + node.end) : null;
  const declarationFor = node => { const anchor = node?.name || node; return anchor ? declarations.get(anchor.getStart(sourceFile) + ':' + anchor.end) : null; };
  const argumentsFor = { ts, checker, sourceFile, nodes: nodeIndex.nodes(), expressionFor, declarationFor, source, bytes,
    bindingPartition: partition, context: { contextKey: 'c'.repeat(64) }, root, policy, diskAccount };
  const flow = await collectCompilerFlow(argumentsFor);
  const store = createArtifactSemanticStore({ root, repoRoot: 'cfg-fixture', artifactSurfaceVersion: '0.1.0',
    generation: { baseBuildId: 'fixture', semanticRevision: 0 }, partitions: [partition, flow.partition] });
  const values = new Map(), edges = [];
  for await (const row of store.iterateRows(flow.partition.partitionId, 'semantic_records')) values.set(row.id, row);
  for await (const row of store.iterateRows(flow.partition.partitionId, 'semantic_edges')) edges.push(row);
  assert.ok(edges.some(edge => edge.kind === 'controlTrue'));
  assert.ok(edges.some(edge => edge.kind === 'controlFalse'));
  assert.ok(edges.some(edge => edge.kind === 'exceptional'));
  const choose = sourceFile.statements[0], finalRead = expressionFor(choose.body.statements.at(-1).expression);
  const reads = edges.filter(edge => edge.kind === 'reads' && edge.to.partitionId === finalRead.partitionId && edge.to.localId === finalRead.localId);
  assert.equal(reads.length, 1);
  const merge = values.get(reads[0].from.localId); assert.equal(merge.data.origin, 'merge');
  const incoming = edges.filter(edge => edge.kind === 'flowsTo' && edge.to.localId === merge.id && edge.to.partitionId === flow.partition.partitionId);
  assert.equal(incoming.length, 2, 'both branches reach return, overwritten initial definition does not');
  const loopMerges = [...values.values()].filter(row => row.kind === 'value' && row.data.origin === 'merge' && row.span?.[0] > choose.end);
  assert.ok(loopMerges.length > 0, 'loop requires a reaching-definition merge');
  assert.ok(flow.summaries.some(summary => summary.owner.name?.text === 'finish' && summary.returns.length === 1));
  assert.ok([...values.values()].some(row => row.kind === 'expression' && row.data.operation === 'isNullish'));
  assert.ok([...values.values()].some(row => row.kind === 'expression' && row.data.operation === 'strictEqual'));
  const replaced = flow.summaries.find(summary => summary.owner.name?.text === 'replaced');
  assert.equal(replaced.returns.length, 1, 'finally return overrides the pending try return');
  const suppressed = flow.summaries.find(summary => summary.owner.name?.text === 'suppressed');
  assert.equal(suppressed.returns.length, 0, 'finally throw suppresses the pending return');
  const payload = flow.summaries.find(summary => summary.owner.name?.text === 'payload');
  assert.equal(payload.exceptions.length, 0, 'explicit caught payload does not become an escaping exception');
  const payloadOwner = sourceFile.statements.find(node => node.name?.text === 'payload');
  const catchName = payloadOwner.body.statements[0].catchClause.variableDeclaration.name;
  const catchRef = expressionFor(catchName);
  const catchWrite = edges.find(edge => edge.kind === 'writes' && edge.to.partitionId === catchRef.partitionId && edge.to.localId === catchRef.localId);
  assert.ok(catchWrite);
  assert.ok(edges.some(edge => edge.kind === 'flowsTo' && edge.to.partitionId === catchWrite.from.partitionId && edge.to.localId === catchWrite.from.localId), 'thrown payload reaches the catch binding value');

  const classOwner = sourceFile.statements.find(node => node.name?.text === 'classWrites');
  const classReturn = expressionFor(classOwner.body.statements.at(-1).expression);
  const classRead = edges.find(edge => edge.kind === 'reads' && edge.to.partitionId === classReturn.partitionId && edge.to.localId === classReturn.localId);
  assert.ok(classRead, 'static block writes reach the surrounding function CFG');
  const classValue = values.get(classRead.from.localId);
  assert.equal(classValue.data.origin, 'definition');
  const classDefinition = edges.find(edge => edge.kind === 'defines' && edge.to.localId === classValue.id && edge.to.partitionId === flow.partition.partitionId);
  const staticValue = expressionFor(classOwner.body.statements[1].members[0].body.statements[0].expression.right);
  assert.deepEqual(classDefinition.from, staticValue, 'instance-field initializer is not executed at class definition time');
  assert.match(flow.coverage[0].reason, /class_storage_private_and_self_binding_effects_unresolved/);

  const mutate = flow.summaries.find(summary => summary.owner.name?.text === 'mutate');
  assert.deepEqual(mutate.effects.map(effect => ({parameter: effect.parameter, path: effect.path})), [{parameter: 0, path: ['value']}]);
  assert.ok(mutate.parameterFields.some(field => field.parameter === 0 && field.path.join('.') === 'value'));
  assert.ok(flow.fieldAccesses.length > 0);
  assert.match(flow.coverage[0].reason, /heap_path_alias_accessor_and_escape/);
  const storage = await collectCompilerStorageFlow(argumentsFor);
  const storageStore = createArtifactSemanticStore({ root, repoRoot: 'cfg-fixture', artifactSurfaceVersion: '0.1.0',
    generation: { baseBuildId: 'fixture', semanticRevision: 0 }, partitions: [partition, storage.partition] });
  const storageRows = [], storageEdges = [];
  for await (const row of storageStore.iterateRows(storage.partition.partitionId, 'semantic_records')) storageRows.push(row);
  for await (const row of storageStore.iterateRows(storage.partition.partitionId, 'semantic_edges')) storageEdges.push(row);
  assert.ok(storageRows.some(row => row.kind === 'value' && row.data.storage));
  const fieldWrite = [...nodeIndex.nodes()].find(node => ts.isBinaryExpression(node) && node.left.getText(sourceFile) === 'alias.meta.scale');
  const writeValue = expressionFor(fieldWrite.right);
  const written = storageEdges.find(edge => edge.kind === 'writes' && edge.from.partitionId === writeValue.partitionId && edge.from.localId === writeValue.localId);
  assert.ok(written);
  const fieldRead = [...nodeIndex.nodes()].find(node => ts.isPropertyAccessExpression(node) && node.getText(sourceFile) === 'obj.meta.scale');
  const readTarget = expressionFor(fieldRead);
  assert.ok(storageEdges.some(edge => edge.kind === 'reads' && edge.from.localId === written.to.localId
    && edge.to.partitionId === readTarget.partitionId && edge.to.localId === readTarget.localId), 'const receiver aliases share the same allocation field candidate');
  assert.ok(storageEdges.some(edge => edge.kind === 'packs'));
  assert.ok(storageEdges.every(edge => edge.certainty === 'modeled'), 'field candidates are not a unique runtime producer proof');
  assert.match(storage.coverage[0].reason, /dynamic_property_key/);
  assert.match(storage.coverage[0].reason, /getter_setter_or_method_effect_unknown/);
  assert.match(storage.coverage[0].reason, /field_alias_escape/);
  const shallowStorage = await collectCompilerStorageFlow({ ...argumentsFor, policy: normalizeSemanticConfig({ enabled: true, enrichment: { fieldPathDepth: 0 } }) });
  assert.match(shallowStorage.coverage[0].reason, /field_path_depth_widened/);
  const limited = await collectCompilerFlow({ ...argumentsFor, policy: normalizeSemanticConfig({ enabled: true, enrichment: { maxSccIterations: 0 } }) });
  assert.equal(limited.coverage[0].state, 'partial');
  assert.match(limited.coverage[0].reason, /iteration_budget/);
  console.log('CFG branch joins, mutable versions, loops, exceptions/finally and zero analysis budget passed');
} finally { await fs.rm(root, { recursive: true, force: true }); }
