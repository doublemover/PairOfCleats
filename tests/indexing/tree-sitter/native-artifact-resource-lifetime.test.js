import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { applyTestEnv } from '../../helpers/test-env.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { fingerprintLoadedNativeArtifact } from '../../../src/lang/tree-sitter/native-artifact-identity.js';
import { getNativeTreeSitterParser, getNativeTreeSitterIdentity } from '../../../src/lang/tree-sitter/native-runtime.js';
import { attachNativeLeafProduct } from '../../../src/lang/tree-sitter/leaf-product.js';
import { buildTreeSitterChunks } from '../../../src/lang/tree-sitter.js';
import { parseTreeSitter } from '../../../src/lang/workers/tree-sitter-worker.js';

// UNVALIDATED. Real disposable descriptors exercise the core owner; external
// fixture teardown cannot supply a generation-bound settlement receipt.
applyTestEnv({ testing: '1' });
const original = { open: fs.openSync, close: fs.closeSync, read: fs.readSync, stat: fs.fstatSync };
const disposal = new Set();
const restore = () => {
  fs.openSync = original.open; fs.closeSync = original.close; fs.readSync = original.read; fs.fstatSync = original.stat;
};
const caught = action => {
  let failed = false, error;
  try { action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const closeFault = (target, action, result = undefined) => {
  let fd, closes = 0, reads = 0, stats = 0;
  const secondary = Object.freeze(new Error('original installed-artifact descriptor close failed'));
  fs.openSync = (file, ...args) => {
    const opened = original.open(file, ...args);
    if (fd === undefined && file === target) {
      fd = opened; disposal.add(fd);
      fs.readSync = () => assert.fail('descriptor read must use the method captured before open');
      fs.fstatSync = () => assert.fail('descriptor stat must use the method captured before open');
      fs.closeSync = () => assert.fail('descriptor close must use the method captured before open');
    }
    return opened;
  };
  fs.readSync = (opened, ...args) => { if (opened === fd) reads++; return original.read(opened, ...args); };
  fs.fstatSync = (opened, ...args) => { if (opened === fd) stats++; return original.stat(opened, ...args); };
  fs.closeSync = opened => {
    if (opened !== fd) return original.close(opened);
    closes++;
    if (result !== undefined) return result;
    throw secondary;
  };
  try {
    const failure = caught(action), session = getContainedFileSession(failure);
    assert.ok(session, 'actual core descriptor identity survives the advisory helper');
    assert.equal(closes, 1); assert.ok(reads > 0); assert.ok(stats >= 2);
    assert.equal(session.isSettled(), false); assert.equal(failure.cacheOwnershipReleased(), false);
    fs.closeSync = () => assert.fail('replacement global close must not be consulted');
    const retry = caught(() => session.releaseAfterCloseSync());
    assert.equal(getContainedFileSession(retry), session); assert.equal(closes, 1);
    // attach has its own advisory catch and must preserve the same real failure.
    const chunks = [{ start: 0, end: 1 }];
    const root = { get startIndex() { throw failure; } };
    assert.equal(caught(() => attachNativeLeafProduct({ chunks, text: 'x', root,
      languageId: 'javascript', parserIdentity: {} })), failure);
    original.close(fd); disposal.delete(fd);
    assert.equal(session.isSettled(), false, 'fixture disposal cannot qualify numeric descriptor generation');
    return failure;
  } finally { restore(); }
};
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-native-artifact-resource-'));
try {
  const metadata = path.join(root, 'package.json'), binary = path.join(root, 'binding.node');
  fs.writeFileSync(metadata, JSON.stringify({ name: 'fixture-native' }));
  fs.writeFileSync(binary, 'selected installed binding');
  const value = {}, binding = { filename: binary, exports: value, children: [] };
  const require = { cache: { binding }, resolve: () => path.join(root, 'index.js') };
  const fingerprint = () => fingerprintLoadedNativeArtifact({ require, value, moduleName: 'fixture-native' });
  for (const target of [metadata, binary]) closeFault(target, fingerprint);
  closeFault(binary, fingerprint, false);
  // A forged public property does not acquire the core owner's private identity.
  fs.readSync = () => { throw Object.assign(new Error('ordinary read failure'), { containedFileSession: {} }); };
  assert.equal(fingerprint(), null, 'ordinary unsupported identity retains advisory fallback');
  restore();

  const treeSitter = { enabled: true, strict: true, adaptive: false, chunkCache: false, languages: { javascript: true } };
  assert.ok(getNativeTreeSitterParser('javascript', { treeSitter }), 'prepared actual native runtime is required');
  const nativeText = 'function nativeOwner() { return 1; }';
  const build = () => buildTreeSitterChunks({ text: nativeText,
    languageId: 'javascript', ext: '.js', options: { treeSitter } });
  const nativeMetadata = path.join(path.dirname(createRequire(import.meta.url).resolve('tree-sitter')), 'package.json');
  let identityOpens = 0;
  fs.openSync = (file, ...args) => {
    if (file === nativeMetadata) { identityOpens++; throw new Error('optional worker identity read is forbidden'); }
    return original.open(file, ...args);
  };
  // Exercise the actual worker entrypoint in this process; no worker/IPC launch
  // is needed to prove its fixed capture exclusion and ordinary syntax result.
  const workerChunks = await parseTreeSitter({ text: nativeText,
    languageId: 'javascript', ext: '.js', treeSitter, captureNativeClassificationLeaves: true });
  assert.equal(identityOpens, 0);
  assert.ok(workerChunks.some(chunk => chunk.start === 0 && chunk.end === nativeText.length));
  assert.ok(workerChunks.every(chunk => !chunk.nativeClassificationLeaves));
  restore();
  const failure = closeFault(nativeMetadata, build);
  // The existing native identity state retains the failure rather than changing
  // a tried-but-failed fingerprint into a later ordinary null identity.
  assert.equal(caught(() => getNativeTreeSitterIdentity('javascript')), failure);
  assert.equal(caught(build), failure, 'withLeafProduct cannot hide pending closure on a subsequent parse');
} finally {
  restore();
  for (const fd of disposal) { try { original.close(fd); } catch {} }
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('native-artifact owned metadata/binding close faults and native owner propagation passed');
