import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { withRuntimeDestinationWriter } from '../../../src/index/semantic/runtime/ownership.js';
import { prepareRuntimeFamilyCatalog, registerRuntimeFamily, pageRuntimeFamilyCatalog, readRuntimeFamilyCatalog } from '../../../src/index/semantic/runtime/family-catalog.js';
import { listRuntimeFamilies } from '../../../src/index/semantic/runtime/families.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const cases = ['bounded-pages', 'snapshot-inserts', 'interrupted-selector', 'missing-corrupt',
  'uncataloged-cutover', 'initial-header-recovery', 'cancellation-budget', 'writer-authority'];
assert.ok(cases.includes(selected));
const { dir } = await prepareIsolatedTestCacheDir('runtime-family-catalog-' + selected);
const destination = path.join(dir, 'store'), limitBytes = 16 * 1024 * 1024;
const work = { add() {}, observeReservation() {} };
const mutate = operation => withRuntimeDestinationWriter({ destination, maxDiskWorkingSetBytes: limitBytes },
  ({ destination: root, account }) => operation({ destination: root, account, diskReserveBytes: 0, work }));
const prepare = () => mutate(options => prepareRuntimeFamilyCatalog(options));
const add = key => mutate(options => registerRuntimeFamily({ ...options, generationId: key }));
const digit = value => value.repeat(64);
const page = (options = {}) => pageRuntimeFamilyCatalog({ destination, after: '', limit: 2, maxReads: 16, check() {}, ...options });
const initialize = async keys => mutate(async options => {
  await prepareRuntimeFamilyCatalog(options);
  for (const generationId of keys) await registerRuntimeFamily({ ...options, generationId });
});
const collect = async snapshot => {
  const keys = []; let after = '', turns = 0;
  for (;;) {
    const result = await page({ snapshot, after });
    snapshot ||= result.snapshot;
    assert.ok(++turns < 100);
    keys.push(...result.keys.slice(0, 2));
    if (result.keys.length <= 2) break;
    after = result.keys[1];
  }
  return keys;
};
let failed = false, failure;
try {
  if (selected === 'bounded-pages') {
    const keys = Array.from({ length: 48 }, (_, index) => createHash('sha256').update(String(index)).digest('hex'));
    await initialize([...keys].reverse());
    await fs.mkdir(path.join(destination, 'generations'));
    for (let index = 0; index < 64; index++) await fs.writeFile(path.join(destination, 'generations', 'unrelated-' + index), 'unrelated');
    const original = fs.opendir;
    let after = '', snapshot = null, visits = 0; const seen = [];
    try {
      fs.opendir = async () => assert.fail('interactive discovery must not enumerate destination directories');
      for (;;) {
        const metrics = {}, result = await page({ after, snapshot, metrics }); snapshot ||= result.snapshot;
        assert.ok(result.nodeReads <= 16); assert.equal(metrics.catalogNodeReads, result.nodeReads);
        assert.ok(metrics.catalogReadBytes <= 16 * 4096);
        visits += result.nodeReads; seen.push(...result.keys.slice(0, 2));
        if (result.keys.length <= 2) break;
        after = result.keys[1];
      }
    } finally { fs.opendir = original; }
    assert.deepEqual(seen, [...keys].sort()); assert.equal(new Set(seen).size, keys.length);
    assert.ok(visits < keys.length * Math.ceil(keys.length / 2), 'page work is not one complete inventory rescan per page');
    await assert.rejects(listRuntimeFamilies({ destination }), error => error.code === 'ENOENT',
      'catalog membership alone cannot qualify a missing immutable family');
  } else if (selected === 'snapshot-inserts') {
    await initialize(['8', '2', '6', '4'].map(digit));
    const first = await page(); assert.deepEqual(first.keys.slice(0, 2), ['2', '4'].map(digit));
    for (const key of ['1', '5', '9'].map(digit)) await add(key);
    const suffix = await page({ after: digit('4'), snapshot: first.snapshot });
    assert.deepEqual(suffix.keys, ['6', '8'].map(digit));
    assert.deepEqual(await collect(first.snapshot), ['2', '4', '6', '8'].map(digit));
    assert.deepEqual(await collect(null), ['1', '2', '4', '5', '6', '8', '9'].map(digit));
    await assert.rejects(page({ after: digit('3'), snapshot: first.snapshot }), { code: 'ERR_RUNTIME_QUERY_CURSOR' });
    await assert.rejects(page({ snapshot: { ...first.snapshot, storeId: '0'.repeat(32) } }), { code: 'ERR_RUNTIME_CATALOG_REQUIRED' });
  } else if (selected === 'interrupted-selector') {
    await initialize([digit('2')]);
    const before = await readRuntimeFamilyCatalog({ destination }), rename = fs.rename;
    try {
      fs.rename = async (from, to) => {
        if (path.resolve(to) === path.join(destination, 'family-catalog.json')) throw Object.assign(new Error('injected catalog publication interruption'), { code: 'EIO' });
        return rename(from, to);
      };
      await assert.rejects(add(digit('4')), { code: 'EIO' });
    } finally { fs.rename = rename; }
    assert.deepEqual(await readRuntimeFamilyCatalog({ destination }), before);
    assert.ok((await fs.stat(path.join(destination, 'family-catalog.bin'))).size > before.extent);
    assert.deepEqual((await page()).keys, [digit('2')]);
    await add(digit('4'));
    assert.deepEqual((await page()).keys, ['2', '4'].map(digit));
    const after = await readRuntimeFamilyCatalog({ destination });
    assert.equal((await fs.stat(path.join(destination, 'family-catalog.bin'))).size, after.extent, 'retry retires only the unpublished suffix');
    assert.deepEqual((await page({ snapshot: before })).keys, [digit('2')], 'old published prefixes survive retry');
  } else if (selected === 'missing-corrupt') {
    await initialize([digit('2'), digit('4')]);
    const controlPath = path.join(destination, 'family-catalog.json'), bytes = await fs.readFile(controlPath);
    const control = JSON.parse(bytes);
    for (const changed of [{ ...control, version: 0 }, { ...control, extent: 1 }, false]) {
      await fs.writeFile(controlPath, JSON.stringify(changed));
      await assert.rejects(page(), { code: 'ERR_RUNTIME_CATALOG_REQUIRED' });
    }
    await fs.writeFile(controlPath, bytes);
    const storePath = path.join(destination, 'family-catalog.bin'), store = await fs.readFile(storePath);
    const corrupted = Buffer.from(store); corrupted[control.commit.offset] ^= 1; await fs.writeFile(storePath, corrupted);
    await assert.rejects(page(), { code: 'ERR_RUNTIME_CATALOG_REQUIRED' });
    await fs.writeFile(storePath, store);
    await fs.rm(storePath);
    await assert.rejects(page(), { code: 'ERR_RUNTIME_CATALOG_REQUIRED' });
    await fs.writeFile(storePath, store);
    await fs.rm(controlPath);
    await assert.rejects(page(), { code: 'ERR_RUNTIME_CATALOG_REQUIRED' });
    await assert.rejects(prepare(), { code: 'ERR_RUNTIME_CATALOG_REQUIRED' });
    assert.deepEqual(await fs.readFile(storePath), store, 'missing selectors do not authorize rebuilding or replacing a nonempty store');
  } else if (selected === 'uncataloged-cutover') {
    await fs.mkdir(path.join(destination, 'generations', digit('2')), { recursive: true });
    const old = path.join(destination, 'generations', digit('2'), 'manifest.json'); await fs.writeFile(old, 'existing immutable input');
    await assert.rejects(prepare(), { code: 'ERR_RUNTIME_CATALOG_REQUIRED' });
    assert.equal(await fs.readFile(old, 'utf8'), 'existing immutable input');
    await assert.rejects(fs.stat(path.join(destination, 'family-catalog.bin')), { code: 'ENOENT' });
  } else if (selected === 'initial-header-recovery') {
    const rename = fs.rename;
    try {
      fs.rename = async (from, to) => {
        if (path.resolve(to) === path.join(destination, 'family-catalog.json')) throw Object.assign(new Error('initial selector interruption'), { code: 'EIO' });
        return rename(from, to);
      };
      await assert.rejects(prepare(), { code: 'EIO' });
    } finally { fs.rename = rename; }
    const header = await fs.readFile(path.join(destination, 'family-catalog.bin'));
    await prepare(); assert.deepEqual(await fs.readFile(path.join(destination, 'family-catalog.bin')), header);
    assert.deepEqual((await page()).keys, []);
    await add(digit('2')); assert.deepEqual((await page()).keys, [digit('2')]);
  } else if (selected === 'cancellation-budget') {
    await initialize([digit('2'), digit('4'), digit('6')]);
    await assert.rejects(page({ maxReads: 1 }), { code: 'ERR_RUNTIME_QUERY_BUDGET' });
    const controller = new AbortController(); let checks = 0;
    await assert.rejects(page({ signal: controller.signal, check() {
      if (++checks === 5) controller.abort(); throwIfAborted(controller.signal);
    } }), { code: 'ABORT_ERR' });
    assert.deepEqual(await collect(null), ['2', '4', '6'].map(digit), 'an interrupted read does not mutate the catalog');
  } else {
    await fs.mkdir(destination, { recursive: true });
    const account = { reserve() { assert.fail('unowned mutation must not reserve'); }, release() { assert.fail('unowned mutation must not release'); } };
    await assert.rejects(prepareRuntimeFamilyCatalog({ destination, account, diskReserveBytes: 0, work }), TypeError);
    await assert.rejects(registerRuntimeFamily({ destination, generationId: digit('2'), account, diskReserveBytes: 0, work }), TypeError);
    await initialize([digit('2')]);
    let captured;
    await mutate(async options => { captured = options; });
    await assert.rejects(registerRuntimeFamily({ ...captured, generationId: digit('4') }), TypeError, 'expired original writer accounts cannot publish');
  }
} catch (error) { failed = true; failure = error; }
finally {
  try {
    if (failed) observeStorageResource(failure, { phase: 'catalog-fixture-cleanup' }).requireSettled();
    assert.ok(path.basename(dir).startsWith('runtime-family-catalog-'));
    await fs.rm(path.resolve(dir), { recursive: true, force: true });
  } catch (error) {
    failure = failed ? addStorageFailureContext(failure, {}, error, { secondaryPresent: true }) : error;
    failed = true;
  }
}
if (failed) throw failure;
console.log('Runtime family catalog ' + selected + ' passed');
