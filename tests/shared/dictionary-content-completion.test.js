import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadDictionaryFileSnapshots, loadDictionaryWordSetFromFiles, loadCodeDictionaryWordSets } from '../../src/shared/dictionary-wordlists.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { registerDictionaryStorageRoot, dictionaryStorageCoordinationRoot } from '../../src/shared/storage/dictionary-access.js';
import { inspectStorageAccess } from '../../src/shared/storage/access.js';

const { dir } = await prepareIsolatedTestCacheDir('dictionary-content-completion');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), extraEnv: { PAIROFCLEATS_HOME: path.join(dir, 'home') } });
registerDictionaryStorageRoot(dir);
const bad = path.join(dir, 'bad.txt'), good = path.join(dir, 'good.txt'), missing = path.join(dir, 'missing.txt');
await fs.writeFile(bad, 'alpha\nbeta\n'); await fs.writeFile(good, 'BRAVO\nCAFÉ\n');
const open = fs.open;
let behavior = null, active = 0, maximum = 0;
const contains = (value, expected, seen = new Set()) => value === expected || Boolean(value && typeof value === 'object'
  && !seen.has(value) && (seen.add(value), [value.cause, ...(value.errors || [])].some(error => contains(error, expected, seen))));
try {
  fs.open = async (file, ...args) => {
    const selected = behavior;
    if (path.relative(String(file), bad) === '' && selected?.phase === 'open') throw selected.error;
    const handle = await open.call(fs, file, ...args), read = handle.read, close = handle.close;
    const tracked = typeof file === 'string' && file.endsWith('.txt');
    if (tracked) { active++; maximum = Math.max(maximum, active); } let calls = 0;
    if (path.relative(String(file), bad) === '' && selected?.phase === 'read') handle.read = async function (buffer, offset, length, position) {
      if (calls++ === 0) return read.call(this, buffer, offset, Math.min(length, 6), position);
      await new Promise(resolve => setImmediate(resolve)); throw selected.error;
    };
    handle.close = async function () {
      if (path.relative(String(file), bad) === '' && selected?.phase === 'gated-close') {
        selected.entered(); await selected.gate;
      }
      try { await close.call(this); } finally { if (tracked) active--; }
      if (path.relative(String(file), bad) === '' && selected?.phase === 'close') throw selected.error;
    };
    return handle;
  };
  for (const [phase, code] of [['read', 'EIO'], ['read', 'EACCES'], ['read', 'EMFILE'], ['open', 'EACCES'], ['open', 'EMFILE']]) {
    const error = Object.freeze(Object.assign(new Error(`controlled ${code}`), { code })); behavior = { phase, error };
    const target = new Set(['sentinel']);
    await assert.rejects(loadDictionaryWordSetFromFiles([bad, good], { target }), failure => {
      assert.ok(contains(failure, error)); assert.equal(failure.dictionaryInputs.failed, 1); return true;
    });
    assert.deepEqual([...target], ['sentinel'], 'failed selection cannot leave a partially successful target');
    await assert.rejects(loadCodeDictionaryWordSets({ commonFiles: [good], byLanguage: { javascript: [bad] } }),
      failure => contains(failure, error));
    assert.equal(active, 0, 'every admitted sibling joins actual native closure');
  }
  behavior = null;
  const snapshots = await loadDictionaryFileSnapshots([good, missing, good], { lowerCase: true });
  const bytes = await fs.readFile(good);
  assert.equal(snapshots.size, 2); assert.equal(snapshots.get(missing).outcome, 'optional-missing');
  assert.equal(snapshots.get(good).hash, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(snapshots.get(good).bytes, bytes.length);
  const words = await loadDictionaryWordSetFromFiles([good], { lowerCase: true, snapshots });
  assert.deepEqual([...words].sort(), ['bravo', 'café'.normalize('NFKD')].sort());
  await assert.rejects(loadDictionaryWordSetFromFiles([good], { snapshots, lowerCase: false }), /normalization scope/);
  await assert.rejects(loadDictionaryWordSetFromFiles([good], { snapshots: new Map(snapshots), lowerCase: true }), /normalization scope/);
  const files = Array.from({ length: 24 }, (_, i) => path.join(dir, `parallel-${i}.txt`));
  await Promise.all(files.map(file => fs.writeFile(file, 'one\ntwo\n')));
  maximum = 0; await loadDictionaryFileSnapshots(files);
  assert.ok(maximum <= 8 && maximum > 1); assert.equal(active, 0);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), closeEntered = new Promise(resolve => { entered = resolve; });
  behavior = { phase: 'gated-close', gate, entered };
  const target = new Set(['sentinel']); let terminal = false;
  const loading = loadDictionaryWordSetFromFiles([bad, good], { target });
  loading.then(() => { terminal = true; }, () => { terminal = true; });
  try {
    await closeEntered; await new Promise(resolve => setImmediate(resolve));
    assert.equal(terminal, false); assert.deepEqual([...target], ['sentinel']);
    assert.ok(active > 0);
    assert.equal((await inspectStorageAccess(dir, { coordinationRoot: dictionaryStorageCoordinationRoot() })).protected, true,
      'normal input exhaustion does not release the selected dictionary lease before original native close');
  } finally { release(); await loading; }
  assert.equal(active, 0); assert.equal(terminal, true);
  assert.deepEqual([...target].sort(), ['sentinel', 'alpha', 'beta', 'BRAVO', 'CAFÉ'].sort());
  assert.equal((await inspectStorageAccess(dir, { coordinationRoot: dictionaryStorageCoordinationRoot() })).protected, false);
  const error = Object.freeze(Object.assign(new Error('controlled native close'), { code: 'EIO', syscall: 'close' }));
  behavior = { phase: 'close', error };
  await assert.rejects(loadDictionaryWordSetFromFiles([bad]), failure => failure.cacheOwnershipPending === true && contains(failure, error));
} finally { fs.open = open; }
console.log('dictionary complete content admission passed');
