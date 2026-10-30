import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

// Authored actual downloader boundary using inert module hooks. Unrun; generated
// task-owned assets/receipts are fixtures, never real model readiness evidence.
const { dir } = await prepareIsolatedTestCacheDir('download-component-cleanup');
const shim = path.join(dir, 'components-shim.mjs'), calls = path.join(dir, 'component-calls.json');
const modelId = 'onnx-community/embeddinggemma-2-ONNX';
const source = `import fs from 'node:fs'; import path from 'node:path';
const mode=process.env.POC_COMPONENT_MODE, calls={model:0,tokenizer:0};
const save=()=>fs.writeFileSync(process.env.POC_COMPONENT_CALLS,JSON.stringify(calls));
const primary=Object.freeze(new Error('controlled metadata primary'));
const cleanup=Object.freeze(new Error('controlled unbranded component close'));
process.on('uncaughtExceptionMonitor',error=>{calls.failure={cause:error.cause===0?0:error.cause?.message,
pending:error.cacheOwnershipPending===true,cleanupCount:error.cleanupErrors?.[0]?.errors?.length};save();});
export const env={version:'4.3.2'}; export class EmbeddingGemma2Model {}
export const AutoConfig={from_pretrained:async()=>({model_type:'embedding_gemma2'})};
export const AutoTokenizer={from_pretrained:async()=>({dispose:async()=>{calls.tokenizer++;save();if(mode!=='success')throw cleanup;}})};
export const AutoModel={from_pretrained:async(model,options)=>{
const root=path.join(options.cache_dir,model,options.revision);fs.mkdirSync(path.join(root,'onnx'),{recursive:true});
for(const file of ['config.json','tokenizer.json','tokenizer_config.json'])fs.writeFileSync(path.join(root,file),'{}');
// A tiny protobuf ModelProto with an empty graph is sufficient for the asset
// closure parser. The inert adapter never opens an inference session.
fs.writeFileSync(path.join(root,'onnx/model.onnx'),Buffer.from([8,8,58,0]));
return {dispose:async()=>{calls.model++;save();if(mode!=='success')throw cleanup;}};}};
export const ModelRegistry={get_model_files:async()=>{if(mode==='primary')throw primary;if(mode==='falsey')throw 0;return ['config.json','tokenizer.json','tokenizer_config.json','onnx/model.onnx'];}};`;
await fs.writeFile(shim, [
  "import { registerHooks } from 'node:module';",
  `const source=${JSON.stringify(source)};`,
  "registerHooks({resolve(specifier,context,next){if(specifier==='@huggingface/transformers')return {url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true};return next(specifier,context);}});"
].join('\n'));
try {
  await fs.writeFile(path.join(dir, '.pairofcleats.json'), JSON.stringify({ models: { id: modelId }, indexing: { embeddings: { provider: 'xenova' } } }));
  for (const mode of ['success', 'primary', 'falsey']) {
    const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, `cache-${mode}`),
      extraEnv: { POC_COMPONENT_MODE: mode, POC_COMPONENT_CALLS: calls,
        PAIROFCLEATS_HOME: path.join(dir, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null } });
    const result = runNode(['--import', pathToFileURL(shim).href, path.resolve('tools/download/models.js'), '--repo', dir],
      'inert downloaded component cleanup', process.cwd(), env, { allowFailure: true, stdio: 'pipe', timeoutMs: 5000 });
    assert.equal(result.error, undefined); assert.equal(result.status, mode === 'success' ? 0 : 1);
    const recorded = JSON.parse(await fs.readFile(calls, 'utf8'));
    assert.equal(recorded.model, 1); assert.equal(recorded.tokenizer, 1, 'actual downloader releases independent tokenizer ownership');
    if (mode !== 'success') {
      assert.equal(recorded.failure.cause, mode === 'falsey' ? 0 : 'controlled metadata primary');
      assert.equal(recorded.failure.pending, true); assert.equal(recorded.failure.cleanupCount, 2);
    }
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Downloader component primary/independent cleanup controls authored; no execution or model qualification.');
