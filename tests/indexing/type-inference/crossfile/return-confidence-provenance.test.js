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
import { runCrossFilePropagation } from '../../../../src/index/type-inference-crossfile/propagation.js';
import { buildMetaV2 } from '../../../../src/index/metadata-v2.js';
import { extractReturnTypeFacts } from '../../../../src/index/type-inference-crossfile/extract.js';

applyTestEnv({ testing: '1' });
const seeds = ['weak', 'strong', 'zero', 'missing', 'declared', 'independent'];
const sources = {
  'returns.js': seeds.map(name => `export function ${name}() { return input; }`).join('\n') + '\n'
    + seeds.map(name => `export function same_${name}() { return ${name}(); }`).join('\n')
    + '\nexport function cycleA() { return cycleB(); }\nexport function cycleB() { return cycleA(); }',
  'forward.js': `import { ${seeds.join(', ')} } from './returns.js';\n`
    + seeds.map(name => `export function cross_${name}() { return ${name}(); }`).join('\n')
};
const inputFor = () => {
  const chunks = [], fileRelations = new Map();
  for (const [file, text] of Object.entries(sources)) {
    const ast = parseJavaScriptAst(text, { ext: '.js' });
    const raw = buildJsChunks(text, { ext: '.js', ast });
    const relations = buildCodeRelations(text, file, { ext: '.js', ast });
    fileRelations.set(file, relations);
    const index = buildCallIndex(relations); attachCallDetailsByChunkIndex(index, raw);
    for (const [chunkIndex, entry] of raw.entries()) {
      let docmeta = {};
      if (['weak', 'strong', 'zero', 'missing'].includes(entry.name)) {
        const confidence = { weak: 0.01, strong: 0.95, zero: 0 }[entry.name];
        docmeta = { inferredTypes: { returns: [{ type: 'Secret', source: 'flow',
          ...(confidence === undefined ? {} : { confidence }) }] } };
      }
      if (entry.name === 'declared') docmeta = { returnType: 'Declared' };
      if (entry.name === 'independent') docmeta = { inferredTypes: { returns: [
        { type: 'Shared', source: 'flow', confidence: 0.1 },
        { type: 'Shared', source: 'tooling', confidence: 0.9 }
      ] } };
      const chunkUid = `${file}:${entry.name}`;
      chunks.push({ file, lang: 'javascript', fileHash: sha1(text), fileHashAlgo: 'sha1', chunkUid,
        name: entry.name, kind: entry.kind, start: entry.start, end: entry.end, docmeta,
        metaV2: { symbol: { scheme: 'poc', qualifiedName: entry.name, symbolId: `symbol:${chunkUid}`,
          symbolKey: `key:${chunkUid}`, kindGroup: 'function' } },
        codeRelations: buildChunkRelations({ chunk: entry, fileRelations: relations, callIndex: index, chunkIndex }) });
    }
  }
  return { chunks, fileRelations };
};
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-return-confidence-'));
const run = input => applyCrossFileInference({ rootDir: root, buildRoot: root,
  cacheRoot: path.join(root, 'cache'), ...input, enabled: true, cacheEnabled: true,
  useTooling: false, enableTypeInference: true, enableRiskCorrelation: false });
const snapshot = chunks => JSON.parse(JSON.stringify([...chunks].sort((a, b) => a.chunkUid.localeCompare(b.chunkUid))));
const check = input => {
  for (const prefix of ['same', 'cross']) for (const name of seeds) {
    const caller = input.chunks.find(chunk => chunk.name === `${prefix}_${name}`);
    const values = caller.docmeta.inferredTypes?.returns || [];
    const local = prefix === 'same' ? 0.55 : 0.55 * 0.85;
    assert.equal(values.length, name === 'independent' ? 2 : 1, caller.name);
    const expected = { weak: [0.01], strong: [local], zero: [0], missing: [null], declared: [null], independent: [0.1, local] }[name];
    assert.deepEqual(values.map(value => value.confidence), expected, caller.name);
    for (const value of values) {
      const evidence = value.evidence.returnPropagation;
      assert.equal(evidence.schemaVersion, 1);
      assert.equal(evidence.basis, 'minimum-support-and-local-hop');
      assert.equal(evidence.localConfidence, local);
      assert.equal(evidence.origin.chunkUid, `returns.js:${name}`);
      assert.equal(evidence.origin.file, 'returns.js');
      assert.equal(evidence.via.chunkUid, `returns.js:${name}`);
      if (name === 'weak') assert.equal(evidence.sourceConfidence, 0.01);
      if (name === 'zero') assert.equal(evidence.sourceConfidence, 0);
      if (name === 'missing' || name === 'declared') assert.equal(evidence.sourceConfidence, null);
    }
    const meta = buildMetaV2({ chunk: caller, docmeta: caller.docmeta });
    assert.deepEqual(meta.types.inferred.returns.map(value => value.evidence), values.map(value => value.evidence),
      'the real canonical metadata writer retains score basis and origin');
    if (caller.codeRelations.callSummaries?.length) {
      assert.ok(caller.codeRelations.callSummaries[0].returnTypeFacts.length > 0);
      assert.ok(caller.codeRelations.callSummaries[0].returnTypes.length > 0, 'legacy string summary remains available');
    }
  }
  for (const name of ['cycleA', 'cycleB']) assert.deepEqual(
    input.chunks.find(chunk => chunk.name === name).docmeta.inferredTypes?.returns || [], [],
    'an unseeded recursive cycle invents no type evidence');
};
try {
  for (const [file, text] of Object.entries(sources)) await fs.writeFile(path.join(root, file), text);
  const cold = inputFor(), stats = await run(cold);
  assert.equal(stats.cacheHit, false); assert.equal(stats.sourceReadCoverage.status, 'qualified'); check(cold);
  const warm = inputFor(); assert.equal((await run(warm)).cacheHit, true); check(warm);
  assert.deepEqual(snapshot(warm.chunks), snapshot(cold.chunks), 'serialized replay keeps exact scored and unscored supports');
  const reverse = inputFor(); reverse.chunks.reverse();
  await runCrossFilePropagation({ rootDir: root, ...reverse }); check(reverse);
  assert.deepEqual(snapshot(reverse.chunks), snapshot(cold.chunks), 'input order cannot change origin support');
  const before = snapshot(cold.chunks);
  await runCrossFilePropagation({ rootDir: root, ...cold }); check(cold);
  assert.deepEqual(snapshot(cold.chunks), before, 'repeated invocation preserves the basis without duplicate supports');
  const legacy = inputFor();
  for (const chunk of legacy.chunks) { chunk.lang = 'fixture'; delete chunk.codeRelations.callDetails; }
  await runCrossFilePropagation({ rootDir: root, ...legacy }); check(legacy);
  const facts = extractReturnTypeFacts(cold.chunks.find(chunk => chunk.name === 'same_weak'));
  assert.equal(facts[0].origin.chunkUid, 'returns.js:weak');
  assert.equal(facts[0].origin.confidence, 0.01, 'a propagated fact never becomes a freshly scored seed');
  assert.ok(Object.isFrozen(facts) && Object.isFrozen(facts[0]) && Object.isFrozen(facts[0].origin));
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Cross-file return scores retain origin, explicit zero/unknown and replay fidelity');
