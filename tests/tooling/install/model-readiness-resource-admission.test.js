// Actual readiness and first-search consumers; authored UNRUN in the source wave.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveModelSetupReadiness } from '../../../tools/setup/model-readiness.js';
import { createFirstSearchPlan, applyFirstSearchPlan } from '../../../tools/setup/first-search-plan.js';
import { resolveEmbeddingAcquisitionPlan, EMBEDDING_ACQUISITION_RECEIPT } from '../../../src/shared/embedding-model-loading.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'poc-model-readiness-admission-'));
const repo = path.join(root, 'project'), models = path.join(root, 'models'), modelId = 'fixture/selected';
const selected = path.join(models, modelId), weights = path.join(selected, 'onnx', 'model_quantized.onnx');
const receiptPath = path.join(selected, EMBEDDING_ACQUISITION_RECEIPT);
const stat = fs.statSync, access = fs.accessSync, lstat = fs.lstatSync, open = fs.openSync, read = fs.readSync, close = fs.closeSync;
const disposable = new Set();
const samePath = (left, right) => typeof left === 'string' && path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
const resolve = options => resolveModelSetupReadiness({ root: repo, modelConfig: { id: modelId, dir: models }, ...options });
const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: null, extraEnv: { PAIROFCLEATS_MODELS_DIR: models } });
try {
  await fsp.mkdir(repo);
  const files = { 'config.json': '{}', 'tokenizer.json': '{}', 'tokenizer_config.json': '{}', 'onnx/model_quantized.onnx': 'selected graph bytes' };
  for (const [name, bytes] of Object.entries(files)) {
    await fsp.mkdir(path.dirname(path.join(selected, name)), { recursive: true });
    await fsp.writeFile(path.join(selected, name), bytes);
  }
  await fsp.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({ models: { id: modelId, dir: models } }));
  const before = await fsp.readFile(path.join(repo, '.pairofcleats.json'));
  const calls = new Map();
  fs.statSync = (file, ...args) => { calls.set(file, (calls.get(file) || 0) + 1); return stat(file, ...args); };
  assert.equal(resolve().present, true);
  for (const name of Object.keys(files)) assert.equal(calls.get(path.join(selected, name)), 1,
    'one presence observation per selected file; final report does not re-admit native inspections');
  fs.statSync = stat;

  const approved = await createFirstSearchPlan({ repoRoot: repo, profile: 'semantic', model: modelId });
  for (const boundary of ['stat', 'access', 'receipt-presence']) {
    let settled = false, failure, downstream = 0;
    const original = Object.freeze(Object.assign(new Error(`unresolved ${boundary}`), {
      code: 'ENOENT', cacheOwnershipReleased() { assert.equal(this, original); return settled; }
    }));
    fs.statSync = (file, ...args) => {
      if (boundary === 'stat' && samePath(file, weights)) throw original;
      return stat(file, ...args);
    };
    fs.accessSync = (file, ...args) => {
      downstream += 1;
      if (boundary === 'access' && samePath(file, weights)) throw original;
      return access(file, ...args);
    };
    fs.lstatSync = (file, ...args) => {
      if (boundary === 'receipt-presence' && samePath(file, receiptPath)) throw original;
      return lstat(file, ...args);
    };
    assert.throws(() => resolve(), error => { failure = error; return error.cacheOwnershipPending === true; });
    assert.equal(failure.cacheOwnershipReleased(), false, 'an ENOENT label cannot settle the original callback');
    assert.equal(downstream, boundary === 'access' ? 1 : 0);
    let executed = 0;
    await assert.rejects(applyFirstSearchPlan(approved, { execute: () => { executed += 1; return { ok: true, status: 0 }; } }),
      error => error.cacheOwnershipPending === true);
    assert.equal(executed, 0);
    assert.deepEqual(await fsp.readFile(path.join(repo, '.pairofcleats.json')), before);
    await assert.rejects(fsp.stat(path.join(repo, '.pairofcleats.json.setup-lock')), { code: 'ENOENT' });
    settled = true;
    assert.equal(failure.cacheOwnershipReleased(), true);
    fs.statSync = stat; fs.accessSync = access; fs.lstatSync = lstat;
  }
  const denied = Object.assign(new Error('selected weights are unreadable'), { code: 'EACCES' });
  fs.accessSync = (file, ...args) => { if (samePath(file, weights)) throw denied; return access(file, ...args); };
  assert.throws(() => resolve(), error => error === denied);
  await assert.rejects(createFirstSearchPlan({ repoRoot: repo, profile: 'semantic', model: modelId }), error => error === denied,
    'an inaccessible selected file must not create a model download operation');
  fs.accessSync = access;

  const plan = resolveEmbeddingAcquisitionPlan(modelId);
  const inventory = Object.entries(files).map(([name, bytes]) => ({ path: name, bytes: Buffer.byteLength(bytes),
    sha256: createHash('sha256').update(bytes).digest('hex') })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  await fsp.writeFile(receiptPath, JSON.stringify({ version: 1, plan, files: inventory.map(row => row.path), inventory,
    digest: digest({ plan, inventory }) }));
  assert.equal(resolve().present, true);
  let settled = false, selectedFd = null, closes = 0, failure;
  const original = Object.freeze(Object.assign(new Error('receipt reader remains borrowed'), {
    cacheOwnershipReleased() { assert.equal(this, original); return settled; }
  }));
  fs.openSync = (file, ...args) => {
    const fd = open(file, ...args);
    if (samePath(file, receiptPath)) { selectedFd = fd; disposable.add(fd); }
    return fd;
  };
  fs.readSync = (fd, ...args) => { if (fd === selectedFd) throw original; return read(fd, ...args); };
  fs.closeSync = fd => { if (fd === selectedFd) closes += 1; const result = close(fd); disposable.delete(fd); return result; };
  assert.throws(() => resolve(), error => { failure = error; return error.cacheOwnershipPending === true; });
  const session = getContainedFileSession(failure);
  assert.ok(session);
  assert.equal(closes, 0);
  settled = true; session.releaseAfterCloseSync();
  assert.equal(closes, 1); assert.equal(failure.cacheOwnershipReleased(), true);
  fs.openSync = open; fs.readSync = read; fs.closeSync = close;

  const controller = new AbortController();
  let inspected = 0;
  fs.statSync = (file, ...args) => {
    const result = stat(file, ...args);
    if (samePath(file, path.join(selected, 'config.json'))) { inspected += 1; controller.abort(); }
    return result;
  };
  assert.throws(() => resolve({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(inspected, 1);
} finally {
  fs.statSync = stat; fs.accessSync = access; fs.lstatSync = lstat; fs.openSync = open; fs.readSync = read; fs.closeSync = close;
  for (const fd of disposable) { try { close(fd); } catch {} }
  await fsp.rm(root, { recursive: true, force: true });
}
console.log('Model readiness retains original asset/receipt observations and blocks new download admission.');
