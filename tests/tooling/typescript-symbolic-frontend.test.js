#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createFiniteStringFrontend } from '../../src/index/tooling/typescript/type-ir/frontend.js';
import {
  createTypeIrArena,
  classifyTypeIr,
  containsTypeIr
} from '../../src/index/tooling/typescript/type-ir/index.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ts-symbolic-frontend-'));
const hash = value => createHash('sha256').update(value).digest('hex');
const put = async (file, content) => {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, typeof content === 'string' ? content : JSON.stringify(content));
  return target;
};
const getDeclarations = source => {
  const aliases = new Map();
  const functions = new Map();
  const visit = node => {
    if (ts.isTypeAliasDeclaration(node)) aliases.set(node.name.text, node);
    if (ts.isFunctionDeclaration(node) && node.name) {
      const existing = functions.get(node.name.text) || [];
      existing.push(node);
      functions.set(node.name.text, existing);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { aliases, functions };
};
const counters = program => ({
  types: program.getTypeCount(),
  instantiations: program.getInstantiationCount()
});
const assertRef = (ref, program, context) => {
  assert.equal(typeof ref?.sourceId, 'string', context);
  const source = program.getSourceFile(fileURLToPath(ref.sourceId));
  assert.ok(source, `${context}: provenance must reference an actual program source`);
  assert.equal(ref.sourceId, pathToFileURL(source.fileName).href, context);
  assert.equal(ref.sourceHash, hash(source.text), `${context}: provenance must hash the exact UTF-8 snapshot`);
  assert.ok(Number.isInteger(ref.start) && ref.start >= 0 && ref.start <= ref.end, context);
  assert.ok(Number.isInteger(ref.end) && ref.end <= source.end, context);
};
const assertUnsupported = (result, program, contextKey, label) => {
  assert.equal(result.status, 'unsupported', label);
  assert.equal(typeof result.reason, 'string', label);
  assert.ok(result.reason.length > 0, label);
  assert.ok(result.obligations.length > 0, `${label}: unsupported syntax needs an explicit obligation`);
  assert.equal(Object.hasOwn(result, 'root'), false, `${label}: unsupported cannot return an empty substitute`);
  for (const obligation of result.obligations) {
    assert.equal(typeof obligation.reason, 'string', label);
    assert.equal(obligation.contextKey, contextKey, label);
    assertRef(obligation.sourceRef, program, label);
  }
};

const libraryText = [
  'export type Atom = "a" | "b";',
  'export type Join<A extends string, B extends string = "z"> = `${A}/${B}`;',
  'export type WithDefault<T extends string = "fallback"> = `${T}!`;',
  'export type Dependent<A extends string = "head", B extends string = A> = `${A}-${B}`;',
  'type T = "module";',
  'export type Shadow<T extends string> = `${T}:suffix`;',
  'export type Outer<T extends string> = Shadow<T>;',
  'export type Repeated<T extends string> = `${T}${T}`;',
  'export type Box<T extends string> = `[${T}]`;',
  'export type NonString<T extends number> = "wrong";',
  'export type Unconstrained<T> = "wrong";'
].join('\n');
const smallFamilies = new Map([
  ['Literal', ['only']],
  ['EmptyLiteral', ['']],
  ['PlainTemplate', ['plain']],
  ['Escaped', ['quote"\\tail']],
  ['Unicode', ['🙂', 'é', 'e\u0301']],
  ['Base', ['red', 'blue']],
  ['Grouped', ['red', 'blue']],
  ['Duplicate', ['red', 'blue']],
  ['Nothing', []],
  ['EmptyProduct', []],
  ['Template', ['prered:1post', 'prered:2post', 'preblue:1post', 'preblue:2post']],
  ['Imported', ['a:red', 'a:blue', 'b:red', 'b:blue']],
  ['Concrete', ['left/up', 'left/down', 'right/up', 'right/down']],
  ['Defaulted', ['fallback!']],
  ['DependentDefault', ['head-head']],
  ['OverriddenDefault', ['changed-changed']],
  ['Nested', ['inner:suffix']],
  ['SameAliasNested', ['[[inner]]']],
  ['Repeated', ['aa', 'ab', 'ba', 'bb']],
  ['Reexported', ['a', 'b']]
]);
const mainText = [
  'import type { Atom as ImportedAtom, Join, WithDefault, Dependent, Outer, Box, Repeated as Repeat, NonString, Unconstrained } from "./types.js";',
  'import type { Atom as ReexportedAtom } from "./barrel.js";',
  'import type * as Namespaced from "./types.js";',
  'import type { Mode } from "conditional-types";',
  'export type Literal = "only";',
  'export type EmptyLiteral = "";',
  'export type PlainTemplate = `plain`;',
  'export type Escaped = "quote\\\"\\\\tail";',
  'export type Unicode = "🙂" | "é" | "e\\u0301";',
  'export type Base = "red" | "blue";',
  'export type Grouped = ((Base));',
  'export type Duplicate = Base | "red" | never;',
  'export type Nothing = never;',
  'export type EmptyProduct = `${Nothing}:end`;',
  'export type Template = `pre${Base}:${"1" | "2"}post`;',
  'export type Imported = `${ImportedAtom}:${Base}`;',
  'export type Concrete = Join<"left" | "right", "up" | "down">;',
  'export type Defaulted = WithDefault;',
  'export type DependentDefault = Dependent;',
  'export type OverriddenDefault = Dependent<"changed">;',
  'export type Nested = Outer<"inner">;',
  'export type SameAliasNested = Box<Box<"inner">>;',
  'export type Repeated = Repeat<ImportedAtom>;',
  'export type Reexported = ReexportedAtom;',
  'export type Qualified = Namespaced.Atom;',
  'export type ConditionalExport = Mode;',
  'type Bit = "0" | "1";',
  'export type Giant = `' + '${Bit}'.repeat(72) + '`;',
  'export type Broad = string;',
  'export type Any = any;',
  'export type Unknown = unknown;',
  'export type BroadTemplate = `${string}:tail`;',
  'export type Numeric = 3;',
  'export type Conditional = "a" extends string ? "yes" : "no";',
  'export type Mapped = { [K in Base]: K };',
  'export type Indexed = { a: "value" }["a"];',
  'export type Intrinsic = Uppercase<"a">;',
  'export type DirectRecursive = DirectRecursive;',
  'export type MutualA = MutualB;',
  'export type MutualB = MutualA;',
  'type RecursiveGeneric<T extends string> = RecursiveGeneric<T>;',
  'export type GenericRecursion = RecursiveGeneric<"a">;',
  'export type BadArgument = Join<3>;',
  'export type BadConstraint = NonString<3>;',
  'export type MissingConstraint = Unconstrained<"a">;',
  'export type MissingArgument = Join;',
  'export type TooManyArguments = Join<"a", "b", "c">;',
  'export type FreeParameter<T extends string> = T;',
  'export declare function supported(input: ImportedAtom, suffix: "x" | "y"): Join<ImportedAtom, "x">;',
  'export declare function emptyReturn(): never;',
  'export function inferredReturn() { return "a"; }',
  'export declare function optional(input?: "a"): "a";',
  'export declare function rest(...input: "a"[]): "a";',
  'export function defaultParameter(input: "a" = "a"): "a" { return input; }',
  'export declare function destructured({ input }: { input: "a" }): "a";',
  'export declare function receiver(this: "a"): "a";',
  'export declare function unannotated(input): "a";',
  'export declare function generic<T extends string>(input: T): T;',
  'export async function asynchronous(): Promise<"a"> { return "a"; }',
  'export function* generator(): Generator<"a"> { yield "a"; }',
  'export function overloaded(input: "a"): "a";',
  'export function overloaded(input: "b"): "b";',
  'export function overloaded(input: "a" | "b"): "a" | "b" { return input; }',
  'export function lexicalScope() {',
  '  type ImportedAtom = "local";',
  '  function locallyBound(input: ImportedAtom): ImportedAtom { return input; }',
  '  return locallyBound;',
  '}'
].join('\n');

try {
  assert.equal(ts.version, '6.0.3', 'the compiler oracle and counter evidence are version-specific');
  await put('package.json', { type: 'module' });
  await put('types.ts', libraryText);
  await put('barrel.ts', 'export type { Atom } from "./types.js";');
  const mainFile = await put('main.ts', mainText);
  await put('node_modules/conditional-types/package.json', {
    name: 'conditional-types', type: 'module',
    exports: { '.': { development: './development.d.ts', default: './default.d.ts' } }
  });
  await put('node_modules/conditional-types/development.d.ts', 'export type Mode = "development";');
  await put('node_modules/conditional-types/default.d.ts', 'export type Mode = "default";');
  const contextIds = new Map();
  let firstSnapshot;
  for (const resolution of ['NodeNext', 'Bundler']) {
    for (const condition of ['development', 'default']) {
      const contextKey = `ts-${ts.version}-${resolution}-${condition}`;
      const options = {
        target: ts.ScriptTarget.ES2022,
        module: resolution === 'NodeNext' ? ts.ModuleKind.NodeNext : ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind[resolution],
        customConditions: condition === 'development' ? ['development'] : [],
        strict: true, types: [], noEmit: true
      };
      const program = ts.createProgram({ rootNames: [mainFile], options });
      const checker = program.getTypeChecker();
      assert.ok(program.getSourceFiles().some(source => /[/\\]lib\.es2022\.d\.ts$/.test(source.fileName)),
        'use normal default libraries rather than a noLib approximation');
      const source = program.getSourceFile(mainFile);
      assert.equal(source.parseDiagnostics.length, 0, 'the fixture must be syntactically valid');
      const { aliases, functions } = getDeclarations(source);
      const arena = createTypeIrArena({ contextKey });
      const frontend = createFiniteStringFrontend({ ts, checker, arena });
      const before = counters(program);
      const lowered = new Map();
      for (const name of [...smallFamilies.keys(), 'ConditionalExport', 'Giant']) {
        const node = aliases.get(name).type;
        const result = frontend.lowerTypeNode(node);
        assert.equal(result.status, 'complete', `${contextKey}: ${name}`);
        assert.equal(result.contextKey, contextKey, name);
        assert.equal(result.root.contextKey, contextKey, name);
        assertRef(result.sourceRef, program, name);
        assert.equal(result.sourceRef.start, node.getStart(source), name);
        assert.equal(result.sourceRef.end, node.end, name);
        for (const ref of result.dependencies) assertRef(ref, program, name);
        lowered.set(name, result);
      }
      assert.ok(lowered.get('Imported').dependencies.some(ref => ref.sourceId === pathToFileURL(path.join(root, 'types.ts')).href),
        'imported alias provenance must include its actual declaration source');
      assert.ok(lowered.get('ConditionalExport').dependencies.some(ref => ref.sourceId.endsWith(`/${condition}.d.ts`)),
        'conditional exports must resolve through this program and its selected condition');
      for (const name of [
        'Broad', 'Any', 'Unknown', 'BroadTemplate', 'Numeric', 'Conditional', 'Mapped', 'Indexed', 'Intrinsic',
        'DirectRecursive', 'MutualA', 'GenericRecursion', 'BadArgument', 'BadConstraint',
        'MissingConstraint', 'MissingArgument', 'TooManyArguments', 'FreeParameter', 'Qualified'
      ]) {
        assertUnsupported(frontend.lowerTypeNode(aliases.get(name).type), program, contextKey, name);
      }
      const importedAgain = frontend.lowerTypeNode(aliases.get('Imported').type);
      assert.equal(importedAgain.root, lowered.get('Imported').root, 'memo hits reuse the context-owned DAG');
      assert.deepEqual(importedAgain.dependencies, lowered.get('Imported').dependencies,
        'memo hits must preserve transitive declaration provenance');
      const successfulFunctions = new Map();
      for (const name of ['supported', 'emptyReturn', 'locallyBound']) {
        const declaration = functions.get(name)[0];
        const result = frontend.lowerFunctionDeclaration(declaration);
        assert.equal(result.status, 'complete', name);
        assert.equal(result.contextKey, contextKey, name);
        assertRef(result.declarationRef, program, name);
        assert.equal(result.declarationRef.start, declaration.getStart(source), name);
        assert.equal(result.declarationRef.end, declaration.end, name);
        for (const ref of result.provenance) assertRef(ref, program, name);
        successfulFunctions.set(name, result);
      }
      assert.deepEqual(Object.keys(successfulFunctions.get('supported').params), ['input', 'suffix']);
      assert.equal(successfulFunctions.get('supported').params.input.length, 1);
      for (const name of [
        'inferredReturn', 'optional', 'rest', 'defaultParameter', 'destructured', 'receiver',
        'unannotated', 'generic', 'asynchronous', 'generator', 'overloaded'
      ]) {
        for (const declaration of functions.get(name)) {
          assertUnsupported(frontend.lowerFunctionDeclaration(declaration), program, contextKey, name);
        }
      }
      for (const [limits, name] of [
        [{ maxNodes: 1 }, 'Grouped'],
        [{ maxDepth: 1 }, 'Grouped'],
        [{ maxAliasInstantiations: 1 }, 'Imported'],
        [{ maxLiteralBytes: 1 }, 'Literal'],
        [{ maxLiteralBytes: 3 }, 'Unicode'],
        [{ maxSourceBytes: 1 }, 'Literal']
      ]) {
        assert.throws(() => createFiniteStringFrontend({ ts, checker, arena, limits })
          .lowerTypeNode(aliases.get(name).type), error => {
          assert.equal(error.code, 'ERR_TOOLING_REQUIRED_COMPUTATION_INCOMPLETE');
          assert.equal(error.complete, false);
          return true;
        }, `${contextKey}: exhausted ${Object.keys(limits)[0]} must fail closed`);
      }
      const controller = new AbortController();
      const abortable = createFiniteStringFrontend({ ts, checker, arena, signal: controller.signal });
      controller.abort();
      assert.throws(() => abortable.lowerTypeNode(aliases.get('Literal').type), error => error.name === 'AbortError');
      assert.throws(() => abortable.lowerFunctionDeclaration(functions.get('supported')[0]), error => error.name === 'AbortError');
      assert.deepEqual(counters(program), before,
        `${contextKey}: lowering must not trigger checker type creation or generic instantiation`);
      assert.ok(arena.stats().nodes < 250, 'a 2^72 product must stay a small shared graph');
      contextIds.set(contextKey, lowered.get('Literal').root.id);
      firstSnapshot ||= { contextKey, options, result: lowered.get('Literal') };

      // Oracle calls intentionally start only after every lowering and the flat
      // counter assertion. Never request a checker type for the giant product.
      const negatives = ['', 'not-a-member', 'red!', 'a/a', 'inner', 'module:suffix'];
      for (const [name, expected] of [...smallFamilies, ['ConditionalExport', [condition]]]) {
        const symbolic = lowered.get(name).root;
        const classified = classifyTypeIr(arena, symbolic);
        assert.equal(classified.cardinality, expected.length === 0 ? 'zero' : expected.length === 1 ? 'one' : 'many', name);
        assert.equal(classified.complete, true, name);
        assert.equal(classified.witnesses.length, Math.min(2, expected.length), name);
        assert.equal(new Set(classified.witnesses).size, classified.witnesses.length, name);
        for (const witness of classified.witnesses) assert.ok(expected.includes(witness), name);
        const actual = checker.getTypeFromTypeNode(aliases.get(name).type);
        const candidates = new Set([...expected, ...negatives]);
        for (const candidate of candidates) {
          const oracle = checker.isTypeAssignableTo(checker.getStringLiteralType(candidate), actual);
          assert.equal(oracle, expected.includes(candidate), `${contextKey}: oracle fixture ${name}: ${candidate}`);
          assert.equal(containsTypeIr(arena, symbolic, candidate), oracle, `${contextKey}: differential ${name}: ${candidate}`);
        }
      }
      assert.equal(containsTypeIr(arena, lowered.get('Giant').root, '0'.repeat(72)), true);
      assert.equal(containsTypeIr(arena, lowered.get('Giant').root, '01'.repeat(36)), true);
      assert.equal(containsTypeIr(arena, lowered.get('Giant').root, '0'.repeat(71)), false);
      assert.equal(containsTypeIr(arena, lowered.get('Giant').root, '0'.repeat(71) + 'x'), false);
      const supported = successfulFunctions.get('supported');
      assert.equal(containsTypeIr(arena, supported.returnType, 'a/x'), true);
      assert.equal(containsTypeIr(arena, supported.returnType, 'a/y'), false);
      assert.equal(containsTypeIr(arena, supported.params.input[0], 'a'), true);
      assert.equal(containsTypeIr(arena, supported.params.input[0], 'local'), false);
      const local = successfulFunctions.get('locallyBound');
      assert.equal(containsTypeIr(arena, local.returnType, 'local'), true);
      assert.equal(containsTypeIr(arena, local.returnType, 'a'), false);
      assert.equal(containsTypeIr(arena, local.params.input[0], 'local'), true);
      const giantClassification = classifyTypeIr(arena, lowered.get('Giant').root);
      assert.equal(giantClassification.cardinality, 'many');
      assert.equal(giantClassification.complete, true);
      assert.equal(giantClassification.witnesses.length, 2);
      for (const witness of giantClassification.witnesses) {
        assert.equal(containsTypeIr(arena, lowered.get('Giant').root, witness), true);
      }
      assert.deepEqual(classifyTypeIr(arena, successfulFunctions.get('emptyReturn').returnType),
        { cardinality: 'zero', witnesses: [], complete: true });
    }
  }
  assert.equal(new Set(contextIds.values()).size, 4, 'identical text in different compiler contexts cannot share identities');
  await put('main.ts', mainText + '\n// A new source snapshot with the same finite-string meaning.\n');
  const changedProgram = ts.createProgram({ rootNames: [mainFile], options: firstSnapshot.options });
  const changedChecker = changedProgram.getTypeChecker();
  const changedBefore = counters(changedProgram);
  const changedArena = createTypeIrArena({ contextKey: firstSnapshot.contextKey });
  const changedFrontend = createFiniteStringFrontend({ ts, checker: changedChecker, arena: changedArena });
  const changedNode = getDeclarations(changedProgram.getSourceFile(mainFile)).aliases.get('Literal').type;
  const changed = changedFrontend.lowerTypeNode(changedNode);
  assert.equal(changed.status, 'complete');
  assert.equal(changed.root.id, firstSnapshot.result.root.id, 'unchanged finite meaning remains canonical within a context');
  assert.equal(changed.sourceRef.sourceId, firstSnapshot.result.sourceRef.sourceId);
  assert.notEqual(changed.sourceRef.sourceHash, firstSnapshot.result.sourceRef.sourceHash,
    'the same file URL must not reuse provenance from a stale source snapshot');
  assertRef(changed.sourceRef, changedProgram, 'changed snapshot');
  assert.deepEqual(counters(changedProgram), changedBefore);
  console.log('Finite-string frontend preserves real TypeScript binding, provenance and contexts without checker expansion.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
