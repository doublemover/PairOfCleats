import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { sha1 } from '../../../../src/shared/hash.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';
import { parseJavaScriptAst, buildJsChunks, buildCodeRelations } from '../../../../src/lang/javascript.js';
import { buildCallIndex } from '../../../../src/index/build/file-processor/relations.js';
import { buildChunkRelations } from '../../../../src/index/language-registry.js';

applyTestEnv({ testing: '1' });
const cases = [
  ['wholeString', '"ok"', 'string'], ['stringComparison', '"ok" === input', null],
  ['wholeArray', '[1]', 'array'], ['arrayRead', '[1][0]', null],
  ['wholeObject', '{ key: 1 }', 'object'], ['objectRead', '{ key: 1 }.key', null],
  ['wholeConstructor', 'new Widget()', 'Widget'], ['constructorRead', 'new Widget().field', null],
  ['caseBinding', 'TRUE', null], ['literalBoolean', 'true', 'boolean'],
  ['wholeUnicodeConstructor', 'new 模块.类()', '模块.类']
];
const calleeText = `export function sinkFn(${cases.map(([name]) => name).join(', ')}) { return wholeString; }`;
const callerText = `export function caller(input) { sinkFn(${cases.map(([, value]) => value).join(', ')}); }`;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-crossfile-literal-'));
const makeChunks = () => [['callee.js', calleeText], ['caller.js', callerText]].flatMap(([file, text]) => {
  const ast = parseJavaScriptAst(text, { ext: '.js' });
  assert.ok(ast && !ast.errors?.length);
  const relations = buildCodeRelations(text, file, { ext: '.js', ast });
  const callIndex = buildCallIndex(relations);
  return buildJsChunks(text, { ext: '.js', ast }).map(entry => {
    const chunkUid = `literal:${entry.name}`;
    return { ...entry, file, fileHash: sha1(text), fileHashAlgo: 'sha1', chunkUid,
      metaV2: { symbol: { scheme: 'poc', qualifiedName: entry.name,
        symbolId: `symbol:${chunkUid}`, symbolKey: `key:${chunkUid}`, kindGroup: 'function' } },
      docmeta: { ...relations.functionMeta[entry.name] },
      codeRelations: buildChunkRelations({ chunk: entry, fileRelations: relations, callIndex }) };
  });
});
const run = chunks => applyCrossFileInference({ rootDir: root, buildRoot: root,
  cacheRoot: path.join(root, 'cache'), chunks, enabled: true, cacheEnabled: true,
  useTooling: false, enableTypeInference: true, enableRiskCorrelation: false, log: () => {} });
try {
  await fs.writeFile(path.join(root, 'callee.js'), calleeText);
  await fs.writeFile(path.join(root, 'caller.js'), callerText);
  const cold = makeChunks(), coldStats = await run(cold);
  assert.equal(coldStats.cacheHit, false);
  assert.equal(coldStats.sourceReadCoverage.status, 'qualified');
  assert.ok(coldStats.linkedCallSummaries >= 1);
  const inferred = cold[0].docmeta.inferredTypes.params;
  for (const [name, , expected] of cases) {
    if (expected === null) assert.equal(Object.hasOwn(inferred, name), false, `no prefix fact may reach ${name}`);
    else assert.ok(inferred[name].some(entry => entry.type === expected && entry.source === 'flow'), `expected complete argument fact for ${name}`);
  }
  const summary = cold[1].codeRelations.callSummaries[0];
  assert.equal(summary.args[1], '...', 'the legacy argument projection remains a conservative summary');
  assert.equal(summary.arguments.slots[1].preview, '"ok" === input',
    'the canonical parser argument preserves unsupported expression evidence');
  assert.equal(summary.arguments.slots[1].literalType, null, 'a comparison is not a string literal');
  const warm = makeChunks(), warmStats = await run(warm);
  assert.equal(warmStats.cacheHit, true);
  assert.deepEqual(JSON.parse(JSON.stringify(warm)), JSON.parse(JSON.stringify(cold)),
    'source-qualified output replay preserves exact admitted and omitted parameter facts across serialized map prototypes');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('cross-file argument complete-expression propagation and qualified replay controls passed');
