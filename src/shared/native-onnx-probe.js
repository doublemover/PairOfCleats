import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSubprocess } from './subprocess/runner.js';
import { observeStorageResource } from './storage/failure-observation.js';
import { readErrorDataProperty } from './error-data.js';
import { createOnnxResourceOwner } from './onnx-embeddings/resource-lifetime.js';
import { withOnnxTensorScope } from './onnx-embeddings/tensor-lifetime.js';
import { preserveEmbeddingCleanupFailure } from './embedding-cache-lifetime.js';

export const NATIVE_ONNX_IMPORT_ORDERS = Object.freeze(['hf-first', 'root-first']);
// IR8/opset13, float32[2] x -> Identity -> y. These are the original83
// independently authored probe bytes, not a model download or model-quality test.
const IDENTITY_HEX = '08083a4b0a100a017812017922084964656e7469747912156e61746976652d6964656e746974792d70726f62655a0f0a0178120a0a08080112040a020802620f0a0179120a0a08080112040a0208024202100d';
export const createNativeOnnxIdentityModel = () => Buffer.from(IDENTITY_HEX, 'hex');
const parityFailure = reason => Object.assign(new Error(`Native ONNX runtime parity rejected: ${reason}.`), { code: 'ERR_NATIVE_ONNX_PARITY', reason });
const metadata = filename => {
  if (fs.statSync(filename).size > 65536) throw parityFailure('package-metadata-exceeds-bound');
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
};
const packageFor = (entry, name) => {
  for (let directory = path.dirname(entry), depth = 0; depth < 5; directory = path.dirname(directory), depth++) {
    const filename = path.join(directory, 'package.json');
    if (fs.existsSync(filename)) { const value = metadata(filename); if (value.name === name) return { root: fs.realpathSync(directory), value }; }
  }
  throw parityFailure('resolved-package-metadata-missing');
};
/** Pure metadata admission. No addon require or provider import occurs here. */
export const assertNativeOnnxParity = parity => {
  const exact = /^\d+\.\d+\.\d+$/;
  if (!exact.test(parity.selectedVersion) || parity.transformers.requiredVersion !== parity.selectedVersion) throw parityFailure('declared-runtime-version-mismatch');
  if ([parity.root.version, parity.huggingface.version].some(value => value !== parity.selectedVersion)) throw parityFailure('installed-runtime-version-mismatch');
  for (const key of ['packageRoot', 'entry', 'addon', 'commonRoot', 'commonEntry']) {
    if (typeof parity.root[key] !== 'string' || !parity.root[key] || parity.root[key] !== parity.huggingface[key]) throw parityFailure('split-' + key);
  }
  if ([parity.root.commonVersion, parity.huggingface.commonVersion].some(value => value !== parity.selectedVersion)
    || parity.transformers.commonEntry !== parity.root.commonEntry) throw parityFailure('common-runtime-version-or-entry-mismatch');
  return parity;
};
export const inspectNativeOnnxParity = root => {
  root = fs.realpathSync(root);
  const app = metadata(path.join(root, 'package.json')), rootRequire = createRequire(path.join(root, 'package.json'));
  const hfPackage = packageFor(rootRequire.resolve('@huggingface/transformers'), '@huggingface/transformers');
  const hfImport = hfPackage.value.exports?.node?.import?.default;
  if (typeof hfImport !== 'string' || !hfImport.startsWith('./')) throw parityFailure('transformers-node-import-export-unavailable');
  const hfEntry = fs.realpathSync(path.join(hfPackage.root, hfImport)), hfRequire = createRequire(hfEntry);
  const inspect = require => {
    const entry = fs.realpathSync(require.resolve('onnxruntime-node')), installed = packageFor(entry, 'onnxruntime-node');
    const nativeRequire = createRequire(entry), commonEntry = fs.realpathSync(nativeRequire.resolve('onnxruntime-common'));
    const common = packageFor(commonEntry, 'onnxruntime-common');
    return { version: installed.value.version, packageRoot: installed.root, entry,
      addon: fs.realpathSync(path.join(installed.root, 'bin', 'napi-v6', process.platform, process.arch, 'onnxruntime_binding.node')),
      commonRoot: common.root, commonEntry, commonVersion: common.value.version };
  };
  return assertNativeOnnxParity({ selectedVersion: app.dependencies?.['onnxruntime-node'],
    transformers: { version: hfPackage.value.version, entry: hfEntry, requiredVersion: hfPackage.value.dependencies?.['onnxruntime-node'],
      commonEntry: fs.realpathSync(hfRequire.resolve('onnxruntime-common')) }, root: inspect(rootRequire), huggingface: inspect(hfRequire) });
};

const runIdentityConsumer = async (runtime, consumer, model) => {
  const entry = { tensorScopes: new Set(), operationFailure: null, measurements: {} };
  let session = null, owner = null, result, failure, failed = false;
  try {
    session = await runtime.InferenceSession.create(model, { executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1 });
    owner = createOnnxResourceOwner({ session, tensorScopes: entry.tensorScopes });
    assert.deepEqual(session.inputNames, ['x']); assert.deepEqual(session.outputNames, ['y']);
    result = await withOnnxTensorScope(entry, async scope => {
      const input = scope.adopt(new runtime.Tensor('float32', new Float32Array([1.25, -2]), [2]), 'bootstrap ONNX identity input');
      const outputs = await session.run({ x: input });
      for (const value of Object.values(outputs)) scope.adopt(value, 'bootstrap ONNX identity output');
      assert.equal(outputs.y.type, 'float32'); assert.deepEqual(outputs.y.dims, [2]);
      assert.deepEqual([...outputs.y.data], [1.25, -2]);
      return { consumer, output: [...outputs.y.data], dimensions: [...outputs.y.dims] };
    }, () => owner.retainOperationFailure(entry.operationFailure));
  } catch (error) {
    failed = true; failure = error;
    owner ||= createOnnxResourceOwner({ session, primaryError: error, tensorScopes: entry.tensorScopes }); owner.retainOperationFailure(error);
  }
  try { await owner.release(); }
  catch (cleanup) { failure = failed ? preserveEmbeddingCleanupFailure(failure, cleanup) : cleanup; failed = true; }
  if (failed) throw failure;
  assert.equal(owner.settled, true); assert.equal(entry.tensorScopes.size, 0);
  assert.equal(entry.measurements.tensorResourcesObserved, 2); assert.equal(entry.measurements.tensorResourcesSettled, 2);
  return { ...result, sessionReleased: owner.settled, tensorResourcesObserved: entry.measurements.tensorResourcesObserved,
    tensorResourcesSettled: entry.measurements.tensorResourcesSettled, retainedTensorScopes: entry.tensorScopes.size };
};
/** Called only inside the private fresh probe child; its caller observes natural
 * process exit. Both original Node resolution contexts construct real sessions. */
export const runNativeOnnxLifecycleOrder = async ({ root, order, emit = () => {} }) => {
  assert.ok(NATIVE_ONNX_IMPORT_ORDERS.includes(order));
  const parity = inspectNativeOnnxParity(root); emit({ phase: 'parity-verified', order, version: parity.selectedVersion });
  let namespace;
  if (order === 'hf-first') { await import(pathToFileURL(parity.transformers.entry).href); namespace = await import(pathToFileURL(parity.root.entry).href); }
  else { namespace = await import(pathToFileURL(parity.root.entry).href); await import(pathToFileURL(parity.transformers.entry).href); }
  const runtime = namespace.default || namespace, hfRuntime = createRequire(parity.transformers.entry)('onnxruntime-node');
  assert.equal(runtime, hfRuntime, 'Both original resolution contexts must use one actual Node runtime module.');
  emit({ phase: 'imports-returned', order });
  const model = createNativeOnnxIdentityModel(); assert.equal(model.length, 83);
  const consumers = [];
  for (const [consumer, selected] of [['root', runtime], ['huggingface', hfRuntime]]) {
    consumers.push(await runIdentityConsumer(selected, consumer, model)); emit({ phase: 'consumer-settled', order, consumer });
  }
  assert.deepEqual(inspectNativeOnnxParity(root), parity, 'Selected package identities changed during the original lifecycle.');
  return { status: 'passed', order, version: parity.selectedVersion, consumers,
    model: { bytes: model.length, sha256: createHash('sha256').update(model).digest('hex') },
    scope: 'Two actual resolved Node-runtime consumers;identity graph only;no tokenizer/model-quality/native-unload claim.' };
};

const childSource = `import {runNativeOnnxLifecycleOrder} from ${JSON.stringify(import.meta.url)};
const emit=value=>process.stdout.write(JSON.stringify(value)+'\\n');
try {emit({phase:'completed',...await runNativeOnnxLifecycleOrder({...JSON.parse(process.argv[1]),emit})});}
catch(error) {console.error(error);process.exitCode=1;}`;

export const probeNativeOnnxLifecycle = async root => {
  let parity;
  try { parity = inspectNativeOnnxParity(root); }
  catch (error) { return { ok: false, message: error.message, code: error.code, orders: [], capabilities: [] }; }
  const orders = [];
  for (const order of NATIVE_ONNX_IMPORT_ORDERS) {
    let processResult, failure = null;
    try {
      processResult = await spawnSubprocess(process.execPath, ['--input-type=module', '-e', childSource, JSON.stringify({ root, order })], {
        cwd: root, timeoutMs: 10000, maxOutputBytes: 65536, outputMode: 'string', captureStdout: true, captureStderr: true, windowsHide: true });
    } catch (error) {
      observeStorageResource(error, { phase: 'bootstrap-onnx-lifecycle' }).requireSettled();
      processResult = readErrorDataProperty(error, 'result') || null;
      failure = { code: readErrorDataProperty(error, 'code') || null, message: readErrorDataProperty(error, 'message') || 'Native ONNX child failed.' };
    }
    let events = [], parseFailure = null;
    try { events = String(processResult?.stdout || '').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
    catch (error) { parseFailure = error.message; }
    const completed = events.find(event => event.phase === 'completed');
    const ok = !failure && !parseFailure && processResult?.exitCode === 0 && processResult.signal === null
      && !processResult.termination && processResult.stderr === '' && !processResult.outputCapture?.stdout?.truncated
      && !processResult.outputCapture?.stderr?.truncated && completed?.status === 'passed' && completed.order === order;
    orders.push({ order, status: ok ? 'passed' : 'failed', loadability: events.some(event => event.phase === 'imports-returned') ? 'passed' : 'failed',
      lifecycle: completed?.status === 'passed' ? 'passed' : 'failed', naturalExit: ok, timeoutMs: 10000, retries: 0,
      durationMs: processResult?.durationMs ?? null, process: processResult, failure, parseFailure, receipt: completed || null });
  }
  const ok = orders.every(row => row.status === 'passed');
  return { ok, message: ok ? null : orders.filter(row => row.status !== 'passed')
    .map(row => `${row.order}: ${row.failure?.code || row.parseFailure || 'lifecycle/stderr contract failed'};exit=${row.process?.exitCode ?? 'unknown'};signal=${row.process?.signal ?? 'none'}`).join('; '),
  parity, orders, capabilities: [
    { id: 'onnxruntime-node:loadability', package: 'onnxruntime-node', kind: 'native-runtime-loadability', version: parity.selectedVersion,
      verified: orders.every(row => row.loadability === 'passed'), orders: orders.map(({ order, loadability }) => ({ order, status: loadability })) },
    { id: 'onnxruntime-node:lifecycle', package: 'onnxruntime-node', kind: 'native-runtime-lifecycle', version: parity.selectedVersion, verified: ok,
      modelBytes: 83, consumersPerOrder: 2, orders: orders.map(({ order, status, durationMs, naturalExit }) => ({ order, status, durationMs, naturalExit })),
      scope: 'Original child close after create/infer/owned disposal;no forced successful exit or native-unload claim.' }
  ] };
};
