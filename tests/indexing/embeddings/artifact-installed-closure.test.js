import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InferenceSession } from 'onnxruntime-node';
import { encodeField as field } from '../../../tools/history/eg2-qualify-graph.js';
import { installOnnxArtifactClosure } from '../../../src/shared/onnx-model-install.js';
import { acquireEmbeddingArtifactLease, getEmbeddingArtifactLeaseMetrics } from '../../../src/shared/embedding-artifact-lease.js';

const join = (...values) => Buffer.concat(values), text = (id, value) => field(id, 2, value);
const entry = (key, value) => text(13, join(text(1, key), text(2, value)));
const tensor = join(field(1, 0, 1), field(2, 0, 1), text(8, 'W'), entry('location', 'nested/weights.custom'),
  entry('offset', '0'), entry('length', '4'), field(14, 0, 1));
const shape = text(2, text(1, field(1, 0, 1)));
const output = join(text(1, 'Y'), text(2, text(1, join(field(1, 0, 1), shape))));
const graph = text(7, join(text(1, join(text(1, 'W'), text(2, 'Y'), text(4, 'Identity'))),
  text(2, 'selected-closure'), text(5, tensor), text(12, output)));
const graphBytes = join(field(1, 0, 8), graph, text(8, field(2, 0, 13)));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-al-'));
let session, lease;
try {
  const source = path.join(root, 'source'), target = path.join(root, 'selected/model.onnx');
  const modelsDir = path.join(root, 'models'), tokenizerRoot = path.join(modelsDir, 'fixture/tokenizer');
  await fs.mkdir(path.join(source, 'nested'), { recursive: true });
  await fs.writeFile(path.join(source, 'model.onnx'), graphBytes);
  await fs.writeFile(path.join(source, 'nested/weights.custom'), Buffer.from(new Float32Array([7]).buffer));
  await fs.mkdir(tokenizerRoot, { recursive: true }); await fs.writeFile(path.join(tokenizerRoot, 'tokenizer.json'), '{}');
  const installed = await installOnnxArtifactClosure({ sourceGraph: path.join(source, 'model.onnx'), targetGraph: target });
  await fs.writeFile(path.join(path.dirname(installed.graphPath), 'unused.onnx'), 'malformed unselected sibling');
  const options = { provider: 'onnx', modelId: 'fixture/tokenizer', modelsDir,
    onnx: { modelPath: target, tokenizerId: 'fixture/tokenizer' } };
  const before = getEmbeddingArtifactLeaseMetrics();
  lease = await acquireEmbeddingArtifactLease(options);
  assert.equal(lease.selectedModelPath, installed.graphPath);
  assert.deepEqual(lease.artifact.inventory.map(row => row.path),
    ['weights/model.onnx', 'weights/nested/weights.custom', 'tokenizer/tokenizer.json'].sort());
  assert.equal(getEmbeddingArtifactLeaseMetrics().bytesHashed - before.bytesHashed, graphBytes.length + 4 + 2);
  session = await InferenceSession.create(lease.selectedModelPath);
  assert.equal((await session.run({})).Y.data[0], 7, 'the real native loader reads the exact installed external tensor');
  await lease.verifyLoaded();
  await session.release(); session = null;
  const data = path.join(path.dirname(installed.graphPath), 'nested/weights.custom'), stat = await fs.stat(data);
  await fs.writeFile(data, Buffer.from(new Float32Array([8]).buffer)); await fs.utimes(data, stat.atime, stat.mtime);
  await assert.rejects(lease.verifyLoaded(), { code: 'ERR_ONNX_ARTIFACT_INTEGRITY' });
} finally {
  if (session) await session.release(); lease?.release(); await fs.rm(root, { recursive: true, force: true });
}
console.log('Actual ONNX selected closure includes arbitrary external data and selected tokenizer, excludes unused graphs and rejects preserved-mtime mutation.');
