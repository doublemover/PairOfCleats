import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { sha1 } from '../../../../src/shared/hash.js';
import { parseJavaScriptAst, buildJsChunks, buildCodeRelations } from '../../../../src/lang/javascript.js';
import { buildTypeScriptChunksFromBabel } from '../../../../src/lang/typescript/chunks-babel.js';
import { buildTypeScriptRelations } from '../../../../src/lang/typescript/relations.js';
import { createTypeScriptSyntaxContext, prepareTypeScriptBabelSyntax } from '../../../../src/lang/typescript/syntax-context.js';
import { buildCallIndex, buildFileRelations } from '../../../../src/index/build/file-processor/relations.js';
import { attachCallDetailsByChunkIndex } from '../../../../src/index/build/file-processor/process-chunks/dedupe.js';
import { buildChunkRelations } from '../../../../src/index/language-registry.js';
import { filterRawRelationsWithLexicon } from '../../../../src/index/build/file-processor/lexicon-relations-filter.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

applyTestEnv({ testing: '1' });
// UNVALIDATED: actual owned syntax -> file/chunk handoff -> pinned cold/warm consumer.
const declarations = [
  'import { factory as Local } from "./lib";',
  'import * as ns from "./lib";',
  'import { "factory" as Quoted } from "./lib";',
  'import Default from "./default";',
  'import { factory as External } from "external-package";',
  'import { factory as Missing } from "./absent";',
  'import { factory as Alias } from "@configured/alias";',
  'import { factory as Empty } from "";'
];
const ordinary = [
  'function aliasUse() { return Local(); }',
  'function namespaceUse() { return ns.factory(); }',
  'function quotedUse() { return Quoted(); }',
  'function defaultUse() { return Default(); }',
  'function externalUse() { return External(); }',
  'function missingUse() { return Missing(); }',
  'function configuredUse() { return Alias(); }',
  'function emptyUse() { return Empty(); }'
];
const typedDeclarations = [
  'import type { factory as TypeFactory } from "./lib";',
  'import { type factory as SpecFactory, factory as ValueFactory } from "./lib";',
  'import type * as typeNs from "./lib";',
  'import type TypeDefault from "./default";'
];
const typed = [
  'function typeUse() { return TypeFactory(); }',
  'function specifierTypeUse() { return SpecFactory(); }',
  'function namespaceTypeUse() { return typeNs.factory(); }',
  'function defaultTypeUse() { return TypeDefault(); }',
  'function constructorTypeUse() { return new TypeFactory(); }',
  'function valueSpecifierUse() { return ValueFactory(); }'
];
const sourcesFor = language => {
  const ext = language === 'typescript' ? '.ts' : '.js';
  return {
    [`main${ext}`]: [...declarations, ...(language === 'typescript' ? typedDeclarations : []),
      ...ordinary, ...(language === 'typescript' ? typed : [])].join('\n'),
    [`lib${ext}`]: 'export function factory() { return input; }',
    [`default${ext}`]: 'export default function () { return input; }',
    [`noise${ext}`]: 'export function External() { return input; } export function Missing() { return input; } export function Alias() { return input; } export function Empty() { return input; }'
  };
};
const parse = (language, text, file) => {
  const ext = language === 'typescript' ? '.ts' : '.js';
  if (language === 'typescript') {
    const context = createTypeScriptSyntaxContext(), options = { ext, typeScriptSyntaxContext: context };
    const raw = buildTypeScriptChunksFromBabel(text, options) || [];
    const ast = prepareTypeScriptBabelSyntax(text, options);
    assert.ok(ast && !ast.errors?.length, 'valid import-only syntax can have no declaration chunks');
    const relations = buildTypeScriptRelations(text, raw, options);
    assert.equal(context.babelParses, 1, 'static bindings borrow existing syntax, without another parse');
    return { raw, relations };
  }
  const ast = parseJavaScriptAst(text, { ext }); assert.ok(ast); assert.ok(!ast.errors?.length);
  return { raw: buildJsChunks(text, { ext, ast }), relations: buildCodeRelations(text, file, { ext, ast }) };
};
const makeInput = language => {
  const chunks = [], fileRelations = new Map();
  for (const [file, text] of Object.entries(sourcesFor(language))) {
    const { raw, relations } = parse(language, text, file);
    assert.ok(raw.length, `${language} ${file} supplies its actual declarations`);
    const filtered = filterRawRelationsWithLexicon(relations, { languageId: language, relKey: file });
    const fileRelation = buildFileRelations(filtered, file);
    fileRelations.set(file, fileRelation);
    if (file.startsWith('main.')) {
      assert.equal(Object.getPrototypeOf(fileRelation.importBindings), null);
      for (const [local, imported] of [['Local', 'factory'], ['ns', '*'], ['Quoted', 'factory'], ['Default', 'default']]) {
        const binding = fileRelation.importBindings[local];
        assert.equal(binding.imported, imported); assert.ok(Object.isFrozen(binding));
        assert.equal(binding.typeOnly, undefined);
      }
      assert.equal(fileRelation.importBindings.Empty.module, '');
      if (language === 'typescript') {
        for (const local of ['TypeFactory', 'SpecFactory', 'typeNs', 'TypeDefault']) {
          assert.equal(fileRelation.importBindings[local].typeOnly, true, local);
        }
        assert.equal(fileRelation.importBindings.ValueFactory.typeOnly, undefined);
      }
    }
    const index = buildCallIndex(filtered); attachCallDetailsByChunkIndex(index, raw);
    for (let chunkIndex = 0; chunkIndex < raw.length; chunkIndex += 1) {
      const entry = raw[chunkIndex], chunkUid = `${language}:${file}:${entry.name}`;
      const type = entry.name === 'factory' ? 'Widget' : entry.name === 'default' ? 'DefaultValue'
        : ['External', 'Missing', 'Alias', 'Empty'].includes(entry.name) ? 'Noise' : null;
      chunks.push({ file, lang: language, fileHash: sha1(text), fileHashAlgo: 'sha1', chunkUid,
        name: entry.name, kind: entry.kind, start: entry.start, end: entry.end,
        metaV2: { symbol: { scheme: 'poc', qualifiedName: entry.name, symbolId: `symbol:${chunkUid}`,
          symbolKey: `key:${chunkUid}`, kindGroup: 'function' } }, docmeta: type ? { returnType: type } : {},
        codeRelations: buildChunkRelations({ chunk: entry, fileRelations: filtered, callIndex: index, chunkIndex }) });
    }
  }
  return { chunks, fileRelations };
};
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-parser-import-bindings-'));
const run = (language, input) => applyCrossFileInference({ rootDir: path.join(root, language), buildRoot: path.join(root, language),
  cacheRoot: path.join(root, language, 'cache'), ...input, enabled: true, cacheEnabled: true, useTooling: false,
  enableTypeInference: true, enableRiskCorrelation: false, log: () => {} });
try {
  for (const language of ['javascript', 'typescript']) {
    await fs.mkdir(path.join(root, language), { recursive: true });
    for (const [file, text] of Object.entries(sourcesFor(language))) await fs.writeFile(path.join(root, language, file), text);
    const cold = makeInput(language), ext = language === 'typescript' ? '.ts' : '.js';
    const stats = await run(language, cold);
    assert.equal(stats.cacheHit, false); assert.equal(stats.sourceReadCoverage.status, 'qualified');
    for (const name of ['aliasUse', 'namespaceUse', 'quotedUse', 'defaultUse',
      ...(language === 'typescript' ? ['valueSpecifierUse'] : [])]) {
      const chunk = cold.chunks.find(entry => entry.name === name), summary = chunk.codeRelations.callSummaries[0];
      const isDefault = name === 'defaultUse', expectedFile = isDefault ? `default${ext}` : `lib${ext}`;
      assert.equal(summary.calleeRef.status, 'resolved', `${language} ${name}`);
      assert.equal(summary.targetChunkUid, `${language}:${expectedFile}:${isDefault ? 'default' : 'factory'}`);
      assert.deepEqual(chunk.docmeta.inferredTypes.returns.map(row => row.type), [isDefault ? 'DefaultValue' : 'Widget']);
    }
    for (const name of ['externalUse', 'missingUse', 'configuredUse', 'emptyUse',
      ...(language === 'typescript' ? ['typeUse', 'specifierTypeUse', 'namespaceTypeUse', 'defaultTypeUse', 'constructorTypeUse'] : [])]) {
      const chunk = cold.chunks.find(entry => entry.name === name), summary = chunk.codeRelations.callSummaries[0];
      assert.equal(summary.calleeRef.status, 'unresolved', `${language} ${name}`);
      assert.deepEqual(summary.calleeRef.candidates, []);
      assert.equal(summary.targetChunkUid, undefined);
      assert.deepEqual(chunk.docmeta.inferredTypes?.returns || [], [], 'module/type barriers cannot borrow global or nominal facts');
      assert.ok((chunk.codeRelations.callLinks || []).every(link => link.to.status === 'unresolved'));
      if (name.includes('Type') || name === 'typeUse') assert.equal(summary.reason, 'type-only-import');
    }
    if (language === 'typescript') {
      assert.ok(cold.chunks.filter(chunk => chunk.file === 'main.ts').some(chunk =>
        (chunk.codeRelations.usageLinks || []).some(link => link.to.targetName === 'TypeFactory'
          && link.to.resolved?.chunkUid === 'typescript:lib.ts:factory')),
      'generic usage resolution remains independent from the runtime-only cache entry');
    }
    const warm = makeInput(language); assert.equal((await run(language, warm)).cacheHit, true);
    assert.deepEqual(JSON.parse(JSON.stringify(warm.chunks)), JSON.parse(JSON.stringify(cold.chunks)));
  }

  const oldText = 'import { factory as Old } from "./lib";', oldAst = parseJavaScriptAst(oldText, { ext: '.js' });
  assert.equal(buildCodeRelations('function replacement() {}', 'replacement.js', { ext: '.js', ast: oldAst }).importBindings, null,
    'an AST owned by another source cannot project file import bindings');
  const recoveredText = `${oldText} const duplicate = 1; const duplicate = 2;`;
  const recovered = parseJavaScriptAst(recoveredText, { ext: '.js' }); assert.ok(recovered.errors.length);
  assert.equal(buildCodeRelations(recoveredText, 'recovered.js', { ext: '.js', ast: recovered }).importBindings, null);
  const flow = '// @flow\nimport type { factory as TypeFactory } from "./lib"; import typeof factory from "./lib";';
  const flowRelations = buildCodeRelations(flow, 'flow.js', { ext: '.js' });
  assert.equal(flowRelations.importBindings.TypeFactory.typeOnly, true);
  assert.equal(flowRelations.importBindings.factory.typeOnly, true);
  const nested = 'declare module "ambient" { import { factory as Ambient } from "./lib"; }';
  assert.equal(parse('typescript', nested, 'ambient.ts').relations.importBindings, null,
    'ambient/nested module bindings do not become file-global imports');
  const equals = 'import Alias = require("./lib");';
  assert.equal(parse('typescript', equals, 'equals.ts').relations.importBindings, null,
    'unsupported import-equals target authority is not invented');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Owned JS/TS import bindings preserve alias/module/type barriers through qualified replay.');
