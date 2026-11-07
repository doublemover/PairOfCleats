import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { acquireFileLock, releaseFileLockOrThrow } from '../../src/shared/locks/file-lock.js';
import { retainPublishedFileLockPrerequisite, getFileLockReleaseFailureObservation } from '../../src/shared/locks/file-lock-producer-observations.js';
import { acquireStorageWriteReservation, getStorageWriteAdmissionFailure } from '../../src/shared/storage/admission.js';
import { inspectStorageInventory, storageFileIdentity, sameStorageFileIdentity } from '../../src/shared/storage/inventory.js';
import { observeStorageResource, describeStorageFailure } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { readVerifiedContainedFile, assertNoSymlinkPath } from '../../src/shared/contained-file.js';
import { sha256FileObservation } from '../../src/shared/hash.js';
import { atomicWriteJson, atomicWriteText } from '../../src/shared/io/atomic-write.js';
import { throwIfAborted } from '../../src/shared/abort.js';
import { withBenchmarkEvidenceMaintenance, retireSettledBenchmarkEvidence } from './evidence-retirement.js';
import { BENCH_EVIDENCE_VERSION, BENCH_EVIDENCE_ROOT, BENCH_EVIDENCE_OWNER, BENCH_EVIDENCE_SETTLED,
  BENCH_EVIDENCE_LOCK, BENCH_EVIDENCE_CONTROL, BENCH_EVIDENCE_MAX_FILES, BENCH_EVIDENCE_RECORD_BYTES,
  BENCH_EVIDENCE_HARD_BYTES, BENCH_EVIDENCE_FAMILIES, benchmarkEvidenceFailure as failure,
  benchmarkEvidenceName, benchmarkEvidenceRootIdentity, sameBenchmarkEvidenceRoot } from './evidence-contract.js';

const identity = async target => benchmarkEvidenceRootIdentity(await fs.lstat(target, { bigint: true }));
const requireRoot = async (root, familyRoot, family) => {
  assertNoSymlinkPath(root, familyRoot);
  const expected = { schemaVersion: BENCH_EVIDENCE_VERSION, kind: 'benchmark-evidence-root', family,
    root: familyRoot, rootIdentity: await identity(familyRoot) };
  const marker = path.join(familyRoot, BENCH_EVIDENCE_ROOT);
  let read;
  try { read = await readVerifiedContainedFile(familyRoot, marker, { maxBytes: 65536 }); }
  catch (error) {
    if (describeStorageFailure(error, { phase: 'benchmark-evidence-root-admission' }).code !== 'ENOENT') throw error;
    await atomicWriteJson(marker, expected, { createOnly: true }); return;
  }
  const actual = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.buffer));
  if (JSON.stringify(actual) !== JSON.stringify(expected) || (await fs.lstat(marker, { bigint: true })).nlink !== 1n) {
    throw failure('ERR_BENCH_EVIDENCE_ROOT', 'Existing benchmark evidence root authority is unknown or changed.');
  }
};

/** One existing reservation and actual file-lock owner span the run. Reports
 * that ever issue saved/resume references stay pinned. Capacity denies new work
 * instead of deleting referenced, unknown or unsettled evidence. */
export const createBenchmarkEvidenceRun = async ({ root, familyRoot, family, requiredBytes,
  hardBytes = BENCH_EVIDENCE_HARD_BYTES, signal = null, now = Date.now }) => {
  root = path.resolve(root); familyRoot = path.resolve(familyRoot);
  if (!BENCH_EVIDENCE_FAMILIES.includes(family) || !Number.isSafeInteger(requiredBytes) || requiredBytes < 1
    || !Number.isSafeInteger(hardBytes) || hardBytes < requiredBytes || hardBytes > BENCH_EVIDENCE_HARD_BYTES
    || typeof now !== 'function') throw new TypeError('Invalid bounded benchmark evidence allocation.');
  const createdAt = now();
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new TypeError('Benchmark evidence requires a finite observed clock.');
  throwIfAborted(signal);
  return withBenchmarkEvidenceMaintenance({ root, familyRoot, family, signal }, async maintenance => {
    await requireRoot(root, familyRoot, family);
    const retirement = await retireSettledBenchmarkEvidence({ root, familyRoot, family, owner: maintenance, signal, now });
    const runId = crypto.randomUUID();
    const reservation = await acquireStorageWriteReservation({ root: familyRoot, resourceId: runId,
      coordinationRoot: path.join(familyRoot, BENCH_EVIDENCE_CONTROL), authorizedRoots: [root],
      requiredBytes, hardBytes, maxEntries: 100000, maxDurationMs: 10000 });
    let runDir, lock, rootIdentity;
    try {
      runDir = await fs.mkdtemp(path.join(familyRoot, 'run-'));
      assertNoSymlinkPath(familyRoot, runDir);
      lock = await acquireFileLock({ lockPath: path.join(runDir, BENCH_EVIDENCE_LOCK), waitMs: 0,
        staleMs: Number.MAX_SAFE_INTEGER,
        metadata: { scope: 'benchmark-evidence-run', hostname: os.hostname(), resourceSettlementVersion: 1, resourceId: runId } });
      if (!lock) throw failure('ERR_BENCH_EVIDENCE_RUN_BUSY', 'Fresh benchmark run ownership was not admitted.');
      rootIdentity = await identity(runDir);
    } catch (error) {
      const original = observeStorageResource(error, { phase: 'benchmark-evidence-run-admission' });
      const prerequisite = original.retain(), captured = observeStorageResource(prerequisite, { phase: 'benchmark-evidence-captured-admission' });
      if (lock && original.hasResourceObservation) retainPublishedFileLockPrerequisite(lock, prerequisite);
      const publication = lock?.fileLockPublicationSession, recover = publication?.releaseAfterClose;
      let released = false, closing = null;
      const owner = Object.freeze({ isSettled: () => released, closeAfterSettlement: () => {
        if (!closing) closing = (async () => {
          if (released) return;
          captured.requireSettled();
          if (await reservation.releaseAfterSettlement({ resourceId: runId, settled: true, pending: false }) !== true) {
            throw new Error('Original benchmark admission reservation remains unconfirmed.');
          }
          if (publication) { const receipt = await recover.call(publication);
            if (receipt?.settled !== true || receipt?.pending !== false || publication.isSettled() !== true) throw new Error('Original benchmark admission lock remains unconfirmed.'); }
          released = true;
        })().finally(() => { closing = null; });
        return closing;
      } });
      try { await owner.closeAfterSettlement(); }
      catch (secondary) { throw addStorageFailureContext(addStorageFailureContext(error, {}, secondary, { secondaryPresent: true }), {
        benchmarkEvidenceAdmissionOwner: owner, cacheOwnershipPending: true, cacheOwnershipReleased: owner.isSettled
      }, undefined, { nonEnumerable: ['benchmarkEvidenceAdmissionOwner'] }); }
      throw error;
    }
    const publication = lock.fileLockPublicationSession;
    const recoverLock = publication.releaseAfterClose, lockSettled = publication.isSettled;
    const releaseReservation = reservation.releaseAfterSettlement;
    const registered = new Set([BENCH_EVIDENCE_OWNER]), expectedFiles = new Map();
    const accepted = new Set(), problems = [], prerequisites = [];
    let active = true, referencesIssued = false, closing = null, sealed = false, sealAttempted = false;
    let released = false, reservationReleased = false, lockReleaseAttempted = false, capturedWork = false, workFailed = false;
    let operationCount = 0;
    const requireRunRoot = () => {
      assertNoSymlinkPath(familyRoot, runDir);
      if (!sameBenchmarkEvidenceRoot(rootIdentity, benchmarkEvidenceRootIdentity(fsSync.lstatSync(runDir, { bigint: true })))) {
        throw failure('ERR_BENCH_EVIDENCE_CHANGED', 'Original benchmark run directory identity changed.');
      }
    };
    const retain = (error, phase, original = observeStorageResource(error, { phase })) => {
      const prerequisite = original.retain();
      if (original.hasResourceObservation) {
        prerequisites.push(observeStorageResource(prerequisite, { phase }));
        retainPublishedFileLockPrerequisite(lock, prerequisite);
      }
      return error;
    };
    const requireOriginal = () => { for (const original of prerequisites) original.requireSettled(); };
    const remember = (error, phase) => { problems.push(error); retain(error, phase); };
    const aggregate = () => problems.reduce((first, next, index) => index
      ? addStorageFailureContext(first, {}, next, { secondaryPresent: true }) : next, undefined);
    const register = name => {
      if (!active || !benchmarkEvidenceName(name) || [BENCH_EVIDENCE_SETTLED, BENCH_EVIDENCE_LOCK, BENCH_EVIDENCE_OWNER].includes(name)) {
        throw failure('ERR_BENCH_EVIDENCE_FILE', 'Benchmark file admission requires an active owner and a canonical producer filename.');
      }
      requireRunRoot();
      if (!registered.has(name)) {
        if (registered.size >= BENCH_EVIDENCE_MAX_FILES) throw failure('ERR_BENCH_EVIDENCE_FILE_BUDGET', 'Benchmark evidence file inventory is full.');
        const filename = path.join(runDir, name);
        assertNoSymlinkPath(runDir, filename, { allowMissing: true });
        try { fsSync.lstatSync(filename); }
        catch (error) {
          if (describeStorageFailure(error, { phase: 'benchmark-evidence-file-admission' }).code !== 'ENOENT') throw error;
          registered.add(name); return filename;
        }
        throw failure('ERR_BENCH_EVIDENCE_FILE_EXISTS', 'A newly declared benchmark evidence file already exists.');
      }
      return path.join(runDir, name);
    };
    const track = (operation, { reportFailure = true } = {}) => {
      if (!active || typeof operation !== 'function') throw failure('ERR_BENCH_EVIDENCE_OWNER_CLOSED', 'Benchmark run requires an active original work owner.');
      if (++operationCount > 2 * BENCH_EVIDENCE_MAX_FILES) throw failure('ERR_BENCH_EVIDENCE_OPERATION_BUDGET', 'Benchmark evidence operation allowance is exhausted before dispatch.');
      const promise = Promise.resolve().then(() => { requireRunRoot(); return operation(); }).then(value => {
        const original = observeStorageResource(value, { phase: 'benchmark-evidence-accepted-result' });
        if (original.hasResourceObservation) retain(value, 'benchmark-evidence-accepted-result', original);
        original.requireSettled(); return value;
      }).catch(error => {
        if (reportFailure) remember(error, 'benchmark-evidence-accepted-work');
        else retain(error, 'benchmark-evidence-handled-work');
        throw error;
      });
      accepted.add(promise);
      promise.then(() => accepted.delete(promise), () => accepted.delete(promise));
      return promise;
    };
    const writeText = (name, text, options = {}) => {
      const filename = register(name);
      if (typeof text !== 'string' && !Buffer.isBuffer(text)) throw new TypeError('Benchmark evidence requires captured text or bytes.');
      const captured = Buffer.isBuffer(text) ? Buffer.from(text) : text;
      if (Buffer.byteLength(captured) > requiredBytes) throw failure('ERR_BENCH_EVIDENCE_FILE_SIZE', 'Benchmark evidence exceeds its admitted run allowance.');
      const expected = { sha256: crypto.createHash('sha256').update(captured).digest('hex'), bytes: Buffer.byteLength(captured) };
      if (expectedFiles.has(name)) throw failure('ERR_BENCH_EVIDENCE_FILE_EXISTS', 'Immutable benchmark evidence cannot be written twice.');
      expectedFiles.set(name, expected);
      return track(() => atomicWriteText(filename, captured, { ...options, createOnly: true }));
    };
    const seal = async () => {
      requireRunRoot();
      const inventory = await inspectStorageInventory({ roots: [{ id: 'benchmark-run', path: runDir }], includeFiles: true,
        maxEntries: BENCH_EVIDENCE_MAX_FILES + 3, maxDurationMs: 10000 });
      const item = inventory.items[0];
      if (inventory.complete && item && [...expectedFiles.keys()].some(name => !item.files.some(file => file.relativePath === name))) {
        throw failure('ERR_BENCH_EVIDENCE_REPORT_CHANGED', 'Admitted benchmark bytes disappeared before settlement.');
      }
      const eligible = Boolean(inventory.complete && item?.directories.length === 1
        && item.files.every(file => file.relativePath === BENCH_EVIDENCE_LOCK || registered.has(file.relativePath)));
      const files = [];
      if (eligible) for (const file of item.files) {
        if (file.relativePath === BENCH_EVIDENCE_LOCK) continue;
        const observed = await sha256FileObservation(path.join(runDir, file.relativePath), { containedRoot: runDir });
        const current = storageFileIdentity(await fs.lstat(path.join(runDir, file.relativePath), { bigint: true }));
        if (!sameStorageFileIdentity(current, file.identity) || !sameBenchmarkEvidenceRoot(observed.fileIdentity, file.identity)
          || observed.bytes !== file.identity.size) throw failure('ERR_BENCH_EVIDENCE_CHANGED', 'Benchmark evidence changed before settlement.');
        const expected = expectedFiles.get(file.relativePath);
        if (expected && (observed.value !== expected.sha256 || observed.bytes !== expected.bytes)) {
          throw failure('ERR_BENCH_EVIDENCE_REPORT_CHANGED', 'Benchmark evidence no longer matches its admitted producer bytes.');
        }
        files.push({ name: file.relativePath, identity: file.identity, checksum: `${observed.algo}:${observed.value}` });
      }
      const settledAt = now();
      if (!Number.isSafeInteger(settledAt) || settledAt < createdAt) throw failure('ERR_BENCH_EVIDENCE_CLOCK', 'Benchmark settlement clock is invalid or moved before admission.');
      const record = { schemaVersion: BENCH_EVIDENCE_VERSION, kind: 'benchmark-evidence-settlement', family, runId,
        runDir, rootIdentity, state: 'settled', settledAt: new Date(settledAt).toISOString(), referencesIssued,
        outcome: workFailed || problems.length ? 'failed' : 'completed', eligible, files };
      const text = JSON.stringify(record) + '\n';
      if (Buffer.byteLength(text) > BENCH_EVIDENCE_RECORD_BYTES
        || item?.logicalBytes + Buffer.byteLength(text) > requiredBytes) throw failure('ERR_BENCH_EVIDENCE_FILE_SIZE', 'Settled benchmark evidence exceeds its admitted allowance.');
      requireOriginal();
      await atomicWriteText(path.join(runDir, BENCH_EVIDENCE_SETTLED), text, { createOnly: true });
      sealed = true;
    };
    const closeAfterSettlement = () => {
      if (!capturedWork) return Promise.reject(failure('ERR_BENCH_EVIDENCE_OWNER_ACTIVE', 'Original benchmark work has not reached its completion boundary.'));
      if (released) return Promise.resolve({ resourceId: runId, settled: true, pending: false });
      if (!closing) closing = (async () => {
        await Promise.allSettled([...accepted]); requireOriginal();
        if (!sealAttempted) {
          sealAttempted = true;
          try { await seal(); } catch (error) { remember(error, 'benchmark-evidence-settlement-publication'); }
        }
        requireOriginal();
        if (!reservationReleased) {
          try {
            const receipt = await releaseReservation.call(reservation, { resourceId: runId, settled: true, pending: false });
            if (receipt !== true) throw failure('ERR_BENCH_EVIDENCE_RESERVATION', 'Original benchmark reservation release remains unconfirmed.');
            reservationReleased = true;
          } catch (error) {
            if (getStorageWriteAdmissionFailure(error)?.owner !== reservation) remember(error, 'benchmark-evidence-reservation-release');
            throw error;
          }
        }
        requireOriginal();
        if (lockReleaseAttempted) {
          const receipt = await recoverLock.call(publication);
          observeStorageResource(receipt, { phase: 'benchmark-evidence-lock-recovery' }).requireSettled();
          if (receipt?.settled !== true || receipt?.pending !== false || lockSettled.call(publication) !== true) throw failure('ERR_BENCH_EVIDENCE_RELEASE', 'Original benchmark lock remains unconfirmed.');
        } else {
          lockReleaseAttempted = true;
          try { await releaseFileLockOrThrow(lock); }
          catch (error) {
            if (!getFileLockReleaseFailureObservation(error, lock)) remember(error, 'benchmark-evidence-lock-release');
            throw error;
          }
        }
        released = true;
        return { resourceId: runId, settled: true, pending: false };
      })().finally(() => { closing = null; });
      return closing;
    };
    let owner;
    const expose = error => addStorageFailureContext(error, { benchmarkEvidenceOwner: owner,
      cacheOwnershipPending: true, cacheOwnershipReleased: () => released }, undefined, { nonEnumerable: ['benchmarkEvidenceOwner'] });
    owner = Object.freeze({ runId, runDir, retirement, registerFile: register, trackExternal: track, writeText,
      expectFile(name, expected) {
        if (!active || !registered.has(name) || !/^[a-f0-9]{64}$/u.test(expected?.sha256)
          || !Number.isSafeInteger(expected.bytes) || expected.bytes < 0) throw failure('ERR_BENCH_EVIDENCE_IDENTITY', 'Benchmark byte admission needs its registered file and exact source receipt.');
        if (expectedFiles.has(name) && JSON.stringify(expectedFiles.get(name)) !== JSON.stringify(expected)) throw failure('ERR_BENCH_EVIDENCE_IDENTITY', 'Original benchmark file byte admission cannot be replaced.');
        expectedFiles.set(name, Object.freeze({ sha256: expected.sha256, bytes: expected.bytes }));
      },
      writeJson: (name, value, options) => {
        observeStorageResource(value, { phase: 'benchmark-evidence-json-input' }).requireSettled();
        return writeText(name, JSON.stringify(value, null, 2) + '\n', options);
      },
      markReferenced() { if (!active) throw failure('ERR_BENCH_EVIDENCE_OWNER_CLOSED', 'A closed benchmark run cannot issue new references.'); requireRunRoot(); referencesIssued = true; },
      isSettled: () => released, isSealed: () => sealed,
      closeAfterSettlement: async () => { try { return await closeAfterSettlement(); } catch (error) { throw expose(error); } },
      finish: async (work, { failed = false } = {}) => {
        if (!capturedWork) { capturedWork = true; active = false; workFailed = failed; retain(work, 'benchmark-evidence-original-work'); }
        try { await closeAfterSettlement(); }
        catch (error) { throw expose(error); }
        if (problems.length) throw aggregate();
      }
    });
    try {
      const text = JSON.stringify({ schemaVersion: BENCH_EVIDENCE_VERSION,
        kind: 'benchmark-evidence-run', family, runId, runDir, rootIdentity, createdAt: new Date(createdAt).toISOString() }) + '\n';
      expectedFiles.set(BENCH_EVIDENCE_OWNER, { sha256: crypto.createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) });
      await atomicWriteText(path.join(runDir, BENCH_EVIDENCE_OWNER), text, { createOnly: true });
    } catch (error) {
      try { await owner.finish(error, { failed: true }); }
      catch (secondary) { throw addStorageFailureContext(error, {}, secondary, { secondaryPresent: true }); }
      throw error;
    }
    return owner;
  });
};
