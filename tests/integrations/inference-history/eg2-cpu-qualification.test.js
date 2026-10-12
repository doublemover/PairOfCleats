import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { encodeField as f, decodeFields, inspectOnnx, writeNbitsDerivative, withinTrialRoot } from '../../../tools/history/eg2-qualify-graph.js';
import { qualifyRetrieval, summarizeOrtProfile } from '../../../tools/history/eg2-qualify-quality.js';
import { main, validateTrialIdentity, appendTrialReceipt } from '../../../tools/history/eg2-qualify.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const join=parts=>Buffer.concat(parts);
const attribute=(name,value)=>f(5,2,join([f(1,2,name),f(3,0,value),f(20,0,2)]));
const nbits=(bits,level)=>f(1,2,join([f(3,2,'weight_mm'),f(4,2,'MatMulNBits'),f(7,2,'com.microsoft'),
  attribute('bits',bits),attribute('block_size',32),...(level===undefined?[]:[attribute('accuracy_level',level)]),f(99,2,'unknown-preserved')]));
const external=f(5,2,join([f(8,2,'weight'),f(13,2,join([f(1,2,'location'),f(2,2,'model.onnx_data')])),f(14,0,1)]));
const model=bits=>join([f(1,0,10),f(7,2,join([nbits(bits),external])),f(100,2,'model-unknown')]);
const inspected=inspectOnnx(model(8)).report;
assert.equal(inspected.nodes,1);assert.equal(inspected.nbits[0].accuracyLevel,null);assert.equal(inspected.nbits[0].defaultAccuracyLevel,0);
assert.equal(inspected.operators['com.microsoft::MatMulNBits'],1);
const patched=inspectOnnx(model(8),{patchAccuracyLevel:true});
const reread=inspectOnnx(patched.bytes).report;
assert.equal(reread.nbits[0].accuracyLevel,4);assert.deepEqual(reread.externalData,inspected.externalData);
assert.ok(patched.bytes.includes(Buffer.from('unknown-preserved')));assert.ok(patched.bytes.includes(Buffer.from('model-unknown')));
assert.equal(inspectOnnx(inspectOnnx(patched.bytes,{patchAccuracyLevel:true}).bytes).report.nbits.length,1);
assert.equal(inspectOnnx(model(4),{patchAccuracyLevel:true}).report.patchedNodes,1);
assert.throws(()=>inspectOnnx(model(2),{patchAccuracyLevel:true}),/W4\/W8/);
for(const malformed of [Buffer.from([0]),Buffer.from([10,5,1]),Buffer.from([9,1]),Buffer.alloc(11,128)])assert.throws(()=>decodeFields(malformed));
assert.throws(()=>inspectOnnx(f(1,0,2)),/exactly one/);

const base=process.env.PAIROFCLEATS_ARCHIVE_DISCOVERY_TEST_DIR??path.resolve('temp/tasks/eg2-cpu-qualification-tests');
await fs.mkdir(base,{recursive:true});
const root=await fs.realpath(await fs.mkdtemp(path.join(base,'qualification-')));
const source=path.join(root,'model_quantized.onnx'),destination=path.join(root,'model_w8a8.onnx');
await fs.writeFile(source,model(8));
const weights=Buffer.from('fixture external bytes, not model weights');
await fs.writeFile(path.join(root,'model.onnx_data'),weights);
const receipt=await writeNbitsDerivative({source,destination,trialRoot:root,expectedSha256:sha(model(8)),
  expectedExternalData:[{location:'model.onnx_data',bytes:weights.length,sha256:sha(weights)}]});
assert.equal(receipt.patchedNodes,1);assert.equal(await fs.readFile(source).then(sha),sha(model(8)));
assert.equal(await fs.readFile(path.join(root,'model.onnx_data')).then(sha),sha(weights));
await assert.rejects(writeNbitsDerivative({source,destination:source,trialRoot:root,expectedSha256:sha(model(8)),expectedExternalData:[]}),/new filename/);
await assert.rejects(writeNbitsDerivative({source,destination:path.join(root,'bad.onnx'),trialRoot:root,expectedSha256:'a'.repeat(64),expectedExternalData:[]}),/hash mismatch/);
await assert.rejects(writeNbitsDerivative({source,destination:path.join(root,'missing-weights.onnx'),trialRoot:root,expectedSha256:sha(model(8)),expectedExternalData:[]}),/verified/);
await assert.rejects(withinTrialRoot(path.join(root,'..','outside.json'),root),/inside/);
await assert.rejects(writeNbitsDerivative({source,destination,trialRoot:root,expectedSha256:sha(model(8)),
  expectedExternalData:[{location:'model.onnx_data',bytes:weights.length,sha256:sha(weights)}]}),/EEXIST/);

// These deterministic fixtures qualify metric/coverage logic, not real EG2 quality.
const docs=[{id:'rocket',vector:[1,0]},{id:'garden',vector:[0,1]},{id:'mixed',vector:[.8,.6]}];
const queries=[{id:'space',vector:[1,0]}];
const input={k:2,reference:{documents:docs,queries},candidate:{documents:docs,queries},judgments:{space:{rocket:3,mixed:1,garden:0}}};
const quality=qualifyRetrieval(input);
assert.equal(quality.meanOverlapAtK,1);assert.equal(quality.candidateMetrics.recallAtK,1);
assert.equal(quality.candidateMetrics.mrrAtK,1);assert.equal(quality.candidateMetrics.ndcgAtK,1);assert.equal(quality.documentCosineDrift.max,0);
const worse=qualifyRetrieval({...input,candidate:{documents:docs,queries:[{id:'space',vector:[0,1]}]}});
assert.equal(worse.candidateMetrics.mrrAtK,.5);assert.equal(worse.candidateMetrics.recallAtK,.5);
assert.ok(worse.candidateMetrics.ndcgAtK<1);assert.equal(worse.meanOverlapAtK,.5);
assert.equal(qualifyRetrieval({...input,judgments:{}}).candidateMetrics,null);
assert.throws(()=>qualifyRetrieval({...input,candidate:{documents:docs.slice(1),queries}}),/coverage/);
assert.throws(()=>qualifyRetrieval({...input,candidate:{documents:[{id:'rocket',vector:[NaN,0]}],queries}}),/Finite/);
assert.throws(()=>qualifyRetrieval({...input,candidate:{documents:docs,queries:[{id:'space',vector:[0,0]}]}}),/norm/);
const profile=summarizeOrtProfile([{cat:'Node',dur:5,args:{op_name:'MatMulNBits',provider:'CPUExecutionProvider'}},
  {cat:'Node',dur:2,args:{op_name:'MatMulNBits',provider:'CPUExecutionProvider'}},{cat:'Session',dur:100}],
'MatMulNBits unpacked fallback diagnostic\nunrelated');
assert.equal(profile.nodeDurationUs,7);assert.equal(profile.operators[0].calls,2);assert.equal(profile.fallbackMessages.length,1);

const identity={provider:'cpu',modelRevision:'a'.repeat(40),modelSha256:'b'.repeat(64),tokenizerSha256:'c'.repeat(64),
  graphSha256:'d'.repeat(64),runtimeVersion:'fixture-only',dtype:'fp32',documentPrefix:'title: none | text: ',
  queryPrefix:'task: search result | query: ',chunkerIdentity:'fixture',dimensions:2,maxLength:8192};
assert.equal(validateTrialIdentity(identity),identity);
assert.throws(()=>validateTrialIdentity({...identity,provider:'dml'}),/CPU/);
const trial=path.join(root,'trial');
await main(['init','--trial-root',trial,'--identity',JSON.stringify(identity)]);
await appendTrialReceipt(trial,{fixture:true});
const db=new Database(path.join(trial,'qualification.sqlite'),{readonly:true});
assert.equal(db.prepare('SELECT count(*) n FROM cpu_qualification_runs').get().n,1);db.close();
await assert.rejects(main(['init','--trial-root',trial,'--identity',JSON.stringify(identity)]),/EEXIST/);
const foreign=path.join(root,'foreign');await fs.mkdir(foreign);
await fs.copyFile(path.join(trial,'trial-manifest.json'),path.join(foreign,'trial-manifest.json'));
const live=new Database(path.join(foreign,'qualification.sqlite'));live.exec('CREATE TABLE history_embedding_spans(x)');live.close();
await assert.rejects(appendTrialReceipt(foreign,{fixture:true}),/non-trial/);
console.log('eg2-cpu-qualification fixtures passed; no native inference or graph download');

const {runCpuTrial,validateTrialSamples}=await import('../../../tools/history/eg2-qualify-run.js');
const executionRoot=path.join(root,'execution');
const cpuIdentity={...identity,dimensions:768,dtype:'w8a8-nbits-level4',runtimeVersion:'transformers.js@4.3.1/onnxruntime-node@1.30.0',
  modelSha256:sha(weights),graphSha256:sha(patched.bytes)};
await main(['init','--trial-root',executionRoot,'--identity',JSON.stringify(cpuIdentity)]);
const modelRoot=path.join(executionRoot,'model');await fs.mkdir(path.join(modelRoot,'onnx'),{recursive:true});
await fs.writeFile(path.join(modelRoot,'onnx','model_w8a8.onnx'),patched.bytes);
await fs.writeFile(path.join(modelRoot,'onnx','model.onnx_data'),weights);
for(const name of ['config.json','tokenizer.json','tokenizer_config.json'])await fs.writeFile(path.join(modelRoot,name),'{}');
cpuIdentity.tokenizerSha256=sha(Buffer.from('{}'));
await fs.writeFile(path.join(executionRoot,'trial-manifest.json'),JSON.stringify({schema:'eg2.cpu-trial.v1',identity:cpuIdentity}));
const sampleVector=Array(768).fill(0);sampleVector[0]=1;
const pilotSamples={documents:[{id:'d',text:'fixture'}],queries:[{id:'q',text:'question'}],k:1,judgments:{q:{d:1}},
  reference:{identity:{...cpuIdentity,dtype:'fp32'},documents:[{id:'d',effectiveInput:cpuIdentity.documentPrefix+'fixture',vector:sampleVector}],
    queries:[{id:'q',effectiveInput:cpuIdentity.queryPrefix+'question',vector:sampleVector}]}};
validateTrialSamples(pilotSamples,cpuIdentity);
assert.throws(()=>validateTrialSamples({...pilotSamples,documents:[{id:'d',text:'changed'}]},cpuIdentity),/exact same/);
const samplesFile=path.join(executionRoot,'samples.json');await fs.writeFile(samplesFile,JSON.stringify(pilotSamples));
const artifacts=[];
for(const relative of ['config.json','tokenizer.json','tokenizer_config.json','onnx/model_w8a8.onnx','onnx/model.onnx_data'])
  artifacts.push({path:relative,sha256:sha(await fs.readFile(path.join(modelRoot,relative)))});
const manifestFile=path.join(executionRoot,'cpu-execution.json');
await fs.writeFile(manifestFile,JSON.stringify({schema:'eg2.cpu-execution.v1',modelDirectory:modelRoot,samples:samplesFile,artifacts,batchSize:4,maxMillis:120000}));
let disposed=false;const fakeEnv={version:'4.3.1'};
const tokenizer=async (texts)=>typeof texts==='string'?{input_ids:[1,2],attention_mask:[1,1]}:
  {input_ids:texts.map(()=>[1,2]),attention_mask:texts.map(()=>[1,1])};
tokenizer.pad_token_id=0;
class FakeTensor {constructor(type,data,dims){this.type=type;this.data=data;this.dims=dims;}}
const completed=await runCpuTrial({trialRoot:executionRoot,manifestFile,loadTransformers:async()=>({
  env:fakeEnv,Tensor:FakeTensor,
  AutoConfig:{from_pretrained:async()=>({model_type:'embedding_gemma2'})},
  AutoTokenizer:{from_pretrained:async()=>tokenizer},
  AutoModel:{from_pretrained:async(directory,options)=>{
    assert.equal(directory,modelRoot);assert.equal(options.device,'cpu');
    assert.equal(options.session_options.intraOpNumThreads,2);assert.equal(options.session_options.executionMode,'sequential');
    assert.equal(options.model_file_name,'model_w8a8');assert.equal(options.dtype,'fp32');
    assert.equal(options.use_external_data_format,false);assert.equal(options.config.vision_config,null);
    await fs.writeFile(options.session_options.optimizedModelFilePath,patched.bytes);
    const fake=async inputs=>{
      const count=inputs.input_ids.dims[0],data=new Float32Array(count*768);
      for(let row=0;row<count;row++)data[row*768]=1;
      return {sentence_embedding:{dims:[count,768],data}};
    };
    fake.sessions={model:{endProfiling:async()=>path.join(executionRoot,'fixture-trace.json')}};
    fake.dispose=async()=>{disposed=true;};
    return fake;
  }}
})});
assert.equal(completed.state,'completed');assert.equal(completed.quality.candidateMetrics.recallAtK,1);
assert.equal(completed.completedDocuments,1);assert.equal(disposed,true);assert.equal(fakeEnv.allowRemoteModels,false);
await assert.rejects(runCpuTrial({trialRoot:executionRoot,manifestFile,loadTransformers:async()=>{throw Error('Must not reload');}}),/Prior trial/);
console.log('Mocked CPU runner isolation/provenance/option/output checks passed; no ONNX session created');
