import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { loadIncrementalState } from '../../../src/index/build/incremental/planning.js';
import { encodeIncrementalManifest } from '../../../src/index/build/incremental/manifest-codec.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir: root } = await prepareIsolatedTestCacheDir('manifest-observation-preservation');
const original = { stat: fs.stat, open: fs.open, rename: fs.rename, access: fs.access };
const originalFstat = fsSync.fstatSync;
const contains = (value, wanted, seen = new Set()) => {
  if (value === wanted) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return contains(value.cause, wanted, seen) || (value.errors || []).some(error => contains(error, wanted, seen));
};
const restore = () => { for (const [key, value] of Object.entries(original)) fs[key] = value; fsSync.fstatSync = originalFstat; };
const load = log => loadIncrementalState({ repoRoot: root, repoCacheRoot: root, mode: 'code', enabled: true, log });
let releaseDiagnostic = () => {};
try {
  const initial = await load();
  initial.manifest.files['source.js'] = { hash: 'a'.repeat(40), size: 10, mtimeMs: 123.25, bundles: [] };
  const valid = encodeIncrementalManifest(initial.manifest), filename = initial.manifestPath;
  const selected = value => typeof value === 'string' && path.resolve(value).toLowerCase() === filename.toLowerCase();
  const quarantines = async () => (await fs.readdir(initial.incrementalDir)).filter(name => name.startsWith('manifest.json.corrupt-'));
  await fs.writeFile(filename, valid);
  let accessCalls = 0;
  fs.access = async (...args) => { if (selected(args[0])) { accessCalls++; throw new Error('redundant manifest preflight'); } return original.access(...args); };
  assert.ok((await load()).manifest.files['source.js']); assert.equal(accessCalls, 0, 'the healthy owner performs one read without an existence preflight');
  restore();
  for (const phase of ['stat', 'open', 'read', 'descriptor-stat']) for (const code of ['EIO', 'EMFILE', 'ENOMEM', 'EACCES', 'EPERM']) {
    const failure = Object.freeze(Object.assign(new Error(`${phase}:${code}`), { code }));
    let armed = true, closes = 0, selectedFd = null;
    if (phase === 'stat') fs.stat = async (...args) => {
      if (selected(args[0]) && armed) { armed = false; throw failure; } return original.stat(...args);
    };
    else fs.open = async (...args) => {
      if (phase === 'open' && selected(args[0]) && armed) { armed = false; throw failure; }
      const handle = await original.open(...args);
      if (selected(args[0]) && armed) {
        selectedFd = handle.fd;
        const operation = handle.read.bind(handle), close = handle.close.bind(handle);
        if (phase === 'read') handle.read = async (...parameters) => { if (armed) { armed = false; throw failure; } return operation(...parameters); };
        handle.close = async () => { const result = await close(); closes++; return result; };
      }
      return handle;
    };
    if (phase === 'descriptor-stat') fsSync.fstatSync = (fd, ...args) => {
      if (fd === selectedFd && armed) { armed = false; throw failure; } return originalFstat(fd, ...args);
    };
    const logs = [];
    await assert.rejects(load(value => logs.push(value)), error => contains(error, failure), `${phase}:${code}`);
    restore();
    assert.equal(armed, false, 'the actual owner exercised the selected failure boundary');
    if (['read', 'descriptor-stat'].includes(phase)) assert.equal(closes, 1, 'the original descriptor closes before failure propagation');
    assert.equal(await fs.readFile(filename, 'utf8'), valid);
    assert.deepEqual(await quarantines(), []); assert.deepEqual(logs, []);
    assert.ok((await load()).manifest.files['source.js'], 'a healthy retry retains the original reusable entry');
  }
  const forged = Object.freeze(Object.assign(new TypeError('operational error with misleading parse code'), { code: 'ERR_INCREMENTAL_JSON_PARSE' }));
  fs.stat = async (...args) => { if (selected(args[0])) throw forged; return original.stat(...args); };
  await assert.rejects(load(), error => error === forged); restore();
  assert.equal(await fs.readFile(filename, 'utf8'), valid); assert.deepEqual(await quarantines(), []);

  const malformed = '{"broken":';
  await fs.writeFile(filename, malformed);
  const firstLogs = [], recovered = await load(value => firstLogs.push(value));
  assert.deepEqual(recovered.manifest.files, {});
  assert.equal((await quarantines()).length, 1);
  assert.equal(await fs.readFile(path.join(initial.incrementalDir, (await quarantines())[0]), 'utf8'), malformed);
  assert.ok(firstLogs.some(value => value.includes('quarantined code incremental manifest')));
  await assert.rejects(fs.stat(filename), { code: 'ENOENT' });
  const invalid = JSON.parse(valid); invalid.dependencyTable = 'not a compact table';
  await fs.writeFile(filename, JSON.stringify(invalid));
  assert.deepEqual((await load()).manifest.files, {});
  assert.equal((await quarantines()).length, 2, 'proved compact-content corruption has a distinct retained receipt');

  await fs.writeFile(filename, malformed);
  const before = await quarantines(), renameFailure = Object.freeze(Object.assign(new Error('rename refused'), { code: 'EPERM' }));
  fs.rename = async (...args) => { if (selected(args[0])) throw renameFailure; return original.rename(...args); };
  await assert.rejects(load(), error => error.code === 'ERR_INCREMENTAL_JSON_PARSE' && contains(error, renameFailure)); restore();
  assert.equal(await fs.readFile(filename, 'utf8'), malformed); assert.deepEqual(await quarantines(), before);
  await assert.rejects(load(value => { if (value.includes('cache manifest read failed')) fsSync.writeFileSync(filename, valid); }),
    error => error.code === 'ERR_INCREMENTAL_JSON_PARSE', 'a changed snapshot is not quarantined under the old corruption proof');
  assert.equal(await fs.readFile(filename, 'utf8'), valid); assert.deepEqual(await quarantines(), before);
  assert.ok((await load()).manifest.files['source.js']);

  await fs.writeFile(filename, malformed);
  let diagnosticSettled = false;
  const diagnostic = Object.freeze(Object.assign(new Error('quarantine diagnostic owns a pending child'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => diagnosticSettled
  }));
  releaseDiagnostic = () => { diagnosticSettled = true; };
  let retained;
  await assert.rejects(load(value => { if (value.includes('quarantined')) throw diagnostic; }), error => {
    retained = error; return error.code === 'ERR_INCREMENTAL_JSON_PARSE' && contains(error, diagnostic);
  });
  assert.equal(retained.cacheOwnershipReleased(), false);
  assert.equal((await quarantines()).length, before.length + 1);
  await assert.rejects(fs.stat(filename), { code: 'ENOENT' });
  releaseDiagnostic(); assert.equal(retained.cacheOwnershipReleased(), true);
  assert.deepEqual((await load()).manifest.files, {}, 'actual absence remains an ordinary fresh-state result');
} finally { releaseDiagnostic(); restore(); await fs.rm(root, { recursive: true, force: true }); }
console.log('Incremental manifests survive observation failures; only owned read/content corruption may quarantine');
