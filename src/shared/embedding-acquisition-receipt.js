import path from 'node:path';
import { createHash } from 'node:crypto';
import { readVerifiedContainedFileSync, assertNoSymlinkPath } from './contained-file.js';
import { atomicWriteJson } from './io/atomic-write.js';
import { stableStringify } from './stable-json.js';
import { throwIfAborted } from './abort.js';
import { fingerprintOnnxFile, planOnnxArtifactClosure, verifyOnnxArtifactSnapshot } from './onnx-artifact-closure.js';
import { safeOnnxRelativePath } from './onnx-installation.js';
import { assertEmbeddingAcquisitionExport } from './embedding-acquisition-plan.js';

export const EMBEDDING_ACQUISITION_RECEIPT = '.pairofcleats-acquisition.json';
const REQUIRED = ['config.json', 'tokenizer.json', 'tokenizer_config.json'];
const invalid = message => Object.assign(new Error(message), { code: 'ERR_EMBEDDING_ACQUISITION' });
const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const admitFiles = files => {
  if (!Array.isArray(files) || !files.length || files.length > 128
    || files.some(file => !safeOnnxRelativePath(file)) || new Set(files).size !== files.length
    || !REQUIRED.every(file => files.includes(file)) || !files.some(file => file.endsWith('.onnx'))) {
    throw invalid('Selected model acquisition has invalid or incomplete components.');
  }
  return [...files].sort();
};

/** Receipt admission checks exact selected precision/revision and bounded paths.
 * Presence consumers inspect sizes/readability; runtime verifies opened bytes.
 */
export const readEmbeddingAcquisitionReceipt = (root, plan) => {
  const { buffer } = readVerifiedContainedFileSync(root, path.join(root, EMBEDDING_ACQUISITION_RECEIPT), { maxBytes: 64 * 1024 });
  const receipt = JSON.parse(buffer.toString('utf8'));
  const files = admitFiles(receipt.files);
  if (receipt.version !== 1 || stableStringify(receipt.plan) !== stableStringify(plan)
    || !Array.isArray(receipt.inventory) || receipt.inventory.length !== files.length
    || receipt.inventory.some((row, index) => row?.path !== files[index] || !Number.isSafeInteger(row.bytes)
      || row.bytes <= 0 || !/^[a-f0-9]{64}$/u.test(row.sha256 || ''))
    || receipt.digest !== digest({ plan: receipt.plan, inventory: receipt.inventory })) {
    throw invalid('Selected model acquisition receipt disagrees with its revision, precision or component identity.');
  }
  assertEmbeddingAcquisitionExport(plan, receipt.inventory);
  return { ...receipt, files };
};

/** Verify the loader-selected text closure before atomically exposing a receipt.
 * An interrupted prefetch cannot turn mere file existence into ready evidence.
 */
export const publishEmbeddingAcquisitionReceipt = async ({ root, plan, files, signal = null }) => {
  throwIfAborted(signal);
  if (!Array.isArray(files)) throw invalid('Selected model registry omitted its component list.');
  const selected = new Set(admitFiles([...new Set([...files, ...REQUIRED])]));
  if (plan.exportFiles && (plan.exportFiles.some(row => !selected.has(row.path))
    || [...selected].filter(file => file.startsWith('onnx/')).length !== plan.exportFiles.length)) {
    throw invalid('Selected model registry disagrees with its qualified graph and external-data declaration.');
  }
  const verified = new Map(), observed = [];
  for (const file of [...selected]) {
    throwIfAborted(signal);
    if (!file.endsWith('.onnx')) continue;
    const closure = await planOnnxArtifactClosure(path.join(root, ...file.split('/')), path.posix.basename(file), { signal });
    for (const row of closure.files) {
      const name = path.posix.join(path.posix.dirname(file), row.path);
      selected.add(name); verified.set(name, row);
    }
    observed.push(...closure.observed);
  }
  const required = admitFiles([...selected]), inventory = [];
  for (const file of required) {
    throwIfAborted(signal);
    const filePath = path.join(root, ...file.split('/'));
    const identity = verified.get(file) || await fingerprintOnnxFile(root, filePath, { signal });
    if (!verified.has(file)) observed.push({ root, file: filePath, stat: identity.sourceStat });
    if (!identity.bytes) throw invalid('Selected acquisition contains an empty component.');
    inventory.push({ path: file, bytes: identity.bytes, sha256: identity.sha256 });
  }
  assertEmbeddingAcquisitionExport(plan, inventory);
  const receipt = { version: 1, plan, files: required, inventory, digest: digest({ plan, inventory }) };
  if (Buffer.byteLength(JSON.stringify(receipt)) > 64 * 1024) throw invalid('Selected model acquisition receipt exceeds its byte bound.');
  await verifyOnnxArtifactSnapshot(observed, { signal });
  throwIfAborted(signal);
  assertNoSymlinkPath(root, path.join(root, EMBEDDING_ACQUISITION_RECEIPT), { allowMissing: true });
  await atomicWriteJson(path.join(root, EMBEDDING_ACQUISITION_RECEIPT), receipt, { durable: true, signal });
  return receipt;
};
