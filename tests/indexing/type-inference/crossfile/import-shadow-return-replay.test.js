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
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

applyTestEnv({ testing: '1' });
const main = [
  'import { factory } from "./lib";',
  'import * as ns from "./lib";',
  'function plain() { return factory(); }',
  'function namespacePlain() { return ns.factory(); }',
  'function parameter(factory) { return factory(); }',
  'function namespaceParameter(ns) { return ns.factory(); }',
  'function constructorParameter(factory) { return new factory(); }',
  'function block() { { let factory = input; return factory(); } }',
  'function localFunction() { function factory() { return 0; } return factory(); }',
  'function mixed(flag) { factory(); { let factory = input; if (flag) return factory(); } return factory(); }'
].join('\n');
const library = 'export function factory() { return input; }';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-import-shadow-'));
const makeInput = language => {
  const chunks = [], fileRelations = new Map(), ext = language === 'typescript' ? '.ts' : '.js';
  for (const [file, text] of [[`main${ext}`, main], [`lib${ext}`, library]]) {
    let raw, relations;
    if (language === 'typescript') {
      const context = createTypeScriptSyntaxContext(), options = { ext, typeScriptSyntaxContext: context };
      raw = buildTypeScriptChunksFromBabel(text, options);
      relations = buildTypeScriptRelations(text, raw, options);
      assert.equal(context.babelParses, 1, 'lexical proof borrows the existing Babel scope traversal and syntax context');
    } else {
      const ast = parseJavaScriptAst(text, { ext });
      raw = buildJsChunks(text, { ext, ast });
      relations = buildCodeRelations(text, file, { ext, ast });
    }
    const filtered = filterRawRelationsWithLexicon(relations, { languageId: language, relKey: file });
    fileRelations.set(file, filtered);
    const index = buildCallIndex(filtered);
    attachCallDetailsByChunkIndex(index, raw);
    for (let chunkIndex = 0; chunkIndex < raw.length; chunkIndex += 1) {
      const entry = raw[chunkIndex], chunkUid = `${language}:${file}:${entry.name}`;
      chunks.push({ file, lang: language, fileHash: sha1(text), fileHashAlgo: 'sha1', chunkUid,
        name: entry.name, kind: entry.kind, start: entry.start, end: entry.end,
        metaV2: { symbol: { scheme: 'poc', qualifiedName: entry.name, symbolId: `symbol:${chunkUid}`,
          symbolKey: `key:${chunkUid}`, kindGroup: 'function' } },
        docmeta: entry.name === 'factory' ? { returnType: 'Widget' } : {},
        codeRelations: buildChunkRelations({ chunk: entry, fileRelations: filtered, callIndex: index, chunkIndex }) });
    }
  }
  return { chunks, fileRelations };
};
const run = (language, input) => applyCrossFileInference({ rootDir: root, buildRoot: root,
  cacheRoot: path.join(root, language), ...input, enabled: true, cacheEnabled: true, useTooling: false,
  enableTypeInference: true, enableRiskCorrelation: false, log: () => {} });
try {
  for (const ext of ['.js', '.ts']) {
    await fs.writeFile(path.join(root, `main${ext}`), main);
    await fs.writeFile(path.join(root, `lib${ext}`), library);
  }
  for (const language of ['javascript', 'typescript']) {
    const cold = makeInput(language);
    for (const name of ['parameter', 'namespaceParameter', 'constructorParameter', 'block', 'localFunction']) {
      const chunk = cold.chunks.find(entry => entry.name === name);
      const detail = chunk.codeRelations.callDetails.find(entry => entry.callee === (name === 'namespaceParameter' ? 'ns.factory' : 'factory'));
      assert.equal(detail.lexicalBinding.shadowsImport, true, `${language} ${name}`);
      assert.equal(detail.lexicalBinding.kind, 'local');
      assert.ok(Object.isFrozen(detail.lexicalBinding));
    }
    const stats = await run(language, cold);
    assert.equal(stats.cacheHit, false);
    assert.equal(stats.sourceReadCoverage.status, 'qualified');
    for (const name of ['parameter', 'namespaceParameter', 'constructorParameter', 'block', 'localFunction']) {
      const chunk = cold.chunks.find(entry => entry.name === name);
      assert.deepEqual(chunk.docmeta.inferredTypes?.returns || [], [], `${language} ${name} cannot borrow imported return/nominal facts`);
      assert.ok(chunk.codeRelations.callSummaries.length > 0, 'unresolved occurrences remain visible');
      assert.ok(chunk.codeRelations.callSummaries.every(summary => summary.resolution === 'unresolved'
        && summary.reason === 'lexical-import-shadow' && summary.targetChunkUid === undefined));
      assert.ok((chunk.codeRelations.callLinks || []).every(link => link.to.status === 'unresolved'),
        'name-only call links must not retain the shadowed import target');
      if (name !== 'constructorParameter') assert.ok(chunk.codeRelations.callLinks.length > 0);
    }
    for (const name of ['plain', 'namespacePlain', 'mixed']) {
      const chunk = cold.chunks.find(entry => entry.name === name);
      assert.deepEqual(chunk.docmeta.inferredTypes.returns.map(row => row.type), ['Widget'], `${language} ${name}`);
    }
    const mixed = cold.chunks.find(entry => entry.name === 'mixed');
    assert.equal(mixed.codeRelations.callSummaries.filter(summary => summary.resolution === 'resolved').length, 2);
    assert.equal(mixed.codeRelations.callSummaries.filter(summary => summary.reason === 'lexical-import-shadow').length, 1);
    assert.ok(mixed.codeRelations.callLinks.some(link => link.to.status === 'resolved'),
      'an actual unshadowed import occurrence can still witness an aggregate call link');
    const warm = makeInput(language);
    assert.equal((await run(language, warm)).cacheHit, true);
    assert.deepEqual(JSON.parse(JSON.stringify(warm.chunks)), JSON.parse(JSON.stringify(cold.chunks)),
      'qualified replay preserves per-occurrence lexical shadow decisions and supported returns');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('JS/TS parser lexical import shadows, actual return consumers and qualified replay controls passed');
