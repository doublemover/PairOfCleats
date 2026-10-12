#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { createTypeScriptProvider } from '../../src/index/tooling/typescript-provider.js';
import { deserializeTypeIr, containsTypeIr } from '../../src/index/tooling/typescript/type-ir/index.js';
import { validateTypeExpressionReferences } from '../../src/shared/symbolic-types.js';
import { validateConfig } from '../../src/config/validate.js';
import { runToolingPass } from '../../src/index/type-inference-crossfile/tooling.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ts-symbolic-provider-'));
const put = async (filename, value) => {
  const file = path.join(root, filename);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
};
const documents = text => [{ virtualPath: '.vfs/main.ts', containerPath: 'main.ts',
  languageId: 'typescript', effectiveExt: '.ts', text }];
const inputs = text => {
  const source = ts.createSourceFile('main.ts', text, ts.ScriptTarget.Latest, true);
  return { documents: documents(text), targets: source.statements.filter(node => ts.isFunctionDeclaration(node)).map(node => ({
    virtualPath: '.vfs/main.ts', virtualRange: { start: node.getStart(source), end: node.end },
    symbolHint: { name: node.name.text, kind: 'function' },
    chunkRef: { chunkUid: 'ck:typescript-symbolic:' + node.name.text, file: 'main.ts',
      start: node.getStart(source), end: node.end }
  })) };
};
const context = (extra = {}) => ({ repoRoot: root, strict: true,
  toolingConfig: { typescript: { resolveOrder: ['global'], typeRepresentation: 'symbolic', ...extra } } });
const run = (text, extra = {}) => createTypeScriptProvider({ subprocessChild: true }).run(context(extra), inputs(text));
const failure = reason => error => error?.code === 'ERR_TOOLING_REQUIRED_COMPUTATION_INCOMPLETE'
  && (!reason || error.reason === reason);
const membership = (result, ref, text) => {
  const graph = result.symbolicTypeGraphs.find(entry => entry.graphId === ref.graphId);
  const { arena } = deserializeTypeIr(graph.graph);
  return containsTypeIr(arena, arena.getNode(ref.nodeId), text);
};

try {
  const schema = JSON.parse(await fs.readFile(new URL('../../docs/config/schema.json', import.meta.url), 'utf8'));
  for (const mode of ['legacy', 'symbolic']) assert.equal(validateConfig(schema, {
    tooling: { typescript: { typeRepresentation: mode } }
  }).ok, true);
  assert.equal(validateConfig(schema, { tooling: { typescript: { typeRepresentation: 'best-effort' } } }).ok, false);
  await put('package.json', { type: 'module' });
  const config = { compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
    types: [], customConditions: ['development'] }, files: ['main.ts', 'types.ts'] };
  await put('tsconfig.json', config);
  await put('types.ts', 'export type Part = "a" | "b";\nexport type Product = `' + '${Part}'.repeat(72) + '`;\n');
  await put('node_modules/conditional-types/package.json', { name: 'conditional-types', type: 'module',
    exports: { '.': { development: './development.d.ts', default: './default.d.ts' } } });
  await put('node_modules/conditional-types/development.d.ts', 'export type Mode = "development";');
  await put('node_modules/conditional-types/default.d.ts', 'export type Mode = "default";');
  const text = [
    'import type { Part, Product } from "./types.js";',
    'import type { Mode } from "conditional-types";',
    'export declare function product(value: Part): Product;',
    'export declare function same(value: Part): Product;',
    'export declare function mode(): Mode;'
  ].join('\n');
  await put('main.ts', text);
  const first = await createTypeScriptProvider().run(context(), inputs(text));
  assert.equal(first.execution.complete, true);
  assert.deepEqual(first.execution.coverage, { required: 3, answered: 3, notApplicable: 0 });
  assert.equal(first.symbolicTypeGraphs.length, 1, 'one graph per evaluated context, not a DAG per target');
  assert.ok(first.symbolicTypeGraphs[0].graph.nodes.length < 100, '2^72 values remain factored');
  const product = first.byChunkUid['ck:typescript-symbolic:product'];
  assert.equal(product.payload.typeExpressions.declarationRef.origin.kind, 'virtual');
  assert.equal(product.payload.typeExpressions.declarationRef.origin.containerPath, 'main.ts');
  assert.equal(product.payload.typeExpressions.declarationRef.origin.virtualPath, '.vfs/main.ts');
  const same = first.byChunkUid['ck:typescript-symbolic:same'];
  const mode = first.byChunkUid['ck:typescript-symbolic:mode'];
  assert.deepEqual(product.payload.typeExpressions.returnType, same.payload.typeExpressions.returnType);
  assert.deepEqual(product.payload.typeExpressions.params.value, same.payload.typeExpressions.params.value);
  assert.ok(first.symbolicTypeGraphs[0].graph.rootIds.includes(product.payload.typeExpressions.params.value[0].nodeId),
    'union roots referenced by parameters must survive shared serialization');
  for (const entry of Object.values(first.byChunkUid)) {
    const expressions = entry.payload.typeExpressions;
    assert.equal(expressions.interpretation, 'declared-type-denotation');
    validateTypeExpressionReferences(expressions, first.symbolicTypeGraphs);
    assert.deepEqual(expressions.display, {});
    assert.ok(expressions.provenance.length > 0);
    assert.equal(Object.hasOwn(entry.payload, 'returnType'), false, 'a ref is not a legacy display string');
    assert.equal(Object.hasOwn(entry.payload, 'signature'), false);
    assert.match(entry.symbolRef.signatureKey, /type-expressions-v1:/, 'signature identity is explicitly versioned');
  }
  assert.equal(membership(first, product.payload.typeExpressions.returnType, 'a'.repeat(72)), true);
  assert.equal(membership(first, product.payload.typeExpressions.returnType, 'a'.repeat(71)), false);
  assert.equal(membership(first, mode.payload.typeExpressions.returnType, 'development'), true);
  const repeated = await run(text);
  assert.deepEqual(repeated.symbolicTypeGraphs, first.symbolicTypeGraphs, 'identical evaluated inputs have deterministic content identities');
  assert.equal(repeated.byChunkUid['ck:typescript-symbolic:product'].symbolRef.symbolId, product.symbolRef.symbolId);
  await put('tsconfig.json', { ...config, compilerOptions: { ...config.compilerOptions, customConditions: [] } });
  const changedConfig = await run(text);
  const changedMode = changedConfig.byChunkUid['ck:typescript-symbolic:mode'].payload.typeExpressions.returnType;
  assert.notEqual(changedMode.contextKey, mode.payload.typeExpressions.returnType.contextKey);
  assert.equal(membership(changedConfig, changedMode, 'default'), true);
  await put('types.ts', 'export type Part = "c" | "d";\nexport type Product = `' + '${Part}'.repeat(72) + '`;\n');
  const changedSource = await run(text);
  const changedProduct = changedSource.byChunkUid['ck:typescript-symbolic:product'].payload.typeExpressions.returnType;
  assert.notEqual(changedProduct.contextKey, changedMode.contextKey);
  assert.equal(membership(changedSource, changedProduct, 'c'.repeat(72)), true);
  assert.equal(membership(changedSource, changedProduct, 'a'.repeat(72)), false);
  const complexityProgram = ts.createProgram([path.join(root, 'types.ts')], { noLib: true, types: [] });
  const complexitySource = complexityProgram.getSourceFile(path.join(root, 'types.ts'));
  const complexityChecker = complexityProgram.getTypeChecker();
  const productAlias = complexitySource.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === 'Product');
  const complexityDiagnostics = complexityProgram.getSemanticDiagnostics(complexitySource);
  const fallbackType = complexityChecker.getTypeFromTypeNode(productAlias.type);
  assert.ok(fallbackType.flags & ts.TypeFlags.Any);
  assert.ok(complexityDiagnostics.some(diagnostic => diagnostic.code === 2590),
    'the symbolic language is exact annotation denotation, not parity with TS2590/any complexity fallback');

  // A successfully lowered earlier target cannot turn a later required failure
  // into a partial, cacheable provider result.
  const unsupported = text + '\nexport declare function unknown(value: number): number;';
  await assert.rejects(run(unsupported), failure('unsupported_type_syntax:NumberKeyword'));
  await assert.rejects(createTypeScriptProvider().run(context(), inputs(unsupported)), error => {
    assert.equal(error.code, 'ERR_TOOLING_REQUIRED_COMPUTATION_INCOMPLETE');
    assert.equal(error.reason, 'unsupported_type_syntax:NumberKeyword');
    assert.ok(error.details.obligations[0].sourceRef.sourceHash);
    return true;
  });
  for (const signature of [
    'export declare function optional(value?: "a"): "a";',
    'export function defaulted(value: "a" = "a"): "a" { return value; }',
    'export declare function rest(...value: "a"[]): "a";',
    'export declare function binder<T extends string>(value: T): T;',
    'export function inferred(value: "a") { return value; }',
    'export declare function duplicate(value: "a", value: "b"): "a";',
    'export declare function broken(value: "a"): "a" | ;'
  ]) await assert.rejects(run(signature), failure());
  await assert.rejects(run(text, { maxFileBytes: 1 }), failure('cap_maxFileBytes'));
  await assert.rejects(run(text, { maxProgramFiles: 1 }), failure('cap_maxProgramFiles'));
  await assert.rejects(createTypeScriptProvider().run({ ...context(), semanticSession: {} }, inputs(text)),
    failure('semantic_session_representation_not_supported'));
  const missing = inputs(text);
  missing.targets[0].virtualRange = { start: text.length + 100, end: text.length + 200 };
  await assert.rejects(createTypeScriptProvider({ subprocessChild: true }).run(context(), missing), failure('target_missing'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createTypeScriptProvider().run({ ...context(), abortSignal: controller.signal }, inputs(text)), { name: 'AbortError' });
  const passInputs = inputs(text);
  const chunks = passInputs.targets.map(target => ({ ...target.chunkRef, name: target.symbolHint.name,
    kind: 'function', lang: 'typescript', ext: '.ts', docmeta: {} }));
  await assert.rejects(runToolingPass({ rootDir: root, buildRoot: root, chunks,
    entryByUid: new Map(), log: () => {}, abortSignal: controller.signal,
    toolingConfig: { ...context().toolingConfig, enabledTools: ['typescript'], cache: { enabled: false } },
    toolingDocuments: passInputs }), { name: 'AbortError' });

  const embeddedText = 'export declare function embedded(value: "a"): "a";';
  const embeddedInputs = inputs(embeddedText);
  Object.assign(embeddedInputs.documents[0], { containerPath: 'component.vue', segmentUid: 'segment:fixture',
    segmentRange: { start: 17, end: 17 + embeddedText.length } });
  const embedded = await createTypeScriptProvider({ subprocessChild: true }).run(context({ useTsconfig: false }), embeddedInputs);
  const embeddedDeclaration = embedded.byChunkUid['ck:typescript-symbolic:embedded'].payload.typeExpressions.declarationRef;
  assert.ok(embeddedDeclaration.sourceId.endsWith('/.vfs/main.ts'), 'snapshot URI must remain the virtual compiler identity');
  assert.equal(embeddedDeclaration.origin.segmentUid, 'segment:fixture');
  assert.equal(embeddedDeclaration.origin.containerPath, 'component.vue');
  assert.deepEqual(embeddedDeclaration.origin.segmentRange, { start: 17, end: 17 + embeddedText.length });
  assert.equal(embeddedDeclaration.start, 0, 'compiler span stays virtual; origin carries the separate container offset');
  const noQueryText = 'export type NoQuery = "a";';
  const noQueryInput = { documents: documents(noQueryText), targets: [{ virtualPath: '.vfs/main.ts',
    virtualRange: { start: 0, end: noQueryText.length }, symbolHint: { name: 'NoQuery', kind: 'type' },
    chunkRef: { chunkUid: 'ck:typescript-symbolic:not-applicable', file: 'main.ts' } }] };
  const noQuery = await createTypeScriptProvider({ subprocessChild: true }).run(context({ useTsconfig: false }), noQueryInput);
  assert.deepEqual(noQuery.execution.coverage, { required: 0, answered: 0, notApplicable: 1 });
  assert.deepEqual(noQuery.symbolicTypeGraphs, [], 'no query means no invented empty graph');

  const legacy = await run('export function regular(value: number): number { return value; }', { typeRepresentation: 'legacy' });
  assert.equal(legacy.byChunkUid['ck:typescript-symbolic:regular'].payload.returnType, 'number');
  assert.equal(Object.hasOwn(legacy, 'symbolicTypeGraphs'), false);
  console.log('typescript symbolic provider test passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
