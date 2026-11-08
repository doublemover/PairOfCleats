import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { resolveEmbeddingArtifactIdentity, assertEmbeddingArtifactCompatibility } from '../../../src/shared/embedding-artifact-identity.js';
import { acquireEmbeddingArtifactLease, getEmbeddingArtifactLeaseMetrics } from '../../../src/shared/embedding-artifact-lease.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/embeddings/artifact-inventory-authority/')[1];
const [, scenario, arm] = selected?.match(/^(.*)-(sync|async)$/) || [];
assert.ok(['graph-link', 'tokenizer-link', 'route-link', 'root-link', 'non-file', 'late-member', 'shadow', 'external-data'].includes(scenario));
const { dir } = await prepareIsolatedTestCacheDir(`artifact-inventory-${selected}`);
const modelsDir = path.join(dir, 'cache'), modelRoot = path.join(modelsDir, 'fixture/model');
const graph = path.join(modelRoot, 'onnx/model.onnx'), tokenizer = path.join(modelRoot, 'tokenizer.json');
await fs.mkdir(path.dirname(graph), { recursive: true });
await fs.writeFile(graph, 'bounded graph bytes'); await fs.writeFile(tokenizer, '{"vocab":"A"}');
await fs.writeFile(path.join(modelRoot, 'vocab.txt'), 'fallback tokenizer');
let options = { provider: 'xenova', modelId: 'fixture/model', modelsDir };
const original = { readdir: fsSync.readdirSync, lstat: fsSync.lstatSync, open: fs.open, openSync: fsSync.openSync };
const oldCwd = process.cwd();
const identify = async () => {
  if (arm === 'sync') return resolveEmbeddingArtifactIdentity(options);
  const lease = await acquireEmbeddingArtifactLease(options);
  try { return lease.artifact; } finally { lease.release(); }
};
try {
  assert.equal((await identify()).status, 'verified', 'the same real ordinary inventory is a positive control');
  if (scenario === 'shadow') {
    process.chdir(dir);
    const local = 'local/vendor/model', direct = path.join(dir, local), shadow = path.join(modelsDir, local);
    await fs.mkdir(path.join(direct, 'onnx'), { recursive: true });
    await fs.writeFile(path.join(direct, 'onnx/model.onnx'), 'direct graph');
    await fs.writeFile(path.join(direct, 'tokenizer.json'), '{}');
    options = { ...options, modelId: local };
    assert.equal((await identify()).status, 'verified');
    await fs.mkdir(shadow, { recursive: true });
    await fs.writeFile(path.join(shadow, 'tokenizer.json'), '{"shadow":true}');
    const ambiguous = await identify();
    assert.equal(ambiguous.status, 'unknown'); assert.equal(ambiguous.reuse, 'refuse');
  } else if (scenario === 'external-data') {
    const data = path.join(modelRoot, 'onnx/weights.data');
    await fs.writeFile(data, 'external-data-A');
    const first = await identify(), stat = await fs.stat(data);
    await fs.writeFile(data, 'external-data-B'); await fs.utimes(data, stat.atime, stat.mtime);
    const second = await identify();
    assert.equal(second.status, 'verified'); assert.notEqual(first.digest, second.digest);
    assert.ok(second.inventory.some(row => row.path === 'onnx/weights.data'));
    assert.throws(() => assertEmbeddingArtifactCompatibility(first, second), { code: 'ERR_EMBEDDING_ARTIFACT_INCOMPATIBLE' });
  } else if (scenario === 'late-member') {
    let changed = false;
    const add = () => { if (!changed) { changed = true; fsSync.writeFileSync(path.join(modelRoot, 'onnx/model_quantized.onnx'), 'new selected graph'); } };
    if (arm === 'sync') fsSync.openSync = function (file, ...args) {
      const fd = original.openSync.call(this, file, ...args); if (String(file) === graph) add(); return fd;
    };
    else fs.open = async function (file, ...args) {
      const handle = await original.open.call(this, file, ...args); if (String(file) === graph) add(); return handle;
    };
    await assert.rejects(identify(), { code: 'ERR_EMBEDDING_ARTIFACT_CHANGED' });
    assert.equal(changed, true, 'the real graph namespace changed during opened-byte verification');
  } else {
    if (scenario === 'non-file') await fs.mkdir(path.join(modelRoot, 'onnx/preferred.onnx'));
    if (scenario === 'graph-link') await fs.writeFile(path.join(modelRoot, 'onnx/model_quantized.onnx'), 'preferred candidate');
    if (scenario === 'route-link') await fs.writeFile(path.join(modelRoot, 'model.onnx'), 'sibling fallback');
    // Inject only the native directory/stat admission result. Actual ordinary
    // files, their hashes and descriptor owners remain real; no symlink is made.
    const linked = scenario === 'graph-link' ? path.join(modelRoot, 'onnx/model_quantized.onnx')
      : scenario === 'tokenizer-link' ? tokenizer : path.join(modelRoot, 'onnx');
    if (scenario.endsWith('link') && scenario !== 'root-link') fsSync.readdirSync = function (directory, ...args) {
      return original.readdir.call(this, directory, ...args).map(entry => {
        if (path.join(String(directory), entry.name) !== linked) return entry;
        return { name: entry.name, isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false };
      });
    };
    if (scenario === 'root-link') fsSync.lstatSync = function (file, ...args) {
      const stat = original.lstat.call(this, file, ...args);
      return String(file) === modelRoot ? Object.assign(Object.create(stat), { isSymbolicLink: () => true }) : stat;
    };
    const before = getEmbeddingArtifactLeaseMetrics();
    await assert.rejects(identify(), { code: 'ERR_UNSAFE_FILE_PATH' });
    assert.equal(getEmbeddingArtifactLeaseMetrics().bytesHashed, before.bytesHashed, 'ambiguous candidates cannot authorize sibling hashing');
  }
} finally {
  fsSync.readdirSync = original.readdir; fsSync.lstatSync = original.lstat;
  fs.open = original.open; fsSync.openSync = original.openSync;
  process.chdir(oldCwd); await fs.rm(dir, { recursive: true, force: true });
}
console.log(`Artifact inventory ${selected} retains exact selection and refuses ambiguous authority.`);
