import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { fingerprintOnnxFile, verifyOnnxArtifactSnapshot } from '../../../src/shared/onnx-artifact-closure.js';

/** Resolve only; never require a native addon or initialize a session. Actual
 * qualification calls this after provider import and requires its original
 * binding's CommonJS module-cache loaded witness as separate evidence.
 */
export const captureEmbeddingProviderRuntime = async ({ provider, root = process.cwd(), signal = null }) => {
  assert.ok(['xenova', 'onnx'].includes(provider));
  const transformerEntry = fileURLToPath(import.meta.resolve('@huggingface/transformers'));
  const base = provider === 'xenova' ? transformerEntry : fileURLToPath(new URL('../../../src/shared/onnx-embeddings.js', import.meta.url));
  const actualRequire = createRequire(base), entry = actualRequire.resolve('onnxruntime-node');
  const packageRoot = path.dirname(path.dirname(entry));
  const relative = file => {
    const value = path.relative(root, file).split(path.sep).join('/');
    assert.ok(value && value !== '..' && !value.startsWith('../') && !path.isAbsolute(value), 'Native provenance must remain in the authorized checkout.');
    return value;
  };
  const manifestPath = path.join(packageRoot, 'package.json');
  const manifestRead = await readVerifiedContainedFile(packageRoot, manifestPath, { maxBytes: 65536, hashAlgorithm: 'sha256', signal });
  const metadata = JSON.parse(manifestRead.buffer.toString('utf8'));
  assert.equal(metadata.name, 'onnxruntime-node'); assert.deepEqual(metadata.binary.napi_versions, [6]);
  const bindingLoader = path.join(path.dirname(entry), 'binding.js');
  const loaderRead = await readVerifiedContainedFile(packageRoot, bindingLoader, { maxBytes: 65536, signal });
  assert.ok(loaderRead.buffer.toString('utf8').includes('../bin/napi-v6/${process.platform}/${process.arch}/onnxruntime_binding.node'),
    'A changed native loader needs explicit provenance qualification.');
  const bindingDirectory = path.join(packageRoot, 'bin', 'napi-v6', process.platform, process.arch);
  const bindingPath = path.join(bindingDirectory, 'onnxruntime_binding.node');
  const files = await fs.readdir(bindingDirectory, { withFileTypes: true });
  assert.ok(files.length <= 32, 'Bound the packaged native provenance inventory.');
  const nativeFiles = files.filter(row => row.isFile() && /(?:\.node|\.dll|\.dylib|\.so(?:\.\d+)*)$/i.test(row.name))
    .map(row => path.join(bindingDirectory, row.name)).sort();
  assert.ok(nativeFiles.includes(bindingPath));
  const observed = [];
  const inspect = async file => {
    assert.ok((await fs.stat(file)).size <= 256 * 1024 * 1024, 'Native provenance file exceeds its qualification bound.');
    const value = await fingerprintOnnxFile(packageRoot, file, { signal });
    assert.ok(value.bytes <= 256 * 1024 * 1024);
    observed.push({ root: packageRoot, file, stat: value.sourceStat });
    return { path: relative(file), bytes: value.bytes, sha256: value.sha256 };
  };
  const entryIdentity = await inspect(entry), loaderIdentity = await inspect(bindingLoader), packageIdentity = await inspect(manifestPath);
  assert.equal(packageIdentity.sha256, manifestRead.hash, 'The resolved package changed during provenance acquisition.');
  assert.equal(loaderIdentity.sha256, loaderRead.hash, 'The original native loader changed during provenance acquisition.');
  const binaries = [];
  for (const file of nativeFiles) binaries.push(await inspect(file));
  await verifyOnnxArtifactSnapshot(observed, { signal });
  const binding = binaries.find(row => row.path === relative(bindingPath));
  return { schemaVersion: 1, provider, name: metadata.name, version: metadata.version,
    resolutionBase: relative(base), entry: entryIdentity, package: packageIdentity, bindingLoader: loaderIdentity,
    binding: { ...binding, moduleCacheLoaded: actualRequire.cache[bindingPath]?.loaded === true },
    packagedLibraries: binaries.filter(row => row !== binding),
    scope: 'Provider-resolved package/entry/original addon bytes;module-cache witness records addon loading only. Packaged library hashes do not attest OS DLL mappings, provider selection, kernels or native unload.' };
};
