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
import { resolveJsTsExports } from '../../../../src/lang/js-ts-exports.js';
import { buildCallIndex, buildFileRelations } from '../../../../src/index/build/file-processor/relations.js';
import { attachCallDetailsByChunkIndex } from '../../../../src/index/build/file-processor/process-chunks/dedupe.js';
import { buildChunkRelations } from '../../../../src/index/language-registry.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

applyTestEnv({ testing: '1' });
// UNVALIDATED: same canonical export owner used by registry docmeta, actual consumers.
const library = [
  'function hidden() { return input; }',
  'function internal() { return input; }',
  'export { internal as publicName, internal as "strange.name" };',
  'function renamedAway() { return input; } export { renamedAway as onlyExported };',
  'export default function namedDefault() { return input; }',
  'class InternalClass { static run() { return input; } } export { InternalClass as PublicClass };',
  'export function direct() { return input; }'
].join('\n');
const main = [
  'import { publicName as LocalAlias, hidden, internal, onlyExported, renamedAway, "strange.name" as Quoted, PublicClass as AliasClass, InternalClass, direct } from "./lib";',
  'import Default from "./lib"; import * as ns from "./lib";',
  'function aliasUse() { return LocalAlias(); }',
  'function quotedUse() { return Quoted(); }',
  'function renamedUse() { return onlyExported(); }',
  'function defaultUse() { return Default(); }',
  'function namespaceAliasUse() { return ns.publicName(); }',
  'function namespaceDefaultUse() { return ns.default(); }',
  'function memberUse() { return AliasClass.run(); }',
  'function namespaceMemberUse() { return ns.PublicClass.run(); }',
  'function directUse() { return direct(); }',
  'function hiddenUse() { return hidden(); }',
  'function localNameUse() { return internal(); }',
  'function renamedLocalUse() { return renamedAway(); }',
  'function namespaceHiddenUse() { return ns.hidden(); }',
  'function namespaceLocalUse() { return ns.internal(); }',
  'function classLocalUse() { return InternalClass.run(); }',
  'function defaultMemberUse() { return Default.run(); }',
  'function namespaceDefaultMemberUse() { return ns.default.run(); }'
].join('\n');
const libraryFor = language => library + (language === 'typescript' ? [
  '\nfunction erasedFunction() { return input; } export type { erasedFunction as ErasedAlias };',
  'interface InterfaceOnly {} export { InterfaceOnly as ErasedInterface };',
  'class ErasedClassLocal { static run() { return input; } } export type { ErasedClassLocal as ErasedClass };'
].join('\n') : '');
const mainFor = language => main + (language === 'typescript' ? [
  '\nimport { ErasedAlias, ErasedInterface, ErasedClass } from "./lib";',
  'function erasedAliasUse() { return ErasedAlias(); }',
  'function erasedInterfaceUse() { return ErasedInterface(); }',
  'function erasedClassUse() { return ErasedClass.run(); }',
  'function erasedConstructorUse() { return new ErasedClass(); }'
].join('\n') : '');
const declared = { hidden: 'PrivateNoise', internal: 'AliasValue', renamedAway: 'RenamedValue',
  namedDefault: 'DefaultValue', 'InternalClass.run': 'MemberValue', direct: 'DirectValue',
  erasedFunction: 'ErasedNoise', 'ErasedClassLocal.run': 'ErasedMemberNoise' };
const makeInput = language => {
  const chunks = [], fileRelations = new Map(), ext = language === 'typescript' ? '.ts' : '.js';
  for (const [file, text] of [[`lib${ext}`, libraryFor(language)], [`main${ext}`, mainFor(language)]]) {
    let ast, raw, relations;
    if (language === 'typescript') {
      const context = createTypeScriptSyntaxContext(), options = { ext, typeScriptSyntaxContext: context };
      raw = buildTypeScriptChunksFromBabel(text, options);
      relations = buildTypeScriptRelations(text, raw, options); ast = prepareTypeScriptBabelSyntax(text, options);
      assert.equal(context.babelParses, 1);
    } else {
      ast = parseJavaScriptAst(text, { ext }); raw = buildJsChunks(text, { ext, ast });
      relations = buildCodeRelations(text, file, { ext, ast });
    }
    assert.ok(ast && !ast.errors?.length);
    fileRelations.set(file, buildFileRelations(relations, file));
    const index = buildCallIndex(relations); attachCallDetailsByChunkIndex(index, raw);
    for (let chunkIndex = 0; chunkIndex < raw.length; chunkIndex += 1) {
      const entry = raw[chunkIndex], chunkUid = `${language}:${file}:${entry.name}`;
      const exports = resolveJsTsExports(ast, entry);
      if (entry.name === 'internal') assert.deepEqual(exports.exportNames, ['publicName', 'strange.name']);
      if (entry.name === 'namedDefault') assert.deepEqual(exports.exportNames, ['default']);
      if (entry.name === 'hidden') assert.equal(exports.exported, false);
      if (entry.name === 'InternalClass.run') assert.equal(exports.exported, false, 'a member needs its exported enclosing owner');
      chunks.push({ file, lang: language, fileHash: sha1(text), fileHashAlgo: 'sha1', chunkUid,
        name: entry.name, kind: entry.kind, start: entry.start, end: entry.end,
        metaV2: { symbol: { scheme: 'poc', qualifiedName: entry.name, symbolId: `symbol:${chunkUid}`,
          symbolKey: `key:${chunkUid}`, kindGroup: entry.name === 'InternalClass' ? 'class' : 'function' } },
        docmeta: { ...exports, ...(declared[entry.name] ? { returnType: declared[entry.name] } : {}) },
        codeRelations: buildChunkRelations({ chunk: entry, fileRelations: relations, callIndex: index, chunkIndex }) });
    }
  }
  return { chunks, fileRelations };
};
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-module-export-targets-'));
const run = (language, input, suffix = 'cache') => applyCrossFileInference({ rootDir: path.join(root, language),
  buildRoot: path.join(root, language), cacheRoot: path.join(root, language, suffix), ...input,
  enabled: true, cacheEnabled: true, useTooling: false, enableTypeInference: true, enableRiskCorrelation: false, log: () => {} });
const summaryOf = (input, name) => input.chunks.find(chunk => chunk.name === name).codeRelations.callSummaries[0];
const unresolved = (input, name) => {
  const chunk = input.chunks.find(entry => entry.name === name), summary = summaryOf(input, name);
  assert.equal(summary.calleeRef.status, 'unresolved', name); assert.deepEqual(summary.calleeRef.candidates, []);
  assert.equal(summary.targetChunkUid, undefined); assert.deepEqual(chunk.docmeta.inferredTypes?.returns || [], [], name);
};
try {
  for (const language of ['javascript', 'typescript']) {
    const ext = language === 'typescript' ? '.ts' : '.js';
    await fs.mkdir(path.join(root, language));
    await fs.writeFile(path.join(root, language, `lib${ext}`), libraryFor(language));
    await fs.writeFile(path.join(root, language, `main${ext}`), mainFor(language));
    const cold = makeInput(language), stats = await run(language, cold);
    assert.equal(stats.cacheHit, false); assert.equal(stats.sourceReadCoverage.status, 'qualified');
    for (const [name, target] of [['aliasUse', 'internal'], ['quotedUse', 'internal'], ['renamedUse', 'renamedAway'],
      ['defaultUse', 'namedDefault'], ['namespaceAliasUse', 'internal'], ['namespaceDefaultUse', 'namedDefault'],
      ['memberUse', 'InternalClass.run'], ['namespaceMemberUse', 'InternalClass.run'], ['directUse', 'direct']]) {
      const chunk = cold.chunks.find(entry => entry.name === name), summary = summaryOf(cold, name);
      assert.equal(summary.calleeRef.status, 'resolved', `${language} ${name}`);
      assert.equal(summary.targetChunkUid, `${language}:lib${ext}:${target}`);
      assert.deepEqual(chunk.docmeta.inferredTypes.returns.map(row => row.type), [declared[target]]);
    }
    for (const name of ['hiddenUse', 'localNameUse', 'renamedLocalUse', 'namespaceHiddenUse', 'namespaceLocalUse',
      'classLocalUse', 'defaultMemberUse', 'namespaceDefaultMemberUse']) unresolved(cold, name);
    if (language === 'typescript') for (const name of ['erasedAliasUse', 'erasedInterfaceUse', 'erasedClassUse', 'erasedConstructorUse']) {
      unresolved(cold, name); assert.equal(summaryOf(cold, name).reason, 'module-export-unavailable');
    }
    const warm = makeInput(language); assert.equal((await run(language, warm)).cacheHit, true);
    assert.deepEqual(JSON.parse(JSON.stringify(warm.chunks)), JSON.parse(JSON.stringify(cold.chunks)));

    const unknown = makeInput(language);
    unknown.chunks.find(chunk => chunk.file === `lib${ext}` && chunk.name === 'internal').docmeta.exported = null;
    assert.equal((await run(language, unknown)).cacheHit, false, 'changed export admission cannot alias the valid replay');
    unresolved(unknown, 'aliasUse'); unresolved(unknown, 'quotedUse'); unresolved(unknown, 'namespaceAliasUse');

    const disowned = makeInput(language);
    disowned.chunks.find(chunk => chunk.name === 'InternalClass').metaV2.symbol.chunkUid = 'different-owner';
    await run(language, disowned, 'owner-cache');
    unresolved(disowned, 'memberUse'); unresolved(disowned, 'namespaceMemberUse');

    const outside = makeInput(language), member = outside.chunks.find(chunk => chunk.name === 'InternalClass.run');
    member.start = member.end;
    await run(language, outside, 'range-cache');
    unresolved(outside, 'memberUse'); unresolved(outside, 'namespaceMemberUse');

    const legacy = makeInput(language);
    for (const chunk of legacy.chunks) { delete chunk.docmeta.exported; delete chunk.docmeta.exportNames; }
    await run(language, legacy, 'legacy-cache');
    assert.equal(summaryOf(legacy, 'directUse').targetChunkUid, `${language}:lib${ext}:direct`,
      'existing unqualified rows keep the prior supported direct-name compatibility route');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Canonical module exports qualify alias/default/member targets and pinned replay.');
