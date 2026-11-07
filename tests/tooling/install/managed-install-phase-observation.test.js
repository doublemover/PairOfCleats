import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { installPinnedManagedTool, inspectManagedInstallation } from '../../../tools/tooling/managed-install.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { withTemporaryEnv, ensureTestingEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { rmDirRecursive } from '../../helpers/temp.js';
import { downloadToBuffer } from '../../../tools/tooling/install-shared.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/managed-install-phase-observation/')[1];
assert.ok(['pending-diagnostics-remain-unread', 'independent-diagnostic-retains-stage', 'pending-progress-is-not-reentered',
  'late-nested-verification-retains-stage', 'function-original-observation', 'download-recovery-after-journal-failure'].includes(mode));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scope = path.join(repositoryRoot, '.tmp', 'tests', 'managed-install-phases');
assertNoSymlinkPath(repositoryRoot, scope, { allowMissing: true }); await fs.mkdir(scope, { recursive: true });
const temporary = await fs.mkdtemp(path.join(scope, 'case-')), home = path.join(temporary, 'home'), toolingRoot = path.join(temporary, 'tools');
const archive = Buffer.from('explicit inert managed phase fixture');
const descriptor = version => ({ schemaVersion: 1, toolId: 'fixture-original-phases', recipeId: 'explicit-inert-archive', version,
  platform: process.platform, arch: process.arch,
  archive: { url: `https://fixture.invalid/phase-${version}.zip`, type: 'zip', bytes: archive.length,
    sha256: createHash('sha256').update(archive).digest('hex') }, root: 'package', command: 'tool', args: [], requiredFiles: ['tool'],
  storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 }] } });
const defaults = { approvedOrigins: ['https://fixture.invalid'],
  download: async ({ url }) => ({ body: archive, sourceUrl: url }),
  extract: async (_file, root) => { await fs.mkdir(path.join(root, 'package'), { recursive: true }); await fs.writeFile(path.join(root, 'package', 'tool'), 'explicit inert tool'); },
  verify: async ({ resourceId }) => ({ ok: true, level: 'explicit-finite-fixture', settlement: { resourceId, settled: true, pending: false } }) };
let ready = false, failure, codeReads = 0, messageReads = 0, coercions = 0, downloads = 0, verifyCalls = 0, progressCalls = 0, progressAtFailure = 0;
const opendir = fs.opendir;
const rename = fs.rename;
const nativePath = value => process.platform === 'win32' ? path.toNamespacedPath(value).toLowerCase() : path.resolve(value);
try {
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: home }), async () => {
    // Real publication/reservations with an explicitly inert archive and
    // verifier. This does not establish vendor or native child qualification.
    const previous = await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('1.0.0'), ...defaults }); assert.equal(previous.ok, true);
    const pending = () => ready;
    const independent = Object.freeze(Object.defineProperties(new Error('original diagnostic owns independent work'), {
      cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: pending }
    }));
    let original, afterVerify = false, admittedDirectory = false, verifiedRoot = null, journalFailure = null;
    const options = { ...defaults, onProgress: () => { progressCalls++; }, download: async input => {
      downloads++; progressAtFailure = progressCalls; return defaults.download(input);
    } };
    if (mode === 'download-recovery-after-journal-failure') {
      journalFailure = Object.assign(new Error('original failed journal publication'), { code: 'EIO' });
      options.download = async request => {
        downloads++; progressAtFailure = progressCalls;
        try {
          return await downloadToBuffer({ ...request, fetchImpl: async () => ({ ok: true, status: 200, url: request.url,
            headers: { get: () => String(request.maxBytes + 1) },
            body: { cancel: async () => { if (!ready) throw independent; } }
          }) });
        } catch (error) { original = Object.freeze(error); throw original; }
      };
      fs.rename = async (from, to, ...args) => {
        if (original && typeof to === 'string' && nativePath(to).startsWith(nativePath(toolingRoot) + path.sep)
          && path.basename(path.dirname(to)) === 'transactions') throw journalFailure;
        return rename(from, to, ...args);
      };
    } else if (mode === 'late-nested-verification-retains-stage') {
      options.verify = async ({ root, resourceId }) => {
        verifyCalls++; ready = true; verifiedRoot = root; afterVerify = true;
        const settlement = Object.freeze(Object.defineProperties({ resourceId, settled: true, pending: false }, {
          cacheOwnershipPending: { value: false }, cacheOwnershipReleased: { value: pending }
        }));
        original = Object.freeze({ ok: true, settlement }); return original;
      };
      fs.opendir = async (filename, ...args) => {
        if (afterVerify && !admittedDirectory && typeof filename === 'string' && nativePath(filename) === nativePath(verifiedRoot)) { admittedDirectory = true; ready = false; }
        return opendir(filename, ...args);
      };
    } else if (mode === 'independent-diagnostic-retains-stage') {
      original = Object.freeze(Object.defineProperties(new Error('original settled download failure'), {
        code: { get() { codeReads++; throw independent; } }, message: { get() { messageReads++; ready = true; return 'later field'; } }
      }));
      options.download = async () => { downloads++; progressAtFailure = progressCalls; throw original; };
    } else {
      original = mode === 'function-original-observation' ? function originalDownloadFailure() {} : new Error('original pending download');
      Object.defineProperties(original, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: pending },
        code: { get() { codeReads++; ready = true; return 'ERR_FIXTURE'; } },
        message: { configurable: true, get() { messageReads++; ready = true; return 'later pending message'; } },
        [Symbol.toPrimitive]: { value: () => { coercions++; return 'opaque original function'; } }
      }); Object.freeze(original);
      options.download = async () => { downloads++; progressAtFailure = progressCalls; throw original; };
    }
    try { await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('1.0.1'), ...options }); }
    catch (error) { failure = error; }
    finally { fs.opendir = opendir; fs.rename = rename; }
    assert.ok(failure, 'pending original work cannot publish a new selected installation');
    assert.equal(errorGraphIncludes(failure, original), true); assert.equal(coercions, 0);
    if (mode === 'independent-diagnostic-retains-stage') assert.equal(errorGraphIncludes(failure, independent), true);
    if (journalFailure) {
      assert.equal(errorGraphIncludes(failure, journalFailure), true);
      assert.equal(original.downloadCleanupError, independent, 'the original transport retains its exact teardown failure on the documented resource field');
      assert.equal(errorGraphIncludes(failure, independent), true, 'the outer install boundary preserves its promised generic teardown-error edge');
      assert.equal(original.downloadSession.isSettled(), false);
    }
    assert.equal(codeReads, mode === 'independent-diagnostic-retains-stage' ? 1 : 0);
    assert.equal(messageReads, 0, 'a later diagnostic cannot erase an unconfirmed interval');
    if (mode === 'pending-progress-is-not-reentered') assert.equal(progressCalls, progressAtFailure);
    if (mode === 'late-nested-verification-retains-stage') { assert.equal(admittedDirectory, true); assert.equal(verifyCalls, 1); }
    const held = failure.managedInstallSession; assert.ok(held); assert.ok((await fs.stat(held.stage)).isDirectory());
    const coordinationRoot = path.join(home, 'state', 'storage-access');
    assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
    assert.equal((await inspectManagedInstallation({ toolingRoot, toolId: descriptor('1.0.0').toolId })).receipt.installId, previous.installId);
    await assert.rejects(held.releaseAfterSettlement({ resourceId: held.resourceId, settled: true, pending: false }));
    assert.ok((await fs.stat(held.stage)).isDirectory());
    ready = true;
    assert.equal(await held.releaseAfterSettlement({ resourceId: held.resourceId, settled: true, pending: false }), true);
    if (journalFailure) assert.equal(original.downloadSession.isSettled(), true);
    assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, false);
    await assert.rejects(fs.stat(held.stage), { code: 'ENOENT' });
    assert.equal(downloads, 1, 'actual original retirement never repeats acquisition');
    assert.equal((await inspectManagedInstallation({ toolingRoot, toolId: descriptor('1.0.0').toolId })).receipt.installId, previous.installId);
  });
} finally {
  ready = true; fs.opendir = opendir; fs.rename = rename;
  assertNoSymlinkPath(repositoryRoot, temporary);
  const actual = await fs.realpath(temporary), parent = await fs.realpath(scope); assert.equal(path.dirname(actual), parent);
  await rmDirRecursive(actual, { retries: 0 });
}
console.log('Managed install publication and cleanup retain original phase observations, diagnostics and previous selectors.');
