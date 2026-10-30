import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { sha1 } from '../../../../src/shared/hash.js';
import { parseJavaScriptAst, buildJsChunks, buildCodeRelations } from '../../../../src/lang/javascript.js';
import { buildCallIndex } from '../../../../src/index/build/file-processor/relations.js';
import { attachCallDetailsByChunkIndex } from '../../../../src/index/build/file-processor/process-chunks/dedupe.js';
import { buildChunkRelations } from '../../../../src/index/language-registry.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

applyTestEnv({ testing: '1' });
const sources = {
  'local.js': 'export function externalName() { return input; } export function localAlias() { return input; } export class LocalThing { static run() { return input; } }',
  'external.js': 'import { externalName } from "external-package"; function externalUse() { return externalName(); }',
  'missing.js': 'import { externalName } from "./absent.js"; function missingUse() { return externalName(); }',
  'namespace.js': 'import * as ns from "external-package"; function namespaceUse() { return ns.LocalThing.run(); }',
  'alias.js': 'import { externalName as localAlias } from "@configured/alias"; function aliasUse() { return localAlias(); }',
  'relative.js': 'import { externalName } from "./local.js"; function relativeUse() { return externalName(); }',
  'unimported.js': 'function unimportedUse() { return externalName(); }'
};
const declared = { externalName: 'Widget', localAlias: 'AliasNoise', 'LocalThing.run': 'RunNoise' };
const makeInput = () => {
  const chunks = [], fileRelations = new Map();
  for (const [file, text] of Object.entries(sources)) {
    const ast = parseJavaScriptAst(text, { ext: '.js' });
    const raw = buildJsChunks(text, { ext: '.js', ast });
    const relations = buildCodeRelations(text, file, { ext: '.js', ast });
    fileRelations.set(file, relations);
    const index = buildCallIndex(relations);
    attachCallDetailsByChunkIndex(index, raw);
    for (let chunkIndex = 0; chunkIndex < raw.length; chunkIndex += 1) {
      const entry = raw[chunkIndex], chunkUid = `${file}:${entry.name}`;
      chunks.push({ file, lang: 'javascript', fileHash: sha1(text), fileHashAlgo: 'sha1', chunkUid,
        name: entry.name, kind: entry.kind, start: entry.start, end: entry.end,
        metaV2: { symbol: { scheme: 'poc', qualifiedName: entry.name, symbolId: `symbol:${chunkUid}`,
          symbolKey: `key:${chunkUid}`, kindGroup: entry.name === 'LocalThing' ? 'class' : 'function' } },
        docmeta: declared[entry.name] ? { returnType: declared[entry.name] } : {},
        codeRelations: buildChunkRelations({ chunk: entry, fileRelations: relations, callIndex: index, chunkIndex }) });
    }
  }
  return { chunks, fileRelations };
};
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-import-boundary-'));
const run = input => applyCrossFileInference({ rootDir: root, buildRoot: root,
  cacheRoot: path.join(root, 'cache'), ...input, enabled: true, cacheEnabled: true, useTooling: false,
  enableTypeInference: true, enableRiskCorrelation: false, log: () => {} });
try {
  for (const [file, text] of Object.entries(sources)) await fs.writeFile(path.join(root, file), text);
  const cold = makeInput(), stats = await run(cold);
  assert.equal(stats.cacheHit, false);
  assert.equal(stats.sourceReadCoverage.status, 'qualified');
  for (const [name, module] of [['externalUse', 'external-package'], ['missingUse', './absent.js'],
    ['namespaceUse', 'external-package'], ['aliasUse', '@configured/alias']]) {
    const chunk = cold.chunks.find(entry => entry.name === name), summary = chunk.codeRelations.callSummaries[0];
    assert.equal(summary.calleeRef.status, 'unresolved', name);
    assert.deepEqual(summary.calleeRef.candidates, [], 'an unavailable module admits no repository-global fallback candidates');
    assert.equal(summary.calleeRef.importHint.moduleSpecifier, module);
    assert.equal(summary.calleeRef.importHint.resolvedFile, null);
    assert.equal(summary.targetChunkUid, undefined);
    assert.deepEqual(chunk.docmeta.inferredTypes?.returns || [], [], `${name} cannot borrow a local declaration type`);
  }
  for (const name of ['relativeUse', 'unimportedUse']) {
    const chunk = cold.chunks.find(entry => entry.name === name), summary = chunk.codeRelations.callSummaries[0];
    assert.equal(summary.calleeRef.status, 'resolved', name);
    assert.equal(summary.targetChunkUid, 'local.js:externalName');
    assert.deepEqual(chunk.docmeta.inferredTypes.returns.map(row => row.type), ['Widget']);
  }
  const warm = makeInput();
  assert.equal((await run(warm)).cacheHit, true);
  assert.deepEqual(JSON.parse(JSON.stringify(warm.chunks)), JSON.parse(JSON.stringify(cold.chunks)),
    'qualified replay preserves known unavailable module boundaries and supported local routes');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('cross-file known import module barriers and source-qualified return replay controls passed');
