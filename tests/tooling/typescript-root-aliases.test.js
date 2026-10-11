#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { createTypeScriptProvider } from '../../src/index/tooling/typescript-provider.js';
import { createDefaultCompilerOptions } from '../../src/index/tooling/typescript/config.js';
import { createVirtualCompilerHost } from '../../src/index/tooling/typescript/host.js';
import { createTypeScriptRootNames } from '../../src/index/tooling/typescript/roots.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ts-root-aliases-'));
const absolute = (filename) => path.join(root, filename);
const canonicalize = (filename, sensitive = ts.sys.useCaseSensitiveFileNames) => {
  const resolved = path.resolve(filename);
  return sensitive ? resolved : resolved.toLowerCase();
};

try {
  const originalA = absolute('source-a.ts');
  const originalB = absolute('source-b.ts');
  const virtualA = absolute('.vfs/a/source.ts');
  const virtualB = absolute('.vfs/b/source.ts');
  const ambient = absolute('ambient.d.ts');
  const container = absolute('embedded.vue');
  const segment = absolute('.vfs/embedded/script.ts');
  const sourcePaths = new Map([[virtualA, originalA], [virtualB, originalB]]);
  const roots = createTypeScriptRootNames({
    configRootNames: [originalB, ambient, originalA, originalB, container],
    virtualRootNames: [virtualA, virtualB, segment, virtualA],
    sourcePaths,
    useCaseSensitive: true
  });
  assert.deepEqual(roots, [virtualB, ambient, virtualA, container, segment],
    'replace physical roots in place, preserve unmapped roots, and append only unseen virtual roots');
  assert.equal(roots.filter((filename) => filename === ambient).length, 1,
    'ambient config roots must remain in the full program');
  assert.ok(roots.includes(container) && roots.includes(segment),
    'embedded containers without a sourcePaths alias must remain separate from their virtual segments');

  const mixedVirtual = absolute('.vfs/Mixed/Source.ts');
  const mixedOriginal = absolute('Mixed/Source.ts');
  const insensitive = createTypeScriptRootNames({
    configRootNames: [mixedOriginal.toUpperCase(), ambient, ambient.toUpperCase()],
    virtualRootNames: [mixedVirtual, mixedVirtual.toUpperCase()],
    sourcePaths: new Map([[canonicalize(mixedVirtual, false), mixedOriginal]]),
    useCaseSensitive: false
  });
  assert.equal(insensitive.length, 2, 'case-insensitive aliases and repeated roots must share one identity');
  assert.equal(canonicalize(insensitive[0], false), canonicalize(mixedVirtual, false));
  assert.equal(canonicalize(insensitive[1], false), canonicalize(ambient, false));
  const sensitive = createTypeScriptRootNames({
    configRootNames: [mixedOriginal.toUpperCase()],
    virtualRootNames: [mixedVirtual],
    sourcePaths: new Map([[mixedVirtual, mixedOriginal]]),
    useCaseSensitive: true
  });
  assert.deepEqual(sensitive, [mixedOriginal.toUpperCase(), mixedVirtual],
    'case-sensitive programs must not conflate distinct physical filenames');

  const documents = [
    {
      containerPath: 'consumer.ts',
      virtualPath: '.vfs/consumer/input.ts',
      text: [
        'import { buildValue, type SharedInput } from "./shared";',
        'export function readValue(input: SharedInput) {',
        '  const value = buildValue(input);',
        '  return { text: value.label, ready: value.ready, retries: value.retries, code: configuredAmbient.code };',
        '}'
      ].join('\n')
    },
    {
      containerPath: 'globals.ts',
      virtualPath: '.vfs/globals/input.ts',
      text: 'const globalContext = { ready: true, amount: 2 };\n'
    },
    {
      containerPath: 'shared.ts',
      virtualPath: '.vfs/shared/input.ts',
      text: [
        'export interface SharedInput { label: string; }',
        'export function buildValue(input: SharedInput) {',
        '  return { label: input.label, ready: globalContext.ready, retries: configuredAmbient.retries };',
        '}'
      ].join('\n')
    }
  ];
  const context = absolute('config-context.d.ts');
  await fs.writeFile(context, 'declare const configuredAmbient: { code: string; retries: number };\n');
  for (const document of documents) await fs.writeFile(absolute(document.containerPath), document.text);
  const virtualRoots = documents.map((document) => absolute(document.virtualPath));
  const configRoots = [...documents.map((document) => absolute(document.containerPath)), context];
  const virtualSources = new Map(documents.map((document) => [
    canonicalize(absolute(document.virtualPath)), document.text
  ]));
  const aliases = new Map(documents.map((document) => [
    canonicalize(absolute(document.virtualPath)), absolute(document.containerPath)
  ]));
  const options = { ...createDefaultCompilerOptions(ts, {}), noLib: true, types: [] };
  const buildProgram = (rootNames) => ts.createProgram({
    rootNames,
    options,
    host: createVirtualCompilerHost(ts, options, virtualSources, aliases)
  });
  const deduplicatedRoots = createTypeScriptRootNames({
    configRootNames: configRoots,
    virtualRootNames: virtualRoots,
    sourcePaths: aliases,
    useCaseSensitive: ts.sys.useCaseSensitiveFileNames
  });
  const duplicateProgram = buildProgram([...configRoots, ...virtualRoots]);
  const deduplicatedProgram = buildProgram(deduplicatedRoots);
  const canonicalProgram = buildProgram([...virtualRoots, context]);
  assert.equal(duplicateProgram.getSourceFiles().length, 7,
    'regression fixture must expose distinct physical and virtual SourceFiles before alias normalization');
  assert.equal(deduplicatedProgram.getSourceFiles().length, 4,
    'a full program must contain each source snapshot once plus its unmapped ambient root');
  for (const document of documents) {
    assert.equal(deduplicatedProgram.getSourceFile(absolute(document.containerPath)), undefined,
      `physical source ${document.containerPath} must not duplicate its virtual snapshot`);
    assert.ok(deduplicatedProgram.getSourceFile(absolute(document.virtualPath)));
  }
  assert.ok(duplicateProgram.getSemanticDiagnostics().some((diagnostic) => diagnostic.code === 2451),
    'fixture must reproduce duplicate block-scoped globals in the old original-plus-virtual root set');
  assert.deepEqual(deduplicatedProgram.getSemanticDiagnostics(), [],
    'canonical roots must resolve imports and ambient globals without duplicate-global errors');

  const extract = (program) => {
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(virtualRoots[0]);
    const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node));
    const signature = checker.getSignatureFromDeclaration(declaration);
    const type = checker.getReturnTypeOfSignature(signature);
    const properties = Object.fromEntries(checker.getPropertiesOfType(type).map((property) => [
      property.name,
      checker.typeToString(checker.getTypeOfSymbolAtLocation(property, declaration), declaration)
    ]));
    const imported = source.statements[0].importClause.namedBindings.elements[0];
    const importedSymbol = checker.getAliasedSymbol(checker.getSymbolAtLocation(imported.name));
    assert.equal(canonicalize(importedSymbol.declarations[0].getSourceFile().fileName), canonicalize(virtualRoots[2]),
      'cross-document import must resolve to the existing virtual snapshot');
    return {
      signature: checker.signatureToString(signature, declaration),
      returnType: checker.typeToString(type, declaration),
      properties
    };
  };
  const actual = extract(deduplicatedProgram);
  assert.deepEqual(actual, extract(canonicalProgram),
    'alias normalization must preserve signature and inferred type parity with the canonical full program');
  assert.deepEqual(actual.properties, { text: 'string', ready: 'boolean', retries: 'number', code: 'string' },
    'inference must keep both cross-document imports and all ambient/global context');
  await fs.writeFile(absolute('tsconfig.json'), JSON.stringify({
    compilerOptions: { noLib: true, types: [] },
    files: [...documents.map((document) => document.containerPath), 'config-context.d.ts']
  }));
  const consumer = documents[0];
  const chunkUid = 'ck:test:typescript:root-aliases';
  const start = consumer.text.indexOf('export function readValue');
  const end = consumer.text.length;
  const providerResult = await createTypeScriptProvider().run({
    repoRoot: root,
    strict: true,
    toolingConfig: { typescript: { resolveOrder: ['global'], maxProgramFiles: 4 } }
  }, {
    documents: documents.map((document) => ({ ...document, effectiveExt: '.ts', languageId: 'typescript' })),
    targets: [{
      virtualPath: consumer.virtualPath,
      virtualRange: { start, end },
      chunkRef: { chunkUid, chunkId: 'chunk_root_aliases', file: consumer.containerPath, start, end },
      symbolHint: { name: 'readValue', kind: 'function' }
    }]
  });
  assert.equal(providerResult.byChunkUid[chunkUid]?.payload.returnType, actual.returnType,
    'the provider must apply alias normalization before its maxProgramFiles cap and keep inferred types');
  assert.equal((providerResult.diagnostics?.checks || []).some((check) => check.name === 'cap_maxProgramFiles'), false,
    'physical aliases must not consume the program-file cap a second time');
  const referencedMain = absolute('triple/src/main.ts');
  const referencedGlobal = absolute('triple/shared/global.ts');
  const referencedAmbient = absolute('types/environment.d.ts');
  const virtualMain = absolute('.vfs/triple/main.ts');
  const virtualGlobal = absolute('.vfs/referenced/global.ts');
  const referenceText = [
    '/// <reference path="../../types/environment.d.ts" />',
    '/// <reference path="../shared/global.ts" />',
    'export function readReferences() {',
    '  return { status: ambientFromReference.status, value: referencedGlobal.value };',
    '}'
  ].join('\n');
  await fs.mkdir(path.dirname(referencedMain), { recursive: true });
  await fs.mkdir(path.dirname(referencedGlobal), { recursive: true });
  await fs.mkdir(path.dirname(referencedAmbient), { recursive: true });
  await fs.writeFile(referencedMain, referenceText);
  await fs.writeFile(referencedGlobal, 'const referencedGlobal = { value: "stale-physical-copy" };\n');
  await fs.writeFile(referencedAmbient, 'declare const ambientFromReference: { status: "ready" };\n');
  const referenceAliases = new Map([
    [canonicalize(virtualMain), referencedMain],
    [canonicalize(virtualGlobal), referencedGlobal]
  ]);
  const referenceSources = new Map([
    [canonicalize(virtualMain), referenceText],
    [canonicalize(virtualGlobal), 'const referencedGlobal = { value: 42 };\n']
  ]);
  const referenceRoots = createTypeScriptRootNames({
    configRootNames: [referencedMain],
    virtualRootNames: [virtualMain, virtualGlobal],
    sourcePaths: referenceAliases,
    useCaseSensitive: ts.sys.useCaseSensitiveFileNames
  });
  const referenceProgram = ts.createProgram({
    rootNames: referenceRoots,
    options,
    host: createVirtualCompilerHost(ts, options, referenceSources, referenceAliases)
  });
  assert.deepEqual(referenceProgram.getSemanticDiagnostics(), [],
    'triple-slash path references must resolve from the physical source directory and use mapped virtual sources');
  assert.equal(referenceProgram.getSourceFiles().length, 3,
    'triple-slash references must add unmapped ambient files without duplicating mapped global sources');
  assert.ok(referenceProgram.getSourceFile(referencedAmbient),
    'non-root ambient declarations reached by triple-slash references must remain in the program');
  assert.equal(referenceProgram.getSourceFile(referencedGlobal), undefined,
    'a triple-slash reference must not load the stale physical twin of an authoritative virtual source');
  const referenceChecker = referenceProgram.getTypeChecker();
  const referenceDeclaration = referenceProgram.getSourceFile(virtualMain).statements.find((node) => ts.isFunctionDeclaration(node));
  const referenceSignature = referenceChecker.getSignatureFromDeclaration(referenceDeclaration);
  const referenceReturnType = referenceChecker.getReturnTypeOfSignature(referenceSignature);
  const referenceProperties = Object.fromEntries(referenceChecker.getPropertiesOfType(referenceReturnType).map((property) => [
    property.name,
    referenceChecker.typeToString(referenceChecker.getTypeOfSymbolAtLocation(property, referenceDeclaration), referenceDeclaration)
  ]));
  assert.deepEqual(referenceProperties, { status: '"ready"', value: 'number' },
    'triple-slash inference must combine non-root ambient context with the authoritative VFS snapshot');
  const graphTexts = new Map([
    ['a.ts', [
      'import { bValue } from "./barrel";',
      'export interface Envelope { value: number; }',
      'export const aValue = 1;',
      'export function readCycle() { return bValue + aValue; }'
    ].join('\n')],
    ['b.ts', [
      'import { aValue } from "./a";',
      'export const bValue = 2;',
      'export function readBack() { return aValue + bValue; }'
    ].join('\n')],
    ['barrel.ts', 'export { bValue } from "./b"; export type { Envelope } from "./a";\n'],
    ['augment.ts', 'import "./a"; declare module "./a" { interface Envelope { label: string; } }\n'],
    ['consumer.ts', [
      'import type { Envelope } from "./barrel";',
      'import { readCycle } from "./a";',
      'export function readAugmented(value: Envelope) { return { label: value.label, total: readCycle() }; }'
    ].join('\n')]
  ]);
  const graphPhysicalRoots = [];
  const graphVirtualRoots = [];
  const graphAliases = new Map();
  const graphSources = new Map();
  await fs.mkdir(absolute('graph/src'), { recursive: true });
  for (const [filename, text] of graphTexts) {
    const physicalPath = absolute(`graph/src/${filename}`);
    const virtualPath = absolute(`.vfs/graph/${filename}/input.ts`);
    await fs.writeFile(physicalPath, text);
    graphPhysicalRoots.push(physicalPath);
    graphVirtualRoots.push(virtualPath);
    graphAliases.set(canonicalize(virtualPath), physicalPath);
    graphSources.set(canonicalize(virtualPath), text);
  }
  const graphProgram = ts.createProgram({
    rootNames: createTypeScriptRootNames({
      configRootNames: graphPhysicalRoots,
      virtualRootNames: graphVirtualRoots,
      sourcePaths: graphAliases,
      useCaseSensitive: ts.sys.useCaseSensitiveFileNames
    }),
    options,
    host: createVirtualCompilerHost(ts, options, graphSources, graphAliases)
  });
  assert.deepEqual(graphProgram.getSemanticDiagnostics(), [],
    'circular imports, re-exports, and module augmentation must share the same canonical module identities');
  assert.equal(graphProgram.getSourceFiles().length, graphTexts.size,
    'a cyclic import graph must contain each virtual source exactly once');
  for (const physicalPath of graphPhysicalRoots) assert.equal(graphProgram.getSourceFile(physicalPath), undefined);
  const graphChecker = graphProgram.getTypeChecker();
  const graphConsumer = graphProgram.getSourceFile(absolute('.vfs/graph/consumer.ts/input.ts'));
  const augmentedFunction = graphConsumer.statements.find((node) => ts.isFunctionDeclaration(node));
  const augmentedSignature = graphChecker.getSignatureFromDeclaration(augmentedFunction);
  const augmentedReturn = graphChecker.getReturnTypeOfSignature(augmentedSignature);
  assert.equal(graphChecker.typeToString(augmentedReturn, augmentedFunction), '{ label: string; total: number; }',
    'a type re-export must retain module augmentation while a cyclic import retains the inferred return type');
  const augmentedParameter = graphChecker.getTypeAtLocation(augmentedFunction.parameters[0]);
  assert.deepEqual(graphChecker.getPropertiesOfType(augmentedParameter).map((property) => property.name).sort(), ['label', 'value'],
    'the re-exported interface must merge its original declaration and augmentation');
  console.log('TypeScript root aliases preserve the full program without duplicate physical and virtual SourceFiles.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
