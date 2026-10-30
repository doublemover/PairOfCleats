import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { captureEmbeddingProviderRuntime } from './helpers/provider-runtime-provenance.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();
// Real installed resolution and opened bytes only: no addon require, model,
// inference, session, synthetic package tree or optional dependency fallback.
const hfEntry = fileURLToPath(import.meta.resolve('@huggingface/transformers'));
const hfRequire = createRequire(hfEntry), rootRequire = createRequire(import.meta.url);
const actualHfEntry = hfRequire.resolve('onnxruntime-node'), actualRootEntry = rootRequire.resolve('onnxruntime-node');
assert.notEqual(actualHfEntry, actualRootEntry, 'The locked nested and root versions are a discriminating original installation.');
const before = new Set(Object.keys(rootRequire.cache));
const nested = await captureEmbeddingProviderRuntime({ provider: 'xenova' });
const direct = await captureEmbeddingProviderRuntime({ provider: 'onnx' });
assert.equal(nested.version, '1.30.0'); assert.equal(direct.version, '1.31.1');
assert.equal(path.resolve(nested.entry.path), actualHfEntry); assert.equal(path.resolve(direct.entry.path), actualRootEntry);
assert.equal(nested.binding.moduleCacheLoaded, false); assert.equal(direct.binding.moduleCacheLoaded, false);
assert.deepEqual(new Set(Object.keys(rootRequire.cache)), before, 'Metadata acquisition must not load either original native addon.');
for (const receipt of [nested, direct]) {
  assert.match(receipt.binding.path, /\/bin\/napi-v6\//);
  const actual = await fs.readFile(path.resolve(receipt.binding.path));
  assert.equal(actual.length, receipt.binding.bytes);
  assert.equal(createHash('sha256').update(actual).digest('hex'), receipt.binding.sha256);
  assert.ok(receipt.packagedLibraries.length > 0);
  assert(receipt.packagedLibraries.every(row => row.bytes > 0 && /^[a-f0-9]{64}$/.test(row.sha256)));
}
assert.notEqual(nested.binding.sha256, direct.binding.sha256, 'Different installed addon bytes cannot share a package-only identity.');
console.log('Real provider-resolved native metadata differs from root installation;no native addon or model was loaded.');
