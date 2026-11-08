import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildTreeSitterSchedulerPlan } from '../../../src/index/build/tree-sitter-scheduler/plan.js';
import { executeTreeSitterSchedulerPlan } from '../../../src/index/build/tree-sitter-scheduler/executor.js';
import { createTreeSitterSchedulerLookup } from '../../../src/index/build/tree-sitter-scheduler/lookup.js';
import { createTokenClassificationRuntime,createTokenizationContext,tokenizeChunkText } from '../../../src/index/build/tokenization.js';

applyTestEnv({testing:'1'});
const root = await fs.mkdtemp(path.join(os.tmpdir(),'poc-scheduler-leaves-'));
try {
  const text = 'function whole(value) { return "hé😀" + 42 + value; }', sourcePath = path.join(root,'source.js');
  await fs.writeFile(sourcePath,text);
  for (const format of ['jsonl','binary-v1']) {
    const outDir = path.join(root,format), treeSitter = {enabled:true,strict:true,adaptive:false,chunkCache:false,scheduler:{format}};
    await fs.mkdir(outDir,{recursive:true});
    const runtime = {root,segmentsConfig:null,languageOptions:{treeSitter}};
    const planned = await buildTreeSitterSchedulerPlan({mode:'code',runtime,entries:[sourcePath],outDir,log:()=>{}});
    assert.ok(planned.groups.length > 0);
    const executed = await executeTreeSitterSchedulerPlan({mode:'code',runtime,groups:planned.groups,outDir,log:()=>{}});
    const lookup = createTreeSitterSchedulerLookup({outDir,index:executed.index});
    try {
      const chunks = await lookup.loadChunks([...executed.index.keys()][0]);
      const chunk = chunks.find(value => value.nativeClassificationLeaves);
      assert.ok(chunk,format + ' scheduler handoff preserves the native owner product');
      const context = createTokenizationContext({dictWords:new Set(),dictConfig:{},treeSitter,
        postingsConfig:{tokenClassification:{enabled:true}}});
      context.tokenClassificationRuntime = createTokenClassificationRuntime({context,fileBytes:Buffer.byteLength(text)});
      const result = tokenizeChunkText({text:text.slice(chunk.start,chunk.end),mode:'code',ext:'.js',languageId:'javascript',context,
        nativeClassificationLeaves:chunk.nativeClassificationLeaves});
      assert.equal(context.tokenClassificationRuntime.nativeLeafProductsReused,1);
      assert.ok(result.identifierTokens.includes('whole'));
      assert.ok(result.keywordTokens.includes('return'));
      assert.ok(result.literalTokens.includes('42'));
    } finally { await lookup.close(); }
  }
} finally { await fs.rm(root,{recursive:true,force:true}); }
console.log('actual scheduler plan/native owner/JSON-binary lookup/classification leaf handoff controls passed');
