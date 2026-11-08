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
  'lib.js': 'export class Beta { static run() { return input; } } export function helper() { return input; }',
  'default.js': 'export default function makeDefault() { return input; } export function unrelated() { return input; }',
  'named-member.js': 'import { Beta as Local } from "./lib.js"; function namedMember() { return Local.run(); }',
  'named-missing.js': 'import { Beta as Local } from "./lib.js"; function namedMissing() { return Local.missing(); }',
  'namespace-member.js': 'import * as ns from "./lib.js"; function namespaceMember() { return ns.Beta.run(); }',
  'namespace-missing.js': 'import * as ns from "./lib.js"; function namespaceMissing() { return ns.missing(); }',
  'namespace-call.js': 'import * as ns from "./lib.js"; function namespaceCall() { return ns(); }',
  'default-call.js': 'import Local from "./default.js"; function defaultCall() { return Local(); }',
  'default-missing.js': 'import Local from "./default.js"; function defaultMissing() { return Local.missing(); }',
  'namespace-default.js': 'import * as ns from "./default.js"; function namespaceDefault() { return ns.default(); }'
};
const declared = { 'Beta.run': 'Widget', helper: 'HelperValue', makeDefault: 'DefaultValue', unrelated: 'Noise' };
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
          symbolKey: `key:${chunkUid}`, kindGroup: entry.name === 'Beta' ? 'class' : 'function' } },
        docmeta: declared[entry.name] ? { returnType: declared[entry.name] } : {},
        codeRelations: buildChunkRelations({ chunk: entry, fileRelations: relations, callIndex: index, chunkIndex }) });
    }
  }
  return { chunks, fileRelations };
};
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-import-members-'));
const run = input => applyCrossFileInference({ rootDir: root, buildRoot: root,
  cacheRoot: path.join(root, 'cache'), ...input, enabled: true, cacheEnabled: true, useTooling: false,
  enableTypeInference: true, enableRiskCorrelation: false, log: () => {} });
try {
  for (const [file, text] of Object.entries(sources)) await fs.writeFile(path.join(root, file), text);
  const cold = makeInput(), stats = await run(cold);
  assert.equal(stats.cacheHit, false);
  assert.equal(stats.sourceReadCoverage.status, 'qualified');
  for (const [name, target, type] of [
    ['namedMember', 'lib.js:Beta.run', 'Widget'],
    ['namespaceMember', 'lib.js:Beta.run', 'Widget'],
    ['defaultCall', 'default.js:makeDefault', 'DefaultValue'],
    ['namespaceDefault', 'default.js:makeDefault', 'DefaultValue']
  ]) {
    const chunk = cold.chunks.find(entry => entry.name === name), summary = chunk.codeRelations.callSummaries[0];
    assert.equal(summary.calleeRef.status, 'resolved', name);
    assert.equal(summary.targetChunkUid, target, name);
    assert.deepEqual((chunk.docmeta.inferredTypes?.returns || []).map(row => row.type), [type], name);
  }
  for (const name of ['namedMissing', 'namespaceMissing', 'namespaceCall', 'defaultMissing']) {
    const chunk = cold.chunks.find(entry => entry.name === name), summary = chunk.codeRelations.callSummaries[0];
    assert.equal(summary.calleeRef.status, 'unresolved', `${name} cannot resolve a different file-local declaration`);
    assert.equal(summary.targetChunkUid, undefined);
    assert.deepEqual(chunk.docmeta.inferredTypes?.returns || [], [], `${name} cannot inherit a class/default/unrelated return type`);
  }
  const warm = makeInput();
  assert.equal((await run(warm)).cacheHit, true);
  assert.deepEqual(JSON.parse(JSON.stringify(warm.chunks)), JSON.parse(JSON.stringify(cold.chunks)),
    'serialized replay preserves import-member targets and rejected candidates');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('cross-file named/namespace/default import member targets and actual return replay controls passed');
