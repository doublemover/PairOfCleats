import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { sha1 } from '../../../../src/shared/hash.js';
import { parseJavaScriptAst, buildJsChunks, buildCodeRelations } from '../../../../src/lang/javascript.js';
import { buildTypeScriptChunksFromBabel } from '../../../../src/lang/typescript/chunks-babel.js';
import { buildTypeScriptRelations } from '../../../../src/lang/typescript/relations.js';
import { createTypeScriptSyntaxContext } from '../../../../src/lang/typescript/syntax-context.js';
import { buildCallIndex } from '../../../../src/index/build/file-processor/relations.js';
import { attachCallDetailsByChunkIndex } from '../../../../src/index/build/file-processor/process-chunks/dedupe.js';
import { buildChunkRelations } from '../../../../src/index/language-registry.js';
import { filterRawRelationsWithLexicon } from '../../../../src/index/build/file-processor/lexicon-relations-filter.js';
import { extractReturnCalls } from '../../../../src/index/type-inference-crossfile/extract.js';
import { buildCrossFileFingerprint } from '../../../../src/index/type-inference-crossfile/cache.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

applyTestEnv({ testing: '1' });
const text = [
  'function factory() { return input; }',
  'function wrapper(value) { return value; }',
  'function noise() { return input; }',
  'function regular() { return factory(); }',
  'function enclosed() { return (factory()); }',
  'const arrow = () => factory();',
  'function constructed() { return new Widget(factory()); }',
  'function argumentsOnly() { return wrapper(factory()); }',
  'function quoted() { const value = "return factory()"; return value; }',
  'function commented() { /* return new Phantom(); return factory(); */ return 0; }',
  'function templateText() { return `return factory()`; }',
  'function templateExpression() { return `${factory()}`; }',
  'function regexText() { return /return factory()/; }',
  'function resultRead() { return factory().field; }',
  'function constructedRead() { return new Widget().field; }',
  'function comparison() { return factory() === input; }',
  'function sequence() { return factory(), input; }',
  'function bare() { factory(); return factory; }',
  'function nested() { function inner() { return factory(); } return 0; }',
  'function nestedConstructor() { const inner = () => new Phantom(); return 0; }',
  'function laterCall() { return\nfactory(); }',
  'async function pending() { return factory(); }',
  'async function awaited() { return await factory(); }',
  'function* generator() { return factory(); }',
  'function optional() { return factory?.(); }',
  'function twoSites() { factory(); return factory(); }',
  'function unresolved() { return factory(); }'
].join('\n');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-owned-returns-'));
const declared = { factory: 'Widget', wrapper: 'Wrapped', noise: 'Noise' };
const makeChunks = language => {
  const ext = language === 'typescript' ? '.ts' : '.js', file = `returns${ext}`;
  let rawChunks, relations;
  if (language === 'typescript') {
    const context = createTypeScriptSyntaxContext(), options = { ext, typeScriptSyntaxContext: context };
    rawChunks = buildTypeScriptChunksFromBabel(text, options);
    relations = buildTypeScriptRelations(text, rawChunks, options);
    assert.equal(context.babelParses, 1, 'return ownership borrows the existing relation syntax context');
    assert.ok(context.babelReuses >= 1);
  } else {
    const ast = parseJavaScriptAst(text, { ext });
    rawChunks = buildJsChunks(text, { ext, ast });
    relations = buildCodeRelations(text, file, { ext, ast });
  }
  const filtered = filterRawRelationsWithLexicon(relations, { languageId: language, relKey: file });
  const index = buildCallIndex(filtered);
  attachCallDetailsByChunkIndex(index, rawChunks);
  const chunks = rawChunks.map((raw, chunkIndex) => {
    const chunkUid = `${language}:${raw.name}`;
    const codeRelations = buildChunkRelations({ chunk: raw, fileRelations: filtered, callIndex: index, chunkIndex });
    return { file, lang: language, fileHash: sha1(text), fileHashAlgo: 'sha1', chunkUid,
      name: raw.name, kind: raw.kind, start: raw.start, end: raw.end,
      metaV2: { symbol: { scheme: 'poc', qualifiedName: raw.name, symbolId: `symbol:${chunkUid}`,
        symbolKey: `key:${raw.name}`, chunkUid, kindGroup: 'function' } },
      codeRelations, docmeta: declared[raw.name] ? { returnType: declared[raw.name] } : {} };
  });
  const twoSites = chunks.find(chunk => chunk.name === 'twoSites');
  const sites = twoSites.codeRelations.callDetails.filter(detail => detail.callee === 'factory').sort((a, b) => a.start - b.start);
  assert.equal(sites.length, 2);
  // Already-resolved occurrences may share display spelling. The non-returned
  // occurrence must never lend its binding/return facts to the returned one.
  sites[0].compilerBinding = { symbolRef: { v: 1, targetName: 'factory', status: 'resolved',
    candidates: [], resolved: { symbolId: `symbol:${language}:noise`, chunkUid: `${language}:noise` } } };
  const unresolved = chunks.find(chunk => chunk.name === 'unresolved');
  unresolved.codeRelations.callDetails[0].compilerBinding = { symbolRef: { v: 1, targetName: 'factory',
    status: 'unresolved', candidates: [], resolved: null } };
  return chunks;
};
const returnedTypes = chunk => new Set((chunk.docmeta.inferredTypes?.returns || []).map(row => row.type));
const run = (language, chunks) => applyCrossFileInference({ rootDir: root, buildRoot: root,
  cacheRoot: path.join(root, language), chunks, enabled: true, cacheEnabled: true, useTooling: false,
  enableTypeInference: true, enableRiskCorrelation: false, log: () => {} });
try {
  const staleText = 'function stale() { return factory(); }';
  const changedText = 'function stale() { return "factory"; }';
  const staleAst = parseJavaScriptAst(staleText, { ext: '.js' });
  const [staleChunk] = buildJsChunks(staleText, { ast: staleAst });
  const mismatched = buildCodeRelations(changedText, 'changed.js', { ast: staleAst });
  assert.equal(mismatched.callDetails.some(detail => detail.returnedValue), false,
    'a parser snapshot from another source cannot authorize newly emitted return evidence');
  assert.equal(extractReturnCalls(changedText, { chunk: { ...staleChunk, lang: 'javascript', codeRelations: mismatched } }).calls.size, 0);
  const recoveredText = 'function recovered() { let duplicate; let duplicate; return factory(); }';
  const recoveredAst = parseJavaScriptAst(recoveredText, { ext: '.js' });
  assert.ok(recoveredAst?.errors?.length, 'the control must reach a recovered parser result');
  const [recoveredChunk] = buildJsChunks(recoveredText, { ast: recoveredAst });
  const recoveredRelations = buildCodeRelations(recoveredText, 'recovered.js', { ast: recoveredAst });
  assert.ok(recoveredRelations.callDetails.some(detail => detail.callee === 'factory'));
  assert.equal(extractReturnCalls(recoveredText, { chunk: { ...recoveredChunk, lang: 'javascript', codeRelations: recoveredRelations } }).calls.size, 0,
    'recovered syntax cannot authorize a return fact through the raw-text fallback');
  const assertedText = 'function asserted() { return factory() as Other; }';
  const assertedOptions = { ext: '.ts', typeScriptSyntaxContext: createTypeScriptSyntaxContext() };
  const [assertedChunk] = buildTypeScriptChunksFromBabel(assertedText, assertedOptions);
  const assertedRelations = buildTypeScriptRelations(assertedText, [assertedChunk], assertedOptions);
  assert.ok(assertedRelations.callDetails.some(detail => detail.callee === 'factory'));
  assert.equal(extractReturnCalls(assertedText, { chunk: { ...assertedChunk, lang: 'typescript', codeRelations: assertedRelations } }).calls.size, 0,
    'a type assertion does not inherit the inner invocation type through this projection');
  await fs.writeFile(path.join(root, 'returns.js'), text);
  await fs.writeFile(path.join(root, 'returns.ts'), text);
  for (const language of ['javascript', 'typescript']) {
    const cold = makeChunks(language);
    const regular = cold.find(chunk => chunk.name === 'regular');
    const detail = regular.codeRelations.callDetails.find(entry => entry.callee === 'factory');
    assert.ok(Object.isFrozen(detail.returnedValue));
    assert.ok(Object.isFrozen(detail.returnedValue.ownerRanges));
    assert.equal(extractReturnCalls(text, { chunk: regular }).calls.has('factory'), true);
    const otherLanguage = structuredClone(regular);
    otherLanguage.lang = 'go';
    assert.notEqual(buildCrossFileFingerprint({ chunks: [regular], enableTypeInference: true }),
      buildCrossFileFingerprint({ chunks: [otherLanguage], enableTypeInference: true }), 'language-specific admission must own replay identity');
    for (const edit of [
      copy => { copy.end += 1; },
      copy => { copy.codeRelations.callDetails[0].start += 1; },
      copy => { copy.codeRelations.callDetails[0].returnedValue.expression.push(999); },
      copy => { delete copy.codeRelations.callDetails[0].returnedValue; }
    ]) {
      const copy = structuredClone(regular); edit(copy);
      assert.equal(extractReturnCalls(text, { chunk: copy }).calls.size, 0, 'mismatched or absent syntax ownership cannot use raw-text fallback');
    }
    const stats = await run(language, cold);
    assert.equal(stats.cacheHit, false);
    assert.equal(stats.sourceReadCoverage.status, 'qualified');
    for (const name of ['regular', 'enclosed', 'arrow', 'constructed', 'twoSites']) {
      assert.deepEqual(returnedTypes(cold.find(chunk => chunk.name === name)), new Set(['Widget']), `${language} ${name}`);
    }
    assert.deepEqual(returnedTypes(cold.find(chunk => chunk.name === 'argumentsOnly')), new Set(['Wrapped']),
      'a nested argument call does not supply the returned invocation result');
    for (const name of ['quoted', 'commented', 'templateText', 'templateExpression', 'regexText', 'resultRead', 'constructedRead', 'comparison', 'sequence',
      'bare', 'nested', 'nestedConstructor', 'laterCall', 'pending', 'awaited', 'generator', 'optional', 'unresolved']) {
      assert.equal(returnedTypes(cold.find(chunk => chunk.name === name)).size, 0, `${language} ${name} must not borrow a callee type`);
    }
    const warm = makeChunks(language);
    assert.equal((await run(language, warm)).cacheHit, true);
    assert.deepEqual(JSON.parse(JSON.stringify(warm)), JSON.parse(JSON.stringify(cold)), 'serialized replay preserves exact admitted and omitted facts');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('parser-owned JS/TS return invocation, exact occurrence and qualified replay controls passed');
