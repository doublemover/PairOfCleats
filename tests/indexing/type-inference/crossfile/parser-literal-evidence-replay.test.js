import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { sha1 } from '../../../../src/shared/hash.js';
import { parseJavaScriptAst, getJavaScriptSyntaxIdentity } from '../../../../src/lang/javascript/parse.js';
import { buildCodeRelations } from '../../../../src/lang/javascript/relations.js';
import { buildTypeScriptRelations } from '../../../../src/lang/typescript/relations.js';
import { createTypeScriptSyntaxContext } from '../../../../src/lang/typescript/syntax-context.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

applyTestEnv({ testing: '1' });
const cases = [['90071992547409931234567890n', 'bigint'], ['1e400', 'number'], ['null', 'null'],
  ['false', 'boolean'], ['"a b"', 'string'], ['/x/', null], ['-2', 'number'], ['1_000', 'number']];
const calleeText = cases.map((_, index) => `export function sink${index}(value) {}`).join('\n');
const callerText = `import { ${cases.map((_, index) => `sink${index}`).join(', ')} } from './callee.js';\n`
  + `export function caller() { ${cases.map(([value], index) => `sink${index}(${value});`).join(' ')} }`;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-parser-literals-'));
try {
  await fs.writeFile(path.join(root, 'callee.js'), calleeText);
  for (const parser of ['acorn', 'babel', 'typescript']) {
    const ext = parser === 'typescript' ? '.ts' : '.js', callerFile = `caller${ext}`;
    await fs.writeFile(path.join(root, callerFile), callerText);
    let relations;
    if (parser === 'typescript') {
      const context = createTypeScriptSyntaxContext();
      relations = buildTypeScriptRelations(callerText, null, { ext, typescript: { parser: 'babel' }, typeScriptSyntaxContext: context });
      assert.equal(context.babelParses, 1);
    } else {
      const ast = parseJavaScriptAst(callerText, { parser });
      assert.equal(getJavaScriptSyntaxIdentity(ast)?.family, parser);
      relations = buildCodeRelations(callerText, callerFile, { ast });
    }
    const makeChunks = () => [
      ...cases.map((_, index) => ({ file: 'callee.js', fileHash: sha1(calleeText), fileHashAlgo: 'sha1',
        chunkUid: `callee:${index}`, name: `sink${index}`, kind: 'function', start: calleeText.indexOf(`export function sink${index}`),
        end: calleeText.indexOf('}', calleeText.indexOf(`export function sink${index}`)) + 1,
        docmeta: { paramNames: ['value'], exported: true, exportNames: [`sink${index}`] }, codeRelations: {} })),
      { file: callerFile, fileHash: sha1(callerText), fileHashAlgo: 'sha1', chunkUid: 'caller', name: 'caller', kind: 'function',
        start: 0, end: callerText.length, docmeta: {}, codeRelations: structuredClone(relations) }
    ];
    const run = chunks => applyCrossFileInference({ rootDir: root, buildRoot: root, cacheRoot: path.join(root, parser),
      chunks, enabled: true, cacheEnabled: true, useTooling: false, enableTypeInference: true, enableRiskCorrelation: false, log: () => {} });
    const cold = makeChunks(), stats = await run(cold); assert.equal(stats.cacheHit, false);
    for (let index = 0; index < cases.length; index++) {
      const types = cold[index].docmeta.inferredTypes?.params?.value?.map(entry => entry.type) || [];
      assert.deepEqual(types, cases[index][1] ? [cases[index][1]] : [], `typed evidence for ${parser}/${cases[index][0]}`);
    }
    const warm = makeChunks(); assert.equal((await run(warm)).cacheHit, true);
    assert.deepEqual(JSON.parse(JSON.stringify(warm)), JSON.parse(JSON.stringify(cold)));
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('actual JS/TS literal evidence survives cross-file inference and qualified cold/warm replay');
