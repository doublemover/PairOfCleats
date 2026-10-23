import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertNoSymlinkPath, readVerifiedContainedFileSync } from './contained-file.js';
import { describeStorageFailure } from './storage/failure-observation.js';

export const ONNX_INSTALLATION_VERSION = 1;
export const ONNX_INSTALLATION_RECEIPT = '.pairofcleats-model-artifacts.json';
export const onnxSelectionPath = target => `${target}.pairofcleats-model.json`;
export const safeOnnxRelativePath = value => typeof value === 'string' && value.length > 0 && value.length <= 4096
  && !/[\\:\u0000]/u.test(value) && !value.startsWith('/')
  && value.split('/').every(part => part && part !== '.' && part !== '..');

const readSmallJson = file => {
  const { buffer } = readVerifiedContainedFileSync(path.dirname(file), file, { maxBytes: 64 * 1024 });
  return JSON.parse(buffer.toString('utf8'));
};

/** A selector is admitted only after its immutable closure directory is closed
 * and verified. Older selected directories remain retained for active readers. */
export const resolveInstalledOnnxPath = target => {
  const selector = onnxSelectionPath(target);
  try { fs.lstatSync(selector); }
  catch (error) { if (describeStorageFailure(error, { phase: 'onnx-installed-selector' }).code === 'ENOENT') return null; throw error; }
  assertNoSymlinkPath(path.dirname(target), selector);
  const selection = readSmallJson(selector);
  const prefix = `${path.basename(target)}.assets/`;
  if (selection?.version !== ONNX_INSTALLATION_VERSION || !safeOnnxRelativePath(selection.graph)
    || !selection.graph.startsWith(prefix) || !/^[a-f0-9]{64}$/u.test(selection.digest || '')) {
    throw new Error('Invalid selected ONNX installation; rerun model acquisition.');
  }
  const graph = path.join(path.dirname(target), ...selection.graph.split('/'));
  assertNoSymlinkPath(path.dirname(target), graph);
  const installationRoot = path.dirname(graph);
  const receipt = readOnnxInstallationReceipt(installationRoot);
  if (!receipt || receipt.digest !== selection.digest || receipt.graph !== path.basename(graph)) {
    throw new Error('Selected ONNX installation has incomplete closure evidence.');
  }
  for (const entry of receipt.files) {
    const file = path.join(installationRoot, ...entry.path.split('/'));
    assertNoSymlinkPath(installationRoot, file);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size !== entry.bytes) throw new Error('Selected ONNX installation has missing or truncated bytes.');
    fs.accessSync(file, fs.constants.R_OK);
  }
  return graph;
};

export const readOnnxInstallationReceipt = root => {
  let receipt;
  try { receipt = readSmallJson(path.join(root, ONNX_INSTALLATION_RECEIPT)); }
  catch (error) { if (describeStorageFailure(error, { phase: 'onnx-installation-receipt' }).code === 'ENOENT') return null; throw error; }
  if (receipt?.version !== ONNX_INSTALLATION_VERSION || !safeOnnxRelativePath(receipt.graph)
    || receipt.graph.includes('/') || !/^[a-f0-9]{64}$/u.test(receipt.digest || '')
    || !Array.isArray(receipt.files) || !receipt.files.length || receipt.files.length > 128) throw new Error('Invalid ONNX closure receipt.');
  const seen = new Set();
  for (const row of receipt.files) {
    if (!safeOnnxRelativePath(row.path) || seen.has(row.path) || !Number.isSafeInteger(row.bytes) || row.bytes < 0
      || !/^[a-f0-9]{64}$/u.test(row.sha256 || '')) throw new Error('Invalid ONNX closure file identity.');
    seen.add(row.path);
  }
  if (!seen.has(receipt.graph)) throw new Error('ONNX closure receipt omits its graph.');
  const expectedDigest = createHash('sha256').update(JSON.stringify(receipt.files)).digest('hex');
  if (receipt.digest !== expectedDigest) throw new Error('ONNX closure receipt digest disagrees with its component identities.');
  return receipt;
};
