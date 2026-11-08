import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { installPinnedManagedTool, inspectManagedInstallation, validatePinnedInstallDescriptor } from '../../../tools/tooling/managed-install.js';
import { snapshotEvaluationData } from '../../../src/retrieval/evaluation/plain-data.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { rmDirRecursive } from '../../helpers/temp.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/managed-install-input-ownership/')[1];
assert.ok(['descriptor-during-download', 'descriptor-during-selection', 'mutated-source-refusal', 'borrowed-buffer-before-write',
  'passive-contract', 'pending-acquisition-before-fields', 'pending-progress-before-acquisition'].includes(mode));
const root = fileURLToPath(new URL('../../../', import.meta.url)), scope = path.join(root, '.tmp', 'tests', 'managed-input-ownership');
assertNoSymlinkPath(root, scope, { allowMissing: true }); await fs.mkdir(scope, { recursive: true });
const temporary = await fs.mkdtemp(path.join(scope, 'case-')), home = path.join(temporary, 'home'), toolingRoot = path.join(temporary, 'tools');
const body = Buffer.from('explicit immutable archive input'), origin = 'https://fixture.invalid';
const make = version => ({ schemaVersion: 1, toolId: 'fixture-owned-inputs', recipeId: 'explicit-inert-archive', version,
  platform: process.platform, arch: process.arch, archive: { url: `${origin}/tool-${version}.zip`, type: 'zip', bytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex') }, root: 'package', command: 'tool', args: [], requiredFiles: ['tool'],
  storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 2 * 1024 * 1024 }] } });
const opendir = fs.opendir, nativePath = value => process.platform === 'win32' ? path.toNamespacedPath(value).toLowerCase() : path.resolve(value);
let ready = true;
try {
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: home }), async () => {
    if (mode === 'passive-contract') {
      let getters = 0, traps = 0, coerced = 0;
      const accessor = Object.defineProperty(make('2.0.0'), 'archive', { enumerable: true, get() { getters++; return make('2.0.0').archive; } });
      const proxy = new Proxy(make('2.0.0'), { ownKeys() { traps++; return []; } });
      const hidden = Object.defineProperty(make('2.0.0'), 'future', { value: 'hidden' });
      const symbolic = make('2.0.0'); symbolic[Symbol('future')] = 'symbolic';
      const callback = () => {}; callback[Symbol.toPrimitive] = () => { coerced++; return 'callback'; };
      const cyclic = make('2.0.0'); cyclic.args.push(cyclic.args);
      for (const invalid of [accessor, proxy, hidden, symbolic, { ...make('2.0.0'), args: [callback] }, cyclic,
        { ...make('2.0.0'), requiredFiles: Array(50001).fill('tool') }]) assert.throws(() => validatePinnedInstallDescriptor(invalid, { approvedOrigins: [origin] }));
      assert.equal(getters, 0); assert.equal(traps, 0); assert.equal(coerced, 0);
      const ordinary = { nested: { values: ['x', 1] } }, evaluated = snapshotEvaluationData(ordinary, { maxBytes: 4096 });
      assert.equal(Object.getPrototypeOf(evaluated), null); assert.deepEqual(JSON.parse(JSON.stringify(evaluated)), ordinary);
      assert.throws(() => snapshotEvaluationData(proxy, { maxBytes: 4096 }), { code: 'ERR_EVALUATION_INPUT' }); assert.equal(traps, 0);
      const valid = validatePinnedInstallDescriptor(make('2.0.0'), { approvedOrigins: [origin] });
      assert.equal(Object.isFrozen(valid), true); assert.equal(Object.isFrozen(valid.archive), true); assert.equal(Object.isFrozen(valid.requiredFiles), true);
      return;
    }
    let downloads = 0, extractions = 0, verifications = 0;
    const defaults = { approvedOrigins: [origin], download: async ({ url }) => { downloads++; return { sourceUrl: url, body }; },
      extract: async (archive, target) => {
        extractions++; assert.deepEqual(await fs.readFile(archive), body, 'extraction consumes the exact pinned bytes');
        await fs.mkdir(path.join(target, 'package'), { recursive: true }); await fs.writeFile(path.join(target, 'package', 'tool'), 'explicit inert consumer');
      }, verify: async ({ resourceId }) => { verifications++; return { ok: true, settlement: { resourceId, settled: true, pending: false } }; } };
    // Real publication and storage owners; explicit inert archives/consumer.
    const previous = await installPinnedManagedTool({ toolingRoot, descriptor: make('1.0.0'), ...defaults });
    downloads = 0; extractions = 0; verifications = 0;
    const descriptor = make('2.0.0'), expected = JSON.parse(JSON.stringify(descriptor)), origins = [origin];
    const options = { ...defaults, toolingRoot, descriptor, approvedOrigins: origins };
    let mutated = false, borrowed = null, original = null, reads = 0;
    const mutate = () => { mutated = true; descriptor.version = '9.0.0'; descriptor.archive.url = 'https://untrusted.invalid/changed.zip'; origins.push('https://untrusted.invalid'); };
    if (mode === 'descriptor-during-selection') fs.opendir = async (filename, ...args) => {
      if (!mutated && typeof filename === 'string' && nativePath(filename).startsWith(nativePath(toolingRoot) + path.sep)) mutate();
      return opendir(filename, ...args);
    };
    if (mode === 'descriptor-during-download') options.download = async ({ url }) => { downloads++; mutate(); descriptor.requiredFiles.push('../unapproved'); return { sourceUrl: url, body }; };
    else if (mode === 'descriptor-during-selection') options.download = async ({ url }) => { downloads++; assert.equal(url, expected.archive.url); return { sourceUrl: url, body }; };
    else if (mode === 'mutated-source-refusal') options.download = async () => {
      downloads++; mutate(); const changed = Buffer.from('unapproved replacement bytes');
      Object.assign(descriptor.archive, { bytes: changed.length, sha256: createHash('sha256').update(changed).digest('hex') });
      return { sourceUrl: descriptor.archive.url, body: changed };
    };
    else if (mode === 'borrowed-buffer-before-write') options.download = async ({ url }) => {
      downloads++; borrowed = Buffer.from(body);
      return { body: borrowed, get sourceUrl() {
        if (!mutated) { mutated = true; queueMicrotask(() => { borrowed.fill(122); }); }
        return url;
      } };
    };
    else if (mode === 'pending-acquisition-before-fields') options.download = async () => {
      downloads++; ready = false;
      original = Object.freeze(Object.defineProperties({}, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => ready },
        sourceUrl: { get() { reads++; ready = true; return expected.archive.url; } }, body: { get() { reads++; ready = true; return body; } } }));
      return original;
    };
    else if (mode === 'pending-progress-before-acquisition') options.onProgress = () => {
      ready = false;
      original ||= Object.freeze({ cacheOwnershipPending: true, cacheOwnershipReleased: () => ready }); return original;
    };
    let result, failure;
    try { result = await installPinnedManagedTool(options); } catch (error) { failure = error; }
    finally { fs.opendir = opendir; }
    if (mode.startsWith('pending-')) {
      assert.ok(failure); assert.equal(errorGraphIncludes(failure, original), true); assert.equal(reads, 0);
      assert.equal(downloads, mode === 'pending-acquisition-before-fields' ? 1 : 0); assert.equal(extractions, 0); assert.equal(verifications, 0);
      const recovery = failure.managedInstallSession; assert.ok(recovery); assert.ok((await fs.stat(recovery.stage)).isDirectory());
      const coordinationRoot = path.join(home, 'state', 'storage-access');
      assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
      await assert.rejects(recovery.releaseAfterSettlement({ resourceId: recovery.resourceId, settled: true, pending: false }));
      ready = true; assert.equal(await recovery.releaseAfterSettlement({ resourceId: recovery.resourceId, settled: true, pending: false }), true);
      assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, false);
      await assert.rejects(fs.stat(recovery.stage), { code: 'ENOENT' });
      assert.equal((await inspectManagedInstallation({ toolingRoot, toolId: descriptor.toolId })).receipt.installId, previous.installId);
    } else if (mode === 'mutated-source-refusal') {
      assert.ok(failure); assert.equal(extractions, 0); assert.equal(verifications, 0);
      assert.equal((await inspectManagedInstallation({ toolingRoot, toolId: descriptor.toolId })).receipt.installId, previous.installId);
    } else {
      assert.equal(failure, undefined); assert.equal(result.ok, true); assert.equal(mutated, true);
      assert.deepEqual(result.receipt.descriptor, expected); assert.equal(result.receipt.source.url, expected.archive.url);
      assert.equal(downloads, 1); assert.equal(extractions, 1); assert.equal(verifications, 1);
      if (borrowed) assert.notDeepEqual(Buffer.from(borrowed), body, 'the original caller-owned storage really changed during I/O');
    }
  });
} finally {
  ready = true; fs.opendir = opendir; assertNoSymlinkPath(root, temporary);
  assert.equal(path.dirname(await fs.realpath(temporary)), await fs.realpath(scope)); await rmDirRecursive(temporary, { retries: 0 });
}
console.log('Pinned descriptor/origin snapshots and owned archive bytes survive caller mutation and original pending phases.');
