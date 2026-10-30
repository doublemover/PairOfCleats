import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installOnnxArtifactClosure } from '../../../src/shared/onnx-model-install.js';
import { readOnnxInstallationReceipt, onnxSelectionPath } from '../../../src/shared/onnx-installation.js';
import { resolveOnnxModelPath } from '../../../src/shared/onnx-embeddings/config.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('onnx-installation-fault-ownership');
const field = (number, data) => { const bytes = Buffer.from(data); return Buffer.concat([Buffer.from([number * 8 + 2, bytes.length]), bytes]); };
const entry = (key, value) => field(13, Buffer.concat([field(1, key), field(2, value)]));
const graph = field(7, field(5, Buffer.concat([entry('location', 'nested/weights.custom'), entry('length', '4'), Buffer.from([112, 1])])));
const source = path.join(dir, 'source/model.onnx'), sidecar = path.join(dir, 'source/nested/weights.custom');
const target = path.join(dir, 'target/selected.onnx');
const originalRm = fs.rm, originalOpen = fs.open;
try {
  await fs.mkdir(path.dirname(sidecar), { recursive: true }); await fs.writeFile(source, graph); await fs.writeFile(sidecar, Buffer.alloc(4, 1));
  const first = await installOnnxArtifactClosure({ sourceGraph: source, targetGraph: target });
  const before = await fs.readFile(onnxSelectionPath(target));
  await fs.writeFile(sidecar, Buffer.alloc(4, 2));
  for (const phase of ['afterAsset', 'beforeSelection']) {
    const controller = new AbortController();
    await assert.rejects(installOnnxArtifactClosure({ sourceGraph: source, targetGraph: target, signal: controller.signal,
      hooks: { [phase]: () => controller.abort() } }), { name: 'AbortError' });
    assert.deepEqual(await fs.readFile(onnxSelectionPath(target)), before, 'cancellation leaves the previous complete selection intact');
    assert.deepEqual(await fs.readFile(path.join(path.dirname(first.graphPath), 'nested/weights.custom')), Buffer.alloc(4, 1));
  }
  const primary = Object.freeze(new Error('frozen model staging read failure'));
  const cleanup = Object.freeze(new Error('frozen staging directory cleanup failure'));
  fs.open = async (file, ...args) => {
    const handle = await originalOpen(file, ...args);
    if (String(file) === source && args[0] !== 'wx') {
      // Verification reads precede staging: fail only after a destination exists.
      const originalRead = handle.read.bind(handle);
      handle.read = async (...readArgs) => {
        const children = await fs.readdir(`${target}.assets`);
        if (children.some(name => name.startsWith('.staging-'))) throw primary;
        return originalRead(...readArgs);
      };
    }
    return handle;
  };
  fs.rm = async (file, ...args) => { if (String(file).includes('.staging-')) throw cleanup; return originalRm(file, ...args); };
  const failure = await installOnnxArtifactClosure({ sourceGraph: source, targetGraph: target })
    .then(() => assert.fail('expected staging failure'), error => error);
  const contains = (error, wanted) => error === wanted || error?.cause && contains(error.cause, wanted)
    || Array.isArray(error?.errors) && error.errors.some(child => contains(child, wanted));
  assert(contains(failure, primary)); assert(contains(failure, cleanup));
  assert.equal(primary.cleanupErrors, undefined); assert.equal(cleanup.cleanupErrors, undefined);
  assert.deepEqual(await fs.readFile(onnxSelectionPath(target)), before);
  fs.open = originalOpen; fs.rm = originalRm;
  for (const name of await fs.readdir(`${target}.assets`)) if (name.startsWith('.staging-')) {
    const stage = path.join(`${target}.assets`, name); assertNoSymlinkPath(`${target}.assets`, stage); await fs.rm(stage, { recursive: true });
  }
  const installed = await installOnnxArtifactClosure({ sourceGraph: source, targetGraph: target });
  assert.equal(resolveOnnxModelPath({ modelPath: target }), installed.graphPath);
  assert.equal((await installOnnxArtifactClosure({ sourceGraph: source, targetGraph: target })).unchanged, true);
  const receiptPath = path.join(path.dirname(installed.graphPath), '.pairofcleats-model-artifacts.json');
  const receipt = readOnnxInstallationReceipt(path.dirname(installed.graphPath)); receipt.files[0].sha256 = 'f'.repeat(64);
  await fs.writeFile(receiptPath, JSON.stringify(receipt));
  assert.throws(() => readOnnxInstallationReceipt(path.dirname(installed.graphPath)), /digest/);
} finally {
  fs.open = originalOpen; fs.rm = originalRm; await fs.rm(dir, { recursive: true, force: true });
}
console.log('ONNX cancellation, immutable selection, frozen cleanup and receipt identity controls authored; execution deferred.');
