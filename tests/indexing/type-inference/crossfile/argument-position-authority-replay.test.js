import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { sha1 } from '../../../../src/shared/hash.js';
import { parseJavaScriptAst, buildJsChunks, buildCodeRelations } from '../../../../src/lang/javascript.js';
import { extractDocMeta } from '../../../../src/lang/javascript/docmeta.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

applyTestEnv();
const names = Array.from({ length: 17 }, (_, i) => `p${i}`);
const text = `function many(${names.join(',')}) {} function pattern({first}, later) {}
  function unknown(a,b,c) {} function known(a,b,c) {} function rest(first,...values) {}
  function caller(items) {
    many(${Array.from({ length: 17 }, (_, i) => String(i)).join(',')});
    pattern({first:1}, "later"); unknown(...items, "tail"); known(...[1,2], "third"); rest(1,2,3);
  }`;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-argument-positions-'));
try {
  await fs.writeFile(path.join(root, 'slots.js'), text);
  for (const parser of ['acorn', 'babel']) {
    const ast = parseJavaScriptAst(text, { parser }), raw = buildJsChunks(text, { ast });
    const relations = buildCodeRelations(text, 'slots.js', { ast });
    const makeChunks = () => raw.map(chunk => ({ ...chunk, file: 'slots.js', lang: 'javascript',
      fileHash: sha1(text), fileHashAlgo: 'sha1', chunkUid: chunk.name,
      docmeta: extractDocMeta(text, chunk, relations),
      codeRelations: { callDetails: chunk.name === 'caller' ? structuredClone(relations.callDetails) : [] } }));
    const run = chunks => applyCrossFileInference({ rootDir: root, buildRoot: root, cacheRoot: path.join(root, parser),
      chunks, enabled: true, cacheEnabled: true, useTooling: false, enableTypeInference: true, enableRiskCorrelation: false, log: () => {} });
    const cold = makeChunks(); assert.equal((await run(cold)).cacheHit, false);
    const facts = name => cold.find(chunk => chunk.name === name).docmeta.inferredTypes?.params || {};
    assert.ok(facts('many').p16.some(row => row.type === 'number'), 'seventeenth formal/actual survives original preview caps');
    assert.equal(facts('pattern').first, undefined, 'destructured binding is not one flattened parameter');
    assert.ok(facts('pattern').later.some(row => row.type === 'string'));
    assert.deepEqual(Object.keys(facts('unknown')), [], 'post-spread actual cannot borrow a guessed formal');
    assert.ok(facts('known').c.some(row => row.type === 'string'));
    assert.ok(facts('rest').values.some(row => row.type === 'array'), 'rest receives an array rather than the first element type');
    const warm = makeChunks(); assert.equal((await run(warm)).cacheHit, true);
    assert.deepEqual(JSON.parse(JSON.stringify(warm)), JSON.parse(JSON.stringify(cold)));
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('runtime parameter slots preserve large arity, destructuring, known/unknown spreads and rest through cross-file replay');
