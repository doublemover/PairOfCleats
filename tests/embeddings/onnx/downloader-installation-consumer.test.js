import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { InferenceSession } from 'onnxruntime-node';
import { encodeField as field } from '../../../tools/history/eg2-qualify-graph.js';
import { installOnnxArtifactClosure } from '../../../src/shared/onnx-model-install.js';
import { onnxSelectionPath, resolveInstalledOnnxPath, readOnnxInstallationReceipt, ONNX_INSTALLATION_RECEIPT,
  ONNX_INSTALLATION_VERSION } from '../../../src/shared/onnx-installation.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { toNativeFilePath } from '../../../src/shared/file-paths.js';
import { createOnnxEmbedder, __resetOnnxSessionCacheForTests } from '../../../src/shared/onnx-embeddings.js';
import { acquireEmbeddingArtifactLease } from '../../../src/shared/embedding-artifact-lease.js';

const { dir } = await prepareIsolatedTestCacheDir('onnx-downloader-installation-consumer');
applyTestEnv({ cacheRoot: path.join(dir, 'cache') });
const message = (...fields) => Buffer.concat(fields), text = (number, value) => field(number, 2, value);
const entry = (key, value) => text(13, message(text(1, key), text(2, value)));
const floatBytes = value => { const bytes = Buffer.alloc(4); bytes.writeFloatLE(value); return bytes; };
const graphBytes = (value, location = null) => {
  const tensor = message(field(1, 0, 1), field(2, 0, 1), text(8, 'W'),
    ...(location ? [entry('location', location), entry('offset', '0'), entry('length', '4'), field(14, 0, 1)]
      : [text(9, floatBytes(value))]));
  const shape = text(2, text(1, field(1, 0, 1)));
  const output = message(text(1, 'Y'), text(2, text(1, message(field(1, 0, 1), shape))));
  return message(field(1, 0, 8), text(7, message(text(1, message(text(1, 'W'), text(2, 'Y'), text(4, 'Identity'))),
    text(2, 'fixture'), text(5, tensor), text(12, output))), text(8, field(2, 0, 13)));
};
const readValue = async file => {
  const session = await InferenceSession.create(toNativeFilePath(file), { intraOpNumThreads: 1, interOpNumThreads: 1 });
  try { return (await session.run({})).Y.data[0]; } finally { await session.release(); }
};
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const repo = path.join(dir, 'repo'), source = path.join(dir, 'acquired'), target = path.join(dir, 'target/renamed.onnx');
await fs.mkdir(repo); await fs.mkdir(source); await fs.mkdir(path.dirname(target));
await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({ models: { id: 'controlled/fixture' } }));
await fs.writeFile(path.join(source, 'model.onnx'), graphBytes(1)); await fs.writeFile(target, 'partial legacy target');
const originalArgv = process.argv;
const hooks = registerHooks({ load(url, context, next) {
  if (url.endsWith('/src/shared/embedding-model-prefetch.js')) return { shortCircuit: true, format: 'module',
    source: `export const prefetchEmbeddingModel=async()=>({root:${JSON.stringify(source)},receipt:{files:['model.onnx']}});` };
  if (url.includes('/node_modules/@huggingface/transformers/')) return { shortCircuit: true, format: 'module', source: `
    export const AutoTokenizer={from_pretrained:async()=>Object.assign(()=>({input_ids:[[1]],attention_mask:[[1]]}),{dispose:async()=>{}})};` };
  return next(url, context);
} });
try {
  process.argv = [process.execPath, 'models.js', '--repo', repo, '--cache-dir', path.join(dir, 'download-cache'), '--onnx-path', target];
  await import('../../../tools/download/models.js');
  process.argv = originalArgv;
  const installed = resolveInstalledOnnxPath(target);
  assert.ok(installed); assert.equal(await readValue(installed), 1, 'actual downloader publishes a valid relocated single-file model');
  const nativeCreate = InferenceSession.create, nativeCalls = [];
  InferenceSession.create = async function (file, options) { nativeCalls.push(file); return nativeCreate.call(this, file, options); };
  const lease = await acquireEmbeddingArtifactLease({ rootDir: repo, provider: 'onnx', modelId: 'controlled/fixture',
    modelsDir: source, onnx: { modelPath: target } });
  assert.equal(lease.selectedModelPath, installed);
  const selectedIdentity = JSON.stringify(lease.artifact);
  const adapter = createOnnxEmbedder({ rootDir: repo, modelId: 'controlled/fixture', modelsDir: source,
    onnxConfig: { modelPath: target, intraOpNumThreads: 1, interOpNumThreads: 1 }, modelArtifact: lease.artifact });
  try {
    const loaded = await adapter.embedderPromise;
    assert.equal((await loaded.session.run({})).Y.data[0], 1, 'the actual embedding runtime native handoff loads the same installed graph');
    assert.deepEqual(nativeCalls, [toNativeFilePath(installed)]);
    const artifact = adapter.executionInfo().modelArtifact;
    assert.ok(artifact); assert.equal(JSON.stringify(artifact).includes('\\\\?\\'), false,
      'native invocation spelling cannot replace the public artifact identity');
    assert.equal(lease.selectedModelPath, installed); assert.equal(JSON.stringify(lease.artifact), selectedIdentity);
  } finally { await adapter.dispose(); __resetOnnxSessionCacheForTests(); lease.release(); InferenceSession.create = nativeCreate; }
  if (process.platform === 'win32') {
    const deepTarget = path.join(dir, 'native graph 雪 '.repeat(9), 'selected.onnx');
    const longSingle = await installOnnxArtifactClosure({ sourceGraph: path.join(source, 'model.onnx'), targetGraph: deepTarget });
    assert.ok(longSingle.graphPath.length > 260, 'single-file native handoff retains its original long-path positive');
    const selected = await acquireEmbeddingArtifactLease({ rootDir: repo, provider: 'onnx', modelId: 'controlled/fixture',
      modelsDir: source, onnx: { modelPath: deepTarget } });
    const longAdapter = createOnnxEmbedder({ rootDir: repo, modelsDir: source, modelId: 'controlled/fixture',
      modelArtifact: selected.artifact, onnxConfig: { modelPath: deepTarget, intraOpNumThreads: 1, interOpNumThreads: 1 } });
    try {
      const loaded = await longAdapter.embedderPromise;
      assert.equal((await loaded.session.run({})).Y.data[0], 1);
      assert.equal(selected.selectedModelPath, longSingle.graphPath);
      assert.equal(selected.selectedModelPath.startsWith('\\\\?\\'), false);
    } finally { await longAdapter.dispose(); __resetOnnxSessionCacheForTests(); selected.release(); }
  }
  for (const [original, expected] of [
    ['C:\\models\\ordinary.onnx', 'C:\\models\\ordinary.onnx'],
    ['C:\\models\\雪 named.onnx', 'C:\\models\\雪 named.onnx'],
    ['\\\\server\\share\\model.onnx', '\\\\server\\share\\model.onnx'],
    ['\\\\?\\C:\\models\\one.onnx', '\\\\?\\C:\\models\\one.onnx'],
    [`C:\\models\\${'雪'.repeat(250)}.onnx`, `\\\\?\\C:\\models\\${'雪'.repeat(250)}.onnx`],
    [`\\\\server\\share\\${'d'.repeat(240)}\\model.onnx`, `\\\\?\\UNC\\server\\share\\${'d'.repeat(240)}\\model.onnx`],
    ['relative-'.repeat(40), 'relative-'.repeat(40)]
  ]) {
    const normalized = toNativeFilePath(original, 'win32');
    assert.equal(normalized, expected);
    assert.equal(toNativeFilePath(normalized, 'win32'), normalized, 'already-namespaced input cannot receive a second prefix');
    assert.equal(toNativeFilePath(original, 'linux'), original);
  }
  assert.equal(await fs.readFile(target, 'utf8'), 'partial legacy target', 'selected repair never overwrites an active legacy path');
  assert.equal((await installOnnxArtifactClosure({ sourceGraph: path.join(source, 'model.onnx'), targetGraph: target })).unchanged, true);
  const oldReader = await InferenceSession.create(toNativeFilePath(installed), { intraOpNumThreads: 1, interOpNumThreads: 1 });
  const entered = gate(), finish = gate();
  await fs.writeFile(path.join(source, 'model.onnx'), graphBytes(2));
  const first = installOnnxArtifactClosure({ sourceGraph: path.join(source, 'model.onnx'), targetGraph: target,
    hooks: { afterAsset: async () => { entered.resolve(); await finish.promise; } } });
  first.catch(() => {});
  await entered.promise;
  let secondSettled = false;
  const second = installOnnxArtifactClosure({ sourceGraph: path.join(source, 'model.onnx'), targetGraph: target });
  second.then(() => { secondSettled = true; }, () => { secondSettled = true; });
  try {
    await new Promise(resolve => setImmediate(resolve)); assert.equal(secondSettled, false);
    assert.equal(resolveInstalledOnnxPath(target), installed);
    assert.equal((await oldReader.run({})).Y.data[0], 1, 'open native reader retains its complete prior closure');
    finish.resolve();
    const results = await Promise.all([first, second]);
    assert.equal(results.filter(row => row.unchanged).length, 1);
    assert.equal(await readValue(resolveInstalledOnnxPath(target)), 2);
    assert.equal((await oldReader.run({})).Y.data[0], 1);
  } finally { finish.resolve(); await Promise.allSettled([first, second]); await oldReader.release(); }

  const selector = await fs.readFile(onnxSelectionPath(target));
  await fs.writeFile(path.join(source, 'model.onnx'), graphBytes(3));
  const open = fs.open;
  try {
    for (const code of ['EACCES', 'ENOSPC']) {
      let injected = false;
      fs.open = async (file, ...args) => {
        if (String(file).includes('.staging-') && args[0] === 'wx') {
          injected = true;
          if (code === 'EACCES') throw Object.assign(new Error('controlled staging permission failure'), { code });
          const handle = await open(file, ...args);
          handle.write = async () => { throw Object.assign(new Error('controlled staging disk full'), { code }); };
          return handle;
        }
        return open(file, ...args);
      };
      await assert.rejects(installOnnxArtifactClosure({ sourceGraph: path.join(source, 'model.onnx'), targetGraph: target }), { code });
      assert.equal(injected, true); assert.deepEqual(await fs.readFile(onnxSelectionPath(target)), selector);
      assert.equal(await readValue(resolveInstalledOnnxPath(target)), 2);
      fs.open = open;
    }
  } finally { fs.open = open; }
  assert.equal(await readValue((await installOnnxArtifactClosure({ sourceGraph: path.join(source, 'model.onnx'), targetGraph: target })).graphPath), 3);
  const unicode = await installOnnxArtifactClosure({ sourceGraph: path.join(source, 'model.onnx'),
    targetGraph: path.join(path.dirname(target), '雪 named.onnx') });
  assert.equal(await readValue(unicode.graphPath), 3, 'real Unicode graph paths preserve the same native handoff');
  const nested = path.join(source, 'tensor files/weights.custom'); await fs.mkdir(path.dirname(nested));
  await fs.writeFile(nested, floatBytes(4)); await fs.writeFile(path.join(source, 'model.onnx'), graphBytes(0, 'tensor files/weights.custom'));
  const external = await installOnnxArtifactClosure({ sourceGraph: path.join(source, 'model.onnx'), targetGraph: target });
  assert.equal(await readValue(external.graphPath), 4);
  if (process.platform === 'win32') {
    const receipt = readOnnxInstallationReceipt(path.dirname(external.graphPath));
    const legacyName = `${external.digest}-${randomUUID()}`, legacyRoot = path.join(`${target}.assets`, legacyName);
    for (const row of receipt.files) {
      const destination = path.join(legacyRoot, ...row.path.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(path.join(path.dirname(external.graphPath), ...row.path.split('/')), destination);
    }
    await fs.writeFile(path.join(legacyRoot, ONNX_INSTALLATION_RECEIPT), JSON.stringify(receipt));
    const oldGraph = path.join(legacyRoot, receipt.graph);
    assert.ok(path.join(legacyRoot, 'tensor files/weights.custom').length > 260,
      'negative retains the actual old-layout Windows native failure boundary');
    await fs.writeFile(onnxSelectionPath(target), JSON.stringify({ version: ONNX_INSTALLATION_VERSION, digest: external.digest,
      graph: `${path.basename(target)}.assets/${legacyName}/${receipt.graph}` }));
    assert.equal(resolveInstalledOnnxPath(target), oldGraph, 'old selector/receipt contracts already admit this complete layout');
    await assert.rejects(readValue(oldGraph), error => error.message.includes('External data path') && error.message.includes('does not exist'));
    const repaired = await installOnnxArtifactClosure({ sourceGraph: path.join(source, 'model.onnx'), targetGraph: target });
    assert.equal(repaired.unchanged, false); assert.equal(repaired.digest, external.digest);
    assert.equal(await readValue(repaired.graphPath), 4, 'corrected production layout loads the same verified external tensor bytes');
    assert.deepEqual(readOnnxInstallationReceipt(path.dirname(repaired.graphPath)), receipt);
    assert.equal((await fs.stat(oldGraph)).isFile(), true, 'repair retains old immutable generations');
    assert.deepEqual(await fs.readFile(path.join(legacyRoot, 'tensor files/weights.custom')), floatBytes(4));
    assert.equal((await installOnnxArtifactClosure({ sourceGraph: path.join(source, 'model.onnx'), targetGraph: target })).unchanged, true);
    const tooDeep = path.join(dir, 'deep-'.repeat(35), 'selected.onnx');
    await assert.rejects(installOnnxArtifactClosure({ sourceGraph: path.join(source, 'model.onnx'), targetGraph: tooDeep }),
      error => error.code === 'ERR_ONNX_NATIVE_PATH_LIMIT' && error.modelTarget === tooDeep
        && error.nativePathMember === 'selected.onnx' && error.nativePathMemberKind === 'graph');
    await assert.rejects(fs.stat(onnxSelectionPath(tooDeep)), { code: 'ENOENT' });
  }
  await fs.rm(nested);
  await assert.rejects(installOnnxArtifactClosure({ sourceGraph: path.join(source, 'model.onnx'), targetGraph: target }));
  assert.equal(await readValue(resolveInstalledOnnxPath(target)), 4, 'missing acquisition sidecar cannot damage the selected installation');
} finally {
  process.argv = originalArgv; hooks.deregister(); await fs.rm(dir, { recursive: true, force: true });
}
console.log('Controlled acquisition through the actual downloader, real one-thread ONNX loads, concurrent installers/readers and permission/disk-full boundaries passed.');
