import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { LOCAL_RERANKER_VERSION } from '../../../src/contracts/schemas/reranker.js';
import { preserveRerankerFailure } from '../../../src/retrieval/rerankers/failure-ownership.js';

// This imports the actual adapter/scorer and substitutes only acquisition/native
// boundaries. Synthetic profile digests are fixture identities, never model pins.
const key = Symbol.for('poc.tests.local-cross-encoder-cleanup'), state = { current: null };
globalThis[key] = state;
const symbolExpression = `globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(key))})].current`;
const sources = new Map([
  ['poc:reranker-module', `export const createRequire = () => ({ resolve: () => ${symbolExpression}.runtimeEntry });`],
  ['poc:reranker-artifact', `export const acquireEmbeddingArtifactLease = async () => ${symbolExpression}.artifact;`],
  ['poc:reranker-closure', `export const planOnnxArtifactClosure = async () => ${symbolExpression}.closure;`],
  ['poc:reranker-contained', `export const readVerifiedContainedFile = async (root, file) => ({ buffer: Buffer.from(file.endsWith('config.json') ? JSON.stringify({model_type:'bert',architectures:['BertForSequenceClassification'],num_labels:1}) : 'fixture license') });`],
  ['poc:reranker-storage', `export const acquireStorageSession = options => { ${symbolExpression}.storageOptions = options; return ${symbolExpression}.storage; };`],
  ['poc:reranker-qualification', `export const currentOnnxQualificationRuntime = () => ({ runtime: 'onnxruntime-node@1.30.0' });`],
  ['poc:reranker-tokenizer', `export const AutoTokenizer = { from_pretrained: async () => ${symbolExpression}.tokenizer };`],
  ['poc:reranker-native', `export class Tensor { constructor(...args) { return new (${symbolExpression}.Tensor)(...args); } } export const InferenceSession = { create: async () => { const value = ${symbolExpression}; if(value.createFailurePresent||value.createError)throw value.createError;return value.session; } };`]
]);
const scopedImports = new Map([
  ['node:module', 'poc:reranker-module'],
  ['../../shared/embedding-artifact-lease.js', 'poc:reranker-artifact'],
  ['../../shared/onnx-artifact-closure.js', 'poc:reranker-closure'],
  ['../../shared/contained-file.js', 'poc:reranker-contained'],
  ['../../shared/storage/session.js', 'poc:reranker-storage'],
  ['../../shared/onnx-embeddings/qualification.js', 'poc:reranker-qualification'],
  ['@huggingface/transformers', 'poc:reranker-tokenizer'], ['onnxruntime-node', 'poc:reranker-native']
]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const url = context.parentURL?.endsWith('/src/retrieval/rerankers/onnx-cross-encoder.js') && scopedImports.get(specifier);
    return url ? { url, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return sources.has(url) ? { format: 'module', source: sources.get(url), shortCircuit: true } : next(url, context);
  }
});
const { dir: root } = await prepareIsolatedTestCacheDir('local-cross-encoder-cleanup');
const runtimeRoot = path.join(root, 'runtime'); await fs.mkdir(runtimeRoot);
await fs.writeFile(path.join(runtimeRoot, 'package.json'), JSON.stringify({ name: '@huggingface/transformers', version: '4.3.1' }));
const inventory = [{ path: 'tokenizer/tokenizer.json', bytes: 3, sha256: '1'.repeat(64) }];
const profile = { schemaVersion: LOCAL_RERANKER_VERSION, kind: 'pinned-local-bert-cross-encoder',
  modelId: 'Xenova/ms-marco-MiniLM-L-6-v2', revision: 'a'.repeat(40), tokenizerRevision: 'a'.repeat(40), graph: 'model.onnx',
  graphClosureDigest: 'b'.repeat(64), artifactDigest: 'c'.repeat(64),
  tokenizerDigest: createHash('sha256').update(stableStringify(inventory)).digest('hex'),
  license: { spdx: 'Apache-2.0', path: 'LICENSE', sha256: 'e'.repeat(64) },
  runtime: { transformers: '@huggingface/transformers@4.3.1', onnx: 'onnxruntime-node@1.30.0' },
  formatting: 'bert-query-passage-pair.v1', truncation: 'reject-over-budget.v1', maxQueryChars: 2048,
  maxPassageChars: 8192, maxTotalChars: 262144, maxQueryTokens: 128, maxPairTokens: 512, maxTotalTokens: 32768,
  output: 'logits', score: 'sigmoid-single-logit.v1' };
const sourceContext = { generation: 'fixture-generation', repoScope: 'fixture', mode: 'code' };
const text = '😀', sourceDigest = createHash('sha256').update(text).digest('hex');
const hits = [{ file: 'a.js', chunkUid: 'a', start: 0, end: 2 }];
const fixtures = [],retainedOwners=new Set(),releaseNativeGates=[];
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const fixture = () => {
  const value = { runtimeEntry: path.join(runtimeRoot, 'entry.js'), artifactCloses: 0, storageCloses: 0,
    sessionCloses: 0, tokenizerCloses: 0, runs: 0, tensorFailures: [], sessionFailures: [], tokenizerFailures: [],
    tensors: [], storageReleased: false, failStorage: false };
  value.artifact = { artifact: { status: 'verified', digest: profile.artifactDigest, inventory },
    verifyLoaded: async () => {}, release() { value.artifactCloses++; } };
  value.closure = { digest: profile.graphClosureDigest, files: [] };
  value.storage = { resourceId: `fixture-session-${fixtures.length}`, releaseAfterSettlement(receipt) {
    assert.deepEqual(receipt, { resourceId: this.resourceId, settled: true, pending: false });
    value.storageCloses++;
    if (value.unconfirmedStorage) { value.unconfirmedStorage = false; return false; }
    if (value.failStorage) {
      value.failStorage = false;
      const failure = new Error('storage release pending');
      Object.defineProperties(failure, { storageSession: { value: value.storage }, cacheOwnershipPending: { value: true },
        cacheOwnershipReleased: { value: () => value.storageReleased } });
      throw Object.freeze(failure);
    }
    value.storageReleased = true;
    return true;
  } };
  value.Tensor = class {
    constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; this.id = value.tensors.length; this.closes = 0; value.tensors.push(this); }
    async dispose() {
      this.closes++;
      if (this.id === 0 && value.tensorGate) { value.tensorDisposeEntered.resolve(); await value.tensorGate.promise; }
      if (this.id === 0 && value.tensorFailures.length) throw value.tensorFailures.shift();
    }
  };
  value.tokenizer = () => ({ input_ids: [101, 7, 102, 9, 102], attention_mask: [1, 1, 1, 1, 1], token_type_ids: [0, 0, 0, 1, 1] });
  value.tokenizer.encode = () => [7];
  value.tokenizer.dispose = async () => { value.tokenizerCloses++; if (value.tokenizerFailures.length) throw value.tokenizerFailures.shift(); };
  value.session = { inputNames: ['input_ids', 'attention_mask', 'token_type_ids'], outputNames: ['logits'],
    release: async () => { value.sessionCloses++; if (value.sessionFailures.length) throw value.sessionFailures.shift();
      if(value.unconfirmedSession){value.unconfirmedSession=false;return false;} },
    run: async () => {
      value.runs++;
      if (value.runFailurePresent||value.runError) throw value.runError;
      return { logits: new value.Tensor('float32', new Float32Array([0]), [1, 1]) };
    } };
  state.current = value; fixtures.push(value); return value;
};
const { createLocalOnnxCrossEncoder } = await import('../../../src/retrieval/rerankers/onnx-cross-encoder.js');
const create = async () => {
  const selected=state.current;
  const adapter=await createLocalOnnxCrossEncoder({ profile, modelRoot: path.join(root, 'model'), storage: {},
    loadSource: async ({ key, generation, hit }) => ({ key, generation, start: hit.start, end: hit.end,
      offsetUnit: 'utf16-code-unit', complete: true, text, contentDigest: sourceDigest }) });
  selected.adapter=adapter;return adapter;
};
const rank = (adapter, signal = null) => adapter.rerank({ query: 'query', hits, sourceContext, signal });
const pendingFailure = async operation => {
  try { await operation; assert.fail('expected pending cleanup'); }
  catch (error) { assert.equal(error.cacheOwnershipPending, true);retainedOwners.add(error.rerankerOwner);return error; }
};
try {
  const normal = fixture(), normalAdapter = await create();
  assert.deepEqual(await rank(normalAdapter), [{ index: 0, score: 0.5 }]);
  assert(normal.tensors.every(tensor => tensor.closes === 1), 'actual scorer awaits each captured disposal');
  assert.deepEqual(await normalAdapter.dispose(), { resourceId: normal.storage.resourceId, settled: true, pending: false });
  assert.equal(normal.sessionCloses, 1); assert.equal(normal.tokenizerCloses, 1);
  assert.equal(normal.artifactCloses, 1); assert.equal(normal.storageCloses, 1);

  const broken = fixture(), brokenAdapter = await create();
  const primary = Object.freeze(Object.defineProperty(new Error('frozen inference failure'), 'code', { value: 'CONTROLLED_INFERENCE' }));
  const disposeFailure = Object.freeze(new Error('frozen asynchronous tensor disposal failure'));
  broken.runError = primary; broken.tensorFailures.push(disposeFailure, disposeFailure);
  const scoring = await pendingFailure(rank(brokenAdapter));
  assert.equal(scoring.primaryError.primaryError, primary); assert.equal(scoring.code, 'CONTROLLED_INFERENCE');
  assert.equal(scoring.primaryError.cleanupErrors[0].cleanupErrors[0], disposeFailure);
  assert.equal(scoring.rerankerOwner.pendingTensors.size, 1);
  await assert.rejects(rank(brokenAdapter), error => error.cacheOwnershipPending === true);
  assert.equal(broken.runs, 1, 'a pending cleanup closes further model admission');
  let substitutes = 0;
  broken.tensors[0].dispose = () => { substitutes++; throw new Error('substitute tensor disposal'); };
  broken.session.release = () => { substitutes++; throw new Error('substitute session release'); };
  broken.tokenizer.dispose = () => { substitutes++; throw new Error('substitute tokenizer disposal'); };
  await pendingFailure(brokenAdapter.dispose());
  assert.equal(broken.sessionCloses, 0); assert.equal(broken.tokenizerCloses, 0);
  assert.equal(broken.artifactCloses, 0); assert.equal(broken.storageCloses, 0,
    'a still-failing tensor retains its original session and artifact/storage leases');
  await Promise.all([scoring.rerankerOwner.close(), scoring.rerankerOwner.close()]);
  assert.equal(substitutes, 0); assert.equal(broken.tensors[0].closes, 3);
  assert.equal(broken.sessionCloses, 1); assert.equal(broken.tokenizerCloses, 1);
  assert.equal(broken.storageReleased, true); assert.equal(scoring.cacheOwnershipReleased(), true);

  const closing = fixture(), closingAdapter = await create();
  const sessionFailure = Object.freeze(new Error('session release rejected')), tokenizerFailure = Object.freeze(new Error('tokenizer release rejected'));
  closing.sessionFailures.push(sessionFailure); closing.tokenizerFailures.push(tokenizerFailure);
  const failedClose = await pendingFailure(closingAdapter.dispose());
  assert.deepEqual(failedClose.cleanupErrors, [sessionFailure, tokenizerFailure]);
  assert.equal(closing.sessionCloses, 1); assert.equal(closing.tokenizerCloses, 1);
  assert.equal(closing.artifactCloses, 0); assert.equal(closing.storageCloses, 0);
  await failedClose.rerankerOwner.close(); assert.equal(failedClose.cacheOwnershipReleased(), true);
  assert.equal(closing.sessionCloses, 2); assert.equal(closing.tokenizerCloses, 2);
  assert.equal(closing.artifactCloses, 1); assert.equal(closing.storageCloses, 1);

  const falseSession=fixture(),falseSessionAdapter=await create();falseSession.unconfirmedSession=true;
  const falseSessionFailure=await pendingFailure(falseSessionAdapter.dispose());
  assert.equal(falseSessionFailure.cleanupErrors[0].code,'ERR_LOCAL_RERANKER_RESOURCE_UNCONFIRMED');
  assert.equal(falseSession.sessionCloses,1);assert.equal(falseSession.tokenizerCloses,1);assert.equal(falseSession.artifactCloses,0);assert.equal(falseSession.storageCloses,0);
  await falseSessionFailure.rerankerOwner.close();
  assert.equal(falseSession.sessionCloses,2);assert.equal(falseSession.tokenizerCloses,1);assert.equal(falseSession.storageCloses,1);
  assert.equal(falseSessionFailure.cacheOwnershipReleased(),true);

  const storage = fixture(), storageAdapter = await create(); storage.failStorage = true;
  const failedStorage = await pendingFailure(storageAdapter.dispose());
  assert.equal(storage.artifactCloses, 1); assert.equal(storage.storageCloses, 1);
  await failedStorage.rerankerOwner.close();
  assert.equal(storage.sessionCloses, 1); assert.equal(storage.tokenizerCloses, 1); assert.equal(storage.artifactCloses, 1);
  assert.equal(storage.storageCloses, 2); assert.equal(failedStorage.cacheOwnershipReleased(), true,
    'a retained exact storage release can be retried without depending on its own prior observer');

  const unconfirmed = fixture(), unconfirmedAdapter = await create(); unconfirmed.unconfirmedStorage = true;
  const unconfirmedFailure = await pendingFailure(unconfirmedAdapter.dispose());
  assert.equal(unconfirmedFailure.cleanupErrors[0].code, 'ERR_LOCAL_RERANKER_STORAGE_UNCONFIRMED');
  assert.equal(unconfirmedFailure.cacheOwnershipReleased(), false); assert.equal(unconfirmed.storageReleased, false);
  await unconfirmedFailure.rerankerOwner.close();
  assert.equal(unconfirmedFailure.cacheOwnershipReleased(), true); assert.equal(unconfirmed.storageCloses, 2);
  assert.equal(unconfirmed.sessionCloses, 1); assert.equal(unconfirmed.tokenizerCloses, 1); assert.equal(unconfirmed.artifactCloses, 1);

  const acquisition = fixture(); let nativeReleased = false;
  releaseNativeGates.push(()=>{nativeReleased=true;});
  const nativeOwner = Object.freeze({ close: async () => { nativeReleased = true; } });
  const acquisitionFailure = new Error('native create retained ownership');
  Object.defineProperties(acquisitionFailure, { cacheOwnershipPending: { value: true }, onnxSessionOwner: { value: nativeOwner },
    cacheOwnershipReleased: { value() { assert.equal(this, acquisitionFailure); return nativeReleased; } } });
  acquisition.createError = Object.freeze(acquisitionFailure);
  const failedAcquisition = await pendingFailure(create());
  assert.equal(failedAcquisition.code, 'ERR_RERANK_UNAVAILABLE'); assert.equal(failedAcquisition.measuredModelFailure, false);
  assert.equal(failedAcquisition.nativeOwner, nativeOwner);
  await assert.rejects(failedAcquisition.rerankerOwner.close(), error => error.cacheOwnershipPending === true);
  assert.equal(acquisition.tokenizerCloses, 0); assert.equal(acquisition.artifactCloses, 0); assert.equal(acquisition.storageCloses, 0);
  await nativeOwner.close(); await failedAcquisition.rerankerOwner.close();
  assert.equal(failedAcquisition.cacheOwnershipReleased(), true);
  assert.equal(acquisition.artifactCloses, 1); assert.equal(acquisition.storageReleased, true);
  assert.equal(acquisition.tokenizerCloses,1,'unknown native startup work retains its tokenizer until the original owner settles');

  const active = fixture(), activeAdapter=await create();let nativeSettled=false,replaceNativeObserver=false;
  releaseNativeGates.push(()=>{nativeSettled=true;});
  const nativeFailure=new Error('original observer-only native inference remains pending');
  const originalNativeObserver=function(){assert.equal(this,nativeFailure);return nativeSettled;};
  Object.defineProperty(nativeFailure,'cacheOwnershipReleased',{get(){return replaceNativeObserver?()=>true:originalNativeObserver;}});
  active.runError=Object.freeze(nativeFailure);
  const activeFailure=await pendingFailure(rank(activeAdapter));
  assert.equal(activeFailure.primaryError.primaryError,nativeFailure);assert.equal(activeFailure.rerankerOwner.pendingTensors.size,3);
  assert.deepEqual(active.tensors.map(tensor=>tensor.closes),[0,0,0]);
  await pendingFailure(activeAdapter.dispose());
  assert.equal(active.sessionCloses,0);assert.equal(active.tokenizerCloses,0);assert.equal(active.storageCloses,0);
  replaceNativeObserver=true;await pendingFailure(activeAdapter.dispose());
  assert.deepEqual(active.tensors.map(tensor=>tensor.closes),[0,0,0],'replaced observer cannot authorize native input disposal');
  let changedMethods=0;
  for(const tensor of active.tensors)tensor.dispose=()=>{changedMethods++;};
  active.session.release=()=>{changedMethods++;};
  nativeSettled=true;await activeFailure.rerankerOwner.close();
  assert.deepEqual(active.tensors.map(tensor=>tensor.closes),[1,1,1]);assert.equal(changedMethods,0);
  assert.equal(active.sessionCloses,1);assert.equal(active.tokenizerCloses,1);assert.equal(active.storageCloses,1);
  assert.equal(activeFailure.cacheOwnershipReleased(),true);

  const observerOnly=fixture();let startupSettled=false,startupObserverReads=0;
  releaseNativeGates.push(()=>{startupSettled=true;});
  const startupOriginal=function(){assert.equal(this,startupFailure);return startupSettled;};
  const startupFailure=Object.freeze(Object.defineProperty(new Error('startup observer without marker'),'cacheOwnershipReleased',
    {get(){return startupObserverReads++===0?startupOriginal:()=>true;}}));
  observerOnly.createError=startupFailure;
  const observerOnlyFailure=await pendingFailure(create());await pendingFailure(observerOnlyFailure.rerankerOwner.close());
  assert.equal(observerOnly.tokenizerCloses,0);assert.equal(observerOnly.storageCloses,0);
  assert.equal(startupObserverReads,1,'unavailable wrapping, adapter admission and parent owner share the first original observer');
  startupSettled=true;await observerOnlyFailure.rerankerOwner.close();assert.equal(observerOnly.tokenizerCloses,1);assert.equal(observerOnly.storageCloses,1);

  const inspectedStartup=fixture();let primarySettled=false,codeSettled=false,ownerSettled=false;
  releaseNativeGates.push(()=>{primarySettled=true;codeSettled=true;ownerSettled=true;});
  const codeInspection=Object.freeze(Object.defineProperty(new Error('startup code inspection owner'),'cacheOwnershipReleased',
    {value(){assert.equal(this,codeInspection);return codeSettled;}}));
  const ownerInspection=Object.freeze(Object.defineProperty(new Error('startup owner inspection owner'),'cacheOwnershipReleased',
    {value(){assert.equal(this,ownerInspection);return ownerSettled;}}));
  const inspectionReads={code:0,name:0,rerankerOwner:0,onnxSessionOwner:0};
  const inspectedPrimary=Object.freeze(Object.defineProperties({message:'original startup failure'}, {
    cacheOwnershipReleased:{value(){assert.equal(this,inspectedPrimary);return primarySettled;}},
    code:{get(){inspectionReads.code++;throw codeInspection;}},name:{get(){inspectionReads.name++;throw false;}},
    rerankerOwner:{get(){inspectionReads.rerankerOwner++;throw ownerInspection;}},
    onnxSessionOwner:{get(){inspectionReads.onnxSessionOwner++;throw undefined;}}
  }));
  inspectedStartup.createError=inspectedPrimary;
  const inspectedFailure=await pendingFailure(create());
  assert.equal(inspectedFailure.primaryError.cause,inspectedPrimary);assert.equal(inspectedFailure.nativeOwner,inspectedPrimary);
  assert.deepEqual(inspectedFailure.primaryError.rerankerInspectionErrors,[false,codeInspection,ownerInspection,undefined]);
  assert.deepEqual(inspectionReads,{code:1,name:1,rerankerOwner:1,onnxSessionOwner:1});
  primarySettled=true;await pendingFailure(inspectedFailure.rerankerOwner.close());
  codeSettled=true;await pendingFailure(inspectedFailure.rerankerOwner.close());
  assert.equal(inspectedStartup.tokenizerCloses,0);assert.equal(inspectedStartup.storageCloses,0);
  ownerSettled=true;await inspectedFailure.rerankerOwner.close();assert.equal(inspectedStartup.tokenizerCloses,1);
  assert.equal(inspectedFailure.cacheOwnershipReleased(),true);
  assert.deepEqual(inspectionReads,{code:1,name:1,rerankerOwner:1,onnxSessionOwner:1});

  const inspectedRun=fixture(),inspectedRunAdapter=await create();let runInspectionSettled=false,runOwnerReads=0;
  releaseNativeGates.push(()=>{runInspectionSettled=true;});
  const runInspection=Object.freeze(Object.defineProperty(new Error('inference diagnostic child'),'cacheOwnershipReleased',
    {value(){assert.equal(this,runInspection);return runInspectionSettled;}}));
  const runPrimary=Object.freeze(Object.defineProperty({message:'original inference'},'rerankerOwner',
    {get(){runOwnerReads++;throw runInspection;}}));
  inspectedRun.runError=runPrimary;
  const inspectedRunFailure=await pendingFailure(rank(inspectedRunAdapter));
  assert.equal(inspectedRunFailure.primaryError.primaryError,runPrimary);
  assert.deepEqual(inspectedRun.tensors.map(tensor=>tensor.closes),[0,0,0]);
  await pendingFailure(inspectedRunAdapter.dispose());assert.equal(inspectedRun.sessionCloses,0);
  runInspectionSettled=true;await inspectedRunFailure.rerankerOwner.close();
  assert.deepEqual(inspectedRun.tensors.map(tensor=>tensor.closes),[1,1,1]);assert.equal(runOwnerReads,1);

  for(const value of [undefined,null,false,0,'']){
    const falsey=fixture(),falseyAdapter=await create(),falseyController=new AbortController();
    falsey.runFailurePresent=true;falsey.runError=value;falsey.tensorGate=deferred();falsey.tensorDisposeEntered=deferred();
    const originalFailure=rank(falseyAdapter,falseyController.signal).then(()=>assert.fail('expected original falsey inference failure'),error=>({error}));
    await falsey.tensorDisposeEntered.promise;falseyController.abort();falsey.tensorGate.resolve();
    assert.equal((await originalFailure).error,value,'later cleanup-time cancellation cannot replace the exact earlier inference failure');
    await falseyAdapter.dispose();assert.equal(falsey.storageReleased,true);

    const falseyStartup=fixture();falseyStartup.createFailurePresent=true;falseyStartup.createError=value;
    await assert.rejects(create(),error=>error.code==='ERR_RERANK_UNAVAILABLE'&&error.cause===value);
    assert.equal(falseyStartup.tokenizerCloses,1);assert.equal(falseyStartup.artifactCloses,1);assert.equal(falseyStartup.storageCloses,1);
  }

  const cancelled = fixture(), cancelledAdapter = await create(), controller = new AbortController();
  cancelled.tensorGate = deferred(); cancelled.tensorDisposeEntered = deferred();
  cancelled.tensorFailures.push(Object.freeze(new Error('cancelled tensor close rejected')));
  const cancelledScoring = rank(cancelledAdapter, controller.signal);
  await cancelled.tensorDisposeEntered.promise; controller.abort(); cancelled.tensorGate.resolve();
  const cancelledFailure = await pendingFailure(cancelledScoring);
  assert.equal(cancelledFailure.name, 'AbortError'); assert.equal(cancelledFailure.code, 'ABORT_ERR');
  assert.equal(cancelled.storageReleased, false);
  await cancelledFailure.rerankerOwner.close(); assert.equal(cancelledFailure.cacheOwnershipReleased(), true);

  let observed = false;
  const original = Object.freeze(Object.defineProperties(new Error('original observer receiver'), {
    cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value() { assert.equal(this, original); return observed; } }
  }));
  const copied = preserveRerankerFailure(original);
  assert.equal(copied.cacheOwnershipReleased(), false); observed = true; assert.equal(copied.cacheOwnershipReleased(), true);
} finally {
  for(const release of releaseNativeGates)release();
  for(const value of fixtures)value.tensorGate?.resolve();
  for(const value of fixtures)await value.adapter?.dispose().catch(()=>{});
  for(const owner of retainedOwners)await owner?.close().catch(()=>{});
  hooks.deregister(); delete globalThis[key]; await fs.rm(root, { recursive: true, force: true });
}
console.log('Actual local adapter/scorer frozen cleanup and retained storage controls authored; all model/runtime execution deferred.');
