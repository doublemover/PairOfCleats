import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../contained-file.js';
import { assertSafeCacheDeletion } from '../cache-deletion.js';
import { atomicWriteJson } from '../io/atomic-write.js';
import { acquireFileLock, releaseFileLockOrThrow } from '../locks/file-lock.js';
import { addStorageFailureContext, releaseStorageOperationLock } from './operation-error.js';
import { syncParentDirectory } from '../io/persistence-helpers.js';
import { throwIfAborted } from '../abort.js';
import { withExclusiveStorageAccess } from './access.js';
import { readStorageLocator, writeStorageLocator } from './locator.js';
import { buildStorageMigrationManifest, storageMigrationOwnerProof, storagePlanDigest } from './migration-plan.js';
import { verifyStorageFile, isStorageTransferSession } from './transfer.js';
import { inspectStorageInventory } from './inventory.js';
import { revalidateStorageAuthority } from './authority.js';
import { assertStorageLocatorShape } from './locator-contract.js';

const exists = async target => {
  try { await fs.lstat(target); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
const readRecord = async file => {
  const { buffer } = await readVerifiedContainedFile(path.parse(file).root, file, { maxBytes: 32 * 1024 * 1024 });
  return JSON.parse(buffer.toString('utf8'));
};
const requirePlan = (plan, approvedPlanId, owner) => {
  const { planId, dryRun, ...body } = plan || {};
  void dryRun;
  if (plan?.kind !== 'pairofcleats-storage-migration-plan' || plan.schemaVersion !== 1 || !plan.ready
    || !plan.manifest || planId !== storagePlanDigest(body) || approvedPlanId !== planId
    || plan.owner.id !== owner?.id || plan.owner.version !== owner?.version) throw new Error('Migration requires the exact complete reviewed plan and its category owner.');
};
const requirePlanIdentity = plan => {
  const { planId, dryRun, ...body } = plan || {};
  void dryRun;
  if (body.kind !== 'pairofcleats-storage-migration-plan' || body.schemaVersion !== 1
    || !/^[a-f0-9]{64}$/u.test(planId || '') || planId !== storagePlanDigest(body)
    || ['source', 'destination', 'home', 'recoveryRoot', 'coordinationRoot'].some(key => !path.isAbsolute(body[key] || ''))) {
    throw new Error('Migration status requires an intact reviewed plan identity.');
  }
};
const journalKeys = new Set(['schemaVersion', 'planId', 'stage', 'completedFiles', 'source', 'destination',
  'sourcePreserved', 'failures', 'updatedAt', 'staging', 'abandonedStages', 'destinationPreserved',
  'rollbackTarget', 'rollbackFromHash']);
const journalStages = new Set(['planned', 'preparing', 'copying', 'verified', 'published', 'selected',
  'interrupted', 'rollback-prepared', 'rolled-back']);
const readJournal = async (file, plan) => {
  const value = await readRecord(file);
  if (!value || Object.keys(value).some(key => !journalKeys.has(key)) || value.schemaVersion !== 1
    || value.planId !== plan.planId || value.source !== plan.source || value.destination !== plan.destination
    || value.sourcePreserved !== true || !journalStages.has(value.stage)
    || !Number.isSafeInteger(value.completedFiles) || value.completedFiles < 0 || value.completedFiles > plan.manifest.files.length
    || !Array.isArray(value.failures) || value.failures.length > 16) {
    throw new Error('Migration journal is unknown or incompatible; existing recovery bytes are preserved.');
  }
  const rollback = ['rollback-prepared', 'rolled-back'].includes(value.stage);
  if (rollback !== Object.hasOwn(value, 'rollbackTarget') || rollback !== Object.hasOwn(value, 'rollbackFromHash')
    || (rollback && (!/^[a-f0-9]{64}$/u.test(value.rollbackFromHash || '') || value.destinationPreserved !== true))) {
    throw new Error('Migration rollback intent is incomplete; existing recovery bytes are preserved.');
  }
  if (rollback) {
    assertStorageLocatorShape(value.rollbackTarget);
    if (storagePlanDigest(value.rollbackTarget.categories[plan.category] || null) !== storagePlanDigest(plan.priorSelection)) {
      throw new Error('Migration rollback intent differs from its reviewed prior category selection.');
    }
  }
  return value;
};
const exactSelection = (selection, plan, data) => selection?.migrationId === plan.planId
  && selection.path === data && selection.owner === plan.owner.id;
const requirePublishedMarker = async (plan, paths) => {
  const marker = await readRecord(path.join(paths.published, '.migration-owner.json'));
  if (!marker || Object.keys(marker).sort().join(',') !== 'planId,schemaVersion'
    || marker.schemaVersion !== 1 || marker.planId !== plan.planId) {
    throw new Error('Published migration identity is invalid or carries unknown retained metadata.');
  }
};
const pathsFor = plan => {
  const root = path.join(plan.destination, '.poc-migrations');
  return { root, stage: path.join(root, `${plan.planId}.staging`),
    published: path.join(root, plan.planId), journal: path.join(plan.recoveryRoot, `${plan.planId}.json`),
    savedPlan: path.join(plan.recoveryRoot, `${plan.planId}.plan.json`) };
};
const withExclusiveRoots = async (roots, options, action) => {
  const ordered = [...new Set(roots)].sort();
  const retained = [], released = new Set(), transfers = new Set();
  let firstFailure = null, reconciling = null;
  const pendingFailure = (primary, failures = []) => {
    const metadata = Object.assign(new AggregateError(failures, 'Migration transfer exclusions remain retained.',
      failures.length ? { cause: failures[0] } : undefined), {
      cacheOwnershipPending: true, cacheOwnershipReleased: () => retained.every(item => released.has(item.lock))
    });
    return addStorageFailureContext(primary, { storageMigrationTransferSession: recovery }, metadata,
      { nonEnumerable: ['storageMigrationTransferSession'] });
  };
  const recovery = Object.freeze({ releaseAfterClose: async () => {
    if (!reconciling) reconciling = (async () => {
      for (const session of transfers) {
        const receipt = await session.releaseAfterClose();
        if (receipt?.resourceId !== session.resourceId || receipt.settled !== true || receipt.pending !== false || !session.isSettled()) {
          throw new Error('Migration transfer descriptor owner did not confirm its exact closure.');
        }
      }
      const results = await Promise.allSettled(retained.filter(item => !released.has(item.lock)).map(async item => {
        await releaseFileLockOrThrow(item.lock); released.add(item.lock);
      }));
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw pendingFailure(firstFailure, failures);
      return true;
    })().finally(() => { reconciling = null; });
    try { return await reconciling; }
    catch (error) { throw pendingFailure(firstFailure || error, [error]); }
  } });
  const next = async (index, owners = []) => {
    if (index === ordered.length) return action(owners);
    const result = await withExclusiveStorageAccess(ordered[index], async context => {
      try { return await next(index + 1, [...owners, {
        root: context.paths.root, lockId: context.lock.payload.lockId, pid: context.lock.payload.pid
      }]); } catch (error) {
        if (isStorageTransferSession(error.storageTransferSession)) {
          transfers.add(error.storageTransferSession);
          firstFailure ||= error;
          retained.push({ root: context.paths.root, lock: context.lock });
          context.retainExclusion();
          throw pendingFailure(error);
        }
        throw error;
      }
    }, options);
    if (result.protected) throw Object.assign(new Error(`Migration blocked by ${result.reason}.`), { code: 'ERR_STORAGE_MIGRATION_BUSY' });
    return result.result;
  };
  return next(0);
};

const verifyCopy = async (plan, data, signal) => {
  const inventory = await inspectStorageInventory({ roots: [{ id: 'copy', path: data }],
    includeFiles: true, ...plan.limits, signal });
  const item = inventory.items[0];
  if (!inventory.complete || item.status !== 'scanned'
    || JSON.stringify(item.files.map(file => file.relativePath).sort()) !== JSON.stringify(plan.manifest.files.map(file => file.relativePath).sort())
    || JSON.stringify(item.directories.map(directory => directory.relativePath).sort()) !== JSON.stringify(plan.manifest.directories.map(directory => directory.relativePath).sort())) {
    throw new Error('Migration copy inventory is incomplete or contains unplanned entries.');
  }
  for (const directory of plan.manifest.directories) {
    assertNoSymlinkPath(data, path.join(data, directory.relativePath));
    if (!(await fs.lstat(path.join(data, directory.relativePath))).isDirectory()) throw new Error('Migration copy lost a directory.');
  }
  for (const file of plan.manifest.files) {
    await verifyStorageFile({ root: data, file: path.join(data, file.relativePath), expectedHash: file.sha256,
      maxBytes: file.logicalBytes, signal });
  }
};
const ensureOwnedStage = async (plan, paths, journal, persist, hooks) => {
  if (await exists(paths.stage)) {
    let owned = false;
    try {
      const marker = await readRecord(path.join(paths.stage, '.migration-owner.json'));
      owned = Object.keys(marker).sort().join(',') === 'planId,schemaVersion'
        && marker.schemaVersion === 1 && marker.planId === plan.planId;
    } catch {}
    if (!owned) {
      // A crash between mkdir and marker publication is indistinguishable from
      // an unknown directory. Preserve it and select fresh run-owned staging.
      journal.abandonedStages = [...new Set([...(journal.abandonedStages || []), paths.stage])];
      if (journal.abandonedStages.length > 16) throw new Error('Migration has too many unknown stages; review retained recovery before resuming.');
      paths.stage = path.join(paths.root, `${plan.planId}.staging-${randomUUID()}`);
    }
  }
  journal.staging = paths.stage;
  await persist('preparing');
  if (!(await exists(paths.stage))) {
    assertNoSymlinkPath(path.parse(paths.root).root, paths.root, { allowMissing: true });
    await fs.mkdir(paths.root, { recursive: true });
    await fs.mkdir(paths.stage);
    await hooks.afterStageDirectory?.(paths.stage);
    await atomicWriteJson(path.join(paths.stage, '.migration-owner.json'), { schemaVersion: 1, planId: plan.planId }, { mkdir: false, createOnly: true });
    await fs.mkdir(path.join(paths.stage, 'data'));
  }
};

/** Copy/verify/publish/select. It never removes source bytes or failed staging. */
export const applyStorageMigration = async (plan, { approvedPlanId, authorityRoots = [],
  owner, signal = null, checkFreeSpace, hooks = {} } = {}) => {
  requirePlan(plan, approvedPlanId, owner);
  if (typeof checkFreeSpace !== 'function') throw new Error('Migration requires an explicit destination free-space owner.');
  const paths = pathsFor(plan);
  await revalidateStorageAuthority(plan.authoritySnapshots, authorityRoots);
  for (const target of [plan.source, plan.destination, plan.home, plan.recoveryRoot]) assertSafeCacheDeletion(target, authorityRoots);
  if (!plan.coordinationRoot) throw new Error('Whole-app migration requires an explicit owned coordinationRoot.');
  assertSafeCacheDeletion(plan.coordinationRoot, authorityRoots);
  await fs.mkdir(plan.recoveryRoot, { recursive: true });
  const lock = await acquireFileLock({ lockPath: `${paths.journal}.lock`, waitMs: 0,
    staleMs: Number.MAX_SAFE_INTEGER, metadata: { scope: 'storage-migration', planId: plan.planId } });
  if (!lock) throw new Error('Migration is already owned by another operation.');
  let journal = { schemaVersion: 1, planId: plan.planId, stage: 'planned', completedFiles: 0,
    source: plan.source, destination: plan.destination, sourcePreserved: true, failures: [] };
  let journalWritable = false;
  let operationError = null;
  const persist = async stage => {
    journal.stage = stage;
    journal.updatedAt = new Date().toISOString();
    assertSafeCacheDeletion(paths.journal, authorityRoots);
    await atomicWriteJson(paths.journal, journal, { mkdir: false });
    await hooks.afterStage?.(stage, { ...journal });
  };
  try {
    if (await exists(paths.savedPlan)) {
      const saved = await readRecord(paths.savedPlan);
      if (saved.planId !== plan.planId || storagePlanDigest(saved) !== storagePlanDigest(plan)) throw new Error('Migration saved plan differs from this preview.');
    } else await atomicWriteJson(paths.savedPlan, plan, { mkdir: false, createOnly: true });
    if (await exists(paths.journal)) {
      journal = await readJournal(paths.journal, plan);
      if (['rolled-back', 'rollback-prepared'].includes(journal.stage)) throw new Error('Rolled-back or pending rollback migration requires rollback settlement or a new reviewed plan before another cutover.');
      if (journal.staging) {
        const suffix = path.basename(journal.staging).slice(plan.planId.length);
        if (path.dirname(journal.staging) !== paths.root || !/^\.staging(?:-[a-f0-9-]{36})?$/u.test(suffix)) throw new Error('Migration journal nominated an invalid staging path.');
        paths.stage = journal.staging;
      }
    }
    journalWritable = true;
    return await withExclusiveRoots([plan.source, plan.destination], { coordinationRoot: plan.coordinationRoot }, async exclusiveOwners => {
      for (const target of [plan.source, plan.destination, plan.home, plan.recoveryRoot]) assertSafeCacheDeletion(target, authorityRoots);
      await revalidateStorageAuthority(plan.authoritySnapshots, authorityRoots);
      const proof = await storageMigrationOwnerProof(owner, { ...plan, phase: 'exclusive', exclusiveOwners, signal });
      if (storagePlanDigest(proof) !== storagePlanDigest(plan.owner)) throw new Error('Category migration ownership changed since preview.');
      await buildStorageMigrationManifest({ root: plan.source, ...plan.limits, signal, expectedManifest: plan.manifest });
      const requiredBytes = await exists(paths.published) ? 0 : plan.requiredFreeBytes;
      const free = await checkFreeSpace({ destination: plan.destination, requiredBytes, signal });
      if (free?.complete !== true || !Number.isSafeInteger(free.availableBytes) || free.availableBytes < requiredBytes || free.reserveSatisfied !== true) throw new Error('Destination free space/reserve is insufficient or unknown.');
      const data = path.join(paths.published, 'data');
      if (!(await exists(paths.published))) {
        await ensureOwnedStage(plan, paths, journal, persist, hooks);
        const stagingData = path.join(paths.stage, 'data');
        await persist('copying');
        for (const directory of plan.manifest.directories) {
          const target = path.join(stagingData, directory.relativePath);
          assertNoSymlinkPath(paths.stage, target, { allowMissing: true });
          await fs.mkdir(target, { recursive: true, mode: directory.identity.mode & 0o777 });
        }
        for (let index = 0; index < plan.manifest.files.length; index += 1) {
          throwIfAborted(signal);
          const file = plan.manifest.files[index];
          const target = path.join(stagingData, file.relativePath);
          assertNoSymlinkPath(paths.stage, target, { allowMissing: true });
          let validExisting = false;
          if (await exists(target)) {
            try { await verifyStorageFile({ root: stagingData, file: target, expectedHash: file.sha256, maxBytes: file.logicalBytes, signal }); validExisting = true; }
            catch {
              throwIfAborted(signal);
              const recovery = path.join(paths.stage, 'failed-files');
              await fs.mkdir(recovery, { recursive: true });
              assertNoSymlinkPath(paths.stage, recovery);
              await fs.rename(target, path.join(recovery, randomUUID()));
            }
          }
          if (!validExisting) await verifyStorageFile({ root: plan.source, file: path.join(plan.source, file.relativePath),
            identity: file.identity, expectedHash: file.sha256, destination: target, maxBytes: file.logicalBytes, signal });
          journal.completedFiles = index + 1;
          if ((index + 1) % 16 === 0) await persist('copying');
          await hooks.afterFile?.(index, target);
        }
        await verifyCopy(plan, stagingData, signal);
        if (await owner.verifyDestination({ plan, root: stagingData, signal }) !== true) throw new Error('Category owner rejected the copied destination.');
        await buildStorageMigrationManifest({ root: plan.source, ...plan.limits, signal, expectedManifest: plan.manifest });
        for (const directory of [...plan.manifest.directories].reverse()) {
          await fs.chmod(path.join(stagingData, directory.relativePath), directory.identity.mode & 0o777);
        }
        const manifestPath = path.join(paths.stage, '.manifest.json');
        if (await exists(manifestPath)) {
          if (storagePlanDigest(await readRecord(manifestPath)) !== storagePlanDigest(plan.manifest)) throw new Error('Staged migration manifest changed.');
        } else await atomicWriteJson(manifestPath, plan.manifest, { mkdir: false, createOnly: true });
        await persist('verified');
        assertNoSymlinkPath(path.parse(paths.root).root, paths.stage);
        assertNoSymlinkPath(path.parse(paths.root).root, paths.published, { allowMissing: true });
        if (await exists(paths.published)) throw new Error('Destination publication conflicted; neither copy was replaced.');
        // Staging and immutable publication share a parent on the target volume.
        await fs.rename(paths.stage, paths.published);
        await syncParentDirectory(paths.published);
      }
      await requirePublishedMarker(plan, paths);
      await verifyCopy(plan, data, signal);
      if (await owner.verifyDestination({ plan, root: data, signal }) !== true) throw new Error('Category owner rejected the published destination.');
      await persist('published');
      const configLock = await acquireFileLock({ lockPath: path.join(plan.home, 'config', 'storage-locator.lock'), waitMs: 0,
        staleMs: Number.MAX_SAFE_INTEGER, metadata: { scope: 'storage-locator', planId: plan.planId } });
      if (!configLock) throw new Error('Storage locator is owned by another operation.');
      let selectionError = null;
      try {
        const current = readStorageLocator(plan.home);
        const selection = current.value?.categories?.[plan.category];
        if (selection?.migrationId === plan.planId && !exactSelection(selection, plan, data)) {
          throw new Error('Storage locator reused this migration identity for a different path or category owner.');
        }
        const alreadySelected = current.status === 'present' && exactSelection(selection, plan, data);
        if (!alreadySelected) {
          await revalidateStorageAuthority(plan.authoritySnapshots, authorityRoots);
          await buildStorageMigrationManifest({ root: plan.source, ...plan.limits, signal, expectedManifest: plan.manifest });
          await verifyCopy(plan, data, signal);
          if (current.status === 'invalid' || current.sha256 !== plan.locatorBeforeHash) throw new Error('Storage locator changed after preview; published copy is preserved.');
          const next = { schemaVersion: 1, categories: { ...current.value.categories,
            [plan.category]: { path: data, migrationId: plan.planId, owner: plan.owner.id } } };
          await writeStorageLocator(plan.home, next, { expectedHash: current.sha256 });
        }
      } catch (error) { selectionError = error; throw error; }
      finally { await releaseStorageOperationLock(configLock, selectionError); }
      await persist('selected');
      return { ...journal, selectedPath: data, complete: true, sourcePreserved: true, mutationPerformed: true,
        rollback: 'applyStorageMigrationRollback with the same reviewed plan; no copy is deleted' };
    });
  } catch (error) {
    journal.failures = [...(journal.failures || []).slice(-15), { code: error.code || 'ERR_STORAGE_MIGRATION', message: error.message }];
    let journalFailure = null;
    if (journalWritable) {
      try { await persist('interrupted'); } catch (journalError) { journalFailure = journalError; }
    }
    operationError = addStorageFailureContext(error, {
      recovery: { journal: paths.journal, sourcePreserved: true, staging: paths.stage, published: paths.published },
      ...(journalFailure ? { journalFailure: journalFailure.message } : {})
    }, journalFailure);
    throw operationError;
  } finally { await releaseStorageOperationLock(lock, operationError); }
};

export const readStorageMigrationStatus = async (plan, { authorityRoots = [] } = {}) => {
  requirePlanIdentity(plan);
  const paths = pathsFor(plan);
  assertSafeCacheDeletion(paths.journal, authorityRoots);
  if (!(await exists(paths.journal))) return { schemaVersion: 1, planId: plan.planId, stage: 'not-started', sourcePreserved: true };
  return readJournal(paths.journal, plan);
};

export const applyStorageMigrationRollback = async (plan, { approvedPlanId, owner, authorityRoots = [], signal = null, hooks = {} } = {}) => {
  requirePlan(plan, approvedPlanId, owner);
  const paths = pathsFor(plan);
  await revalidateStorageAuthority(plan.authoritySnapshots, authorityRoots);
  for (const target of [plan.source, plan.destination, plan.home, plan.recoveryRoot, plan.coordinationRoot]) assertSafeCacheDeletion(target, authorityRoots);
  const operationLock = await acquireFileLock({ lockPath: `${paths.journal}.lock`, waitMs: 0,
    staleMs: Number.MAX_SAFE_INTEGER, metadata: { scope: 'storage-migration-rollback', planId: plan.planId } });
  if (!operationLock) throw new Error('Migration recovery is already owned by another operation.');
  let operationError = null;
  try {
    const saved = await readRecord(paths.savedPlan);
    if (storagePlanDigest(saved) !== storagePlanDigest(plan)) throw new Error('Rollback saved plan differs from this reviewed identity.');
    let journal = await readJournal(paths.journal, plan);
    const data = path.join(paths.published, 'data');
    return await withExclusiveRoots([plan.source, data], { coordinationRoot: plan.coordinationRoot }, async exclusiveOwners => {
      await revalidateStorageAuthority(plan.authoritySnapshots, authorityRoots);
      await requirePublishedMarker(plan, paths);
      await buildStorageMigrationManifest({ root: plan.source, ...plan.limits, signal, expectedManifest: plan.manifest });
      await verifyCopy(plan, path.join(paths.published, 'data'), signal);
      const proof = await storageMigrationOwnerProof(owner, { ...plan, phase: 'rollback', exclusiveOwners, signal });
      if (storagePlanDigest(proof) !== storagePlanDigest(plan.owner)) throw new Error('Rollback category owner cannot confirm retained identities.');
      const lock = await acquireFileLock({ lockPath: path.join(plan.home, 'config', 'storage-locator.lock'), waitMs: 0,
        staleMs: Number.MAX_SAFE_INTEGER, metadata: { scope: 'storage-locator-rollback', planId: plan.planId } });
      if (!lock) throw new Error('Storage locator is owned by another operation.');
      let selectionError = null;
      try {
        const current = readStorageLocator(plan.home);
        if (current.status !== 'present') throw new Error('Rollback cannot replace an invalid or missing category selection.');
        if (['rollback-prepared', 'rolled-back'].includes(journal.stage) && journal.rollbackTarget
          && storagePlanDigest(current.value) === storagePlanDigest(journal.rollbackTarget)) {
          if (journal.stage !== 'rolled-back') {
            await atomicWriteJson(paths.journal, { ...journal, stage: 'rolled-back', sourcePreserved: true,
              destinationPreserved: true, updatedAt: new Date().toISOString() }, { mkdir: false });
          }
          return { schemaVersion: 1, planId: plan.planId, stage: 'rolled-back', complete: true,
            sourcePreserved: true, destinationPreserved: true, mutationPerformed: journal.stage !== 'rolled-back', resumed: true };
        }
        if (journal.stage === 'rolled-back' || !exactSelection(current.value.categories[plan.category], plan, data)) {
          throw new Error('Rollback cannot replace a newer or mismatched category selection.');
        }
        await revalidateStorageAuthority(plan.authoritySnapshots, authorityRoots);
        const categories = { ...current.value.categories };
        if (plan.priorSelection) categories[plan.category] = plan.priorSelection;
        else delete categories[plan.category];
        const rollbackTarget = { schemaVersion: 1, categories };
        if (journal.stage === 'rollback-prepared') {
          if (current.sha256 !== journal.rollbackFromHash || storagePlanDigest(rollbackTarget) !== storagePlanDigest(journal.rollbackTarget)) {
            throw new Error('Storage locator changed after rollback intent; the original intent and current selection are preserved.');
          }
        } else {
          journal = { ...journal, stage: 'rollback-prepared', rollbackTarget, rollbackFromHash: current.sha256,
            sourcePreserved: true, destinationPreserved: true, updatedAt: new Date().toISOString() };
          await atomicWriteJson(paths.journal, journal, { mkdir: false });
          await hooks.afterRollbackPrepared?.();
        }
        await writeStorageLocator(plan.home, journal.rollbackTarget, { expectedHash: journal.rollbackFromHash });
        await hooks.afterRollbackSelection?.();
        await atomicWriteJson(paths.journal, { ...journal, stage: 'rolled-back', sourcePreserved: true,
          destinationPreserved: true, updatedAt: new Date().toISOString() }, { mkdir: false });
        return { schemaVersion: 1, planId: plan.planId, stage: 'rolled-back', complete: true,
          sourcePreserved: true, destinationPreserved: true, mutationPerformed: true };
      } catch (error) { selectionError = error; throw error; }
      finally { await releaseStorageOperationLock(lock, selectionError); }
    });
  } catch (error) {
    operationError = addStorageFailureContext(error, { recovery: { journal: paths.journal, sourcePreserved: true, published: paths.published,
      remedy: 'Resume reviewed rollback; pointer publication alone is not settlement.' } });
    throw operationError;
  } finally { await releaseStorageOperationLock(operationLock, operationError); }
};
