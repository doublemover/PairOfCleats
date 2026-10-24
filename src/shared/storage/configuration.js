import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../contained-file.js';
import { isPathWithinRoot } from '../file-paths.js';
import { atomicWriteJson } from '../io/atomic-write.js';
import { acquireFileLock } from '../locks/file-lock.js';
import { addStorageFailureContext } from './operation-error.js';
import { releaseStorageOperationLock } from './operation-lock.js';
import { readStorageLocator, writeStorageLocator } from './locator.js';
import { storagePlanDigest } from './migration-plan.js';
import { storageFileIdentity, sameStorageFileIdentity } from './inventory.js';
import { withStorageDirectory } from './directory.js';
import { observeStorageResource } from './failure-observation.js';

// Only these existing application callers consume category selections. Adding
// a descriptor alone must not make a configure receipt claim caller adoption.
export const CONFIGURABLE_STORAGE_CATEGORIES = Object.freeze([
  'cache', 'models', 'dictionaries', 'extensions', 'tooling', 'tmp'
]);

const settleObservations = async operations => {
  const results = await Promise.allSettled(operations);
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (failures.length) {
    const first = failures[0];
    const primary = first !== null && ['object', 'function'].includes(typeof first) ? first : addStorageFailureContext(first, {});
    throw failures.slice(1).reduce((error, secondary) => addStorageFailureContext(error, {}, secondary,
      { secondaryPresent: true }), primary);
  }
  return results.map(result => result.value);
};

const observationCode = observation => {
  observation.requireSettled();
  let code;
  try { code = observation.primary.code; }
  catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled();
  return code;
};

const inspectDirectory = async target => {
  assertNoSymlinkPath(path.parse(target).root, target, { allowMissing: true });
  let observed = false;
  try {
    const stat = await fs.lstat(target, { bigint: true });
    observed = true;
    if (!stat.isDirectory()) return { status: 'unexpected-file', empty: false };
    const first = await withStorageDirectory(target, directory => directory.read());
    const after = await fs.lstat(target, { bigint: true });
    if (!sameStorageFileIdentity(storageFileIdentity(stat), storageFileIdentity(after))) throw new Error('Storage directory changed during configuration preview.');
    return { status: 'present', empty: first === null, identity: storageFileIdentity(after) };
  } catch (error) {
    const observation = observeStorageResource(error, { phase: 'configuration-directory-observation' });
    observation.requireSettled();
    if (observed || observationCode(observation) !== 'ENOENT') throw observation.primary;
    const missing = [observation];
    const requireMissingSettled = () => { for (const original of missing) original.requireSettled(); };
    let ancestor = path.dirname(target);
    try {
      for (;;) {
        requireMissingSettled();
        let stat, ancestorObservation;
        try {
          stat = await fs.lstat(ancestor, { bigint: true });
        } catch (ancestorError) {
          ancestorObservation = observeStorageResource(ancestorError, { phase: 'configuration-ancestor-observation' });
          if (observationCode(ancestorObservation) !== 'ENOENT' || path.dirname(ancestor) === ancestor) throw ancestorObservation.primary;
        }
        requireMissingSettled();
        if (ancestorObservation) { missing.push(ancestorObservation); ancestor = path.dirname(ancestor); continue; }
        if (!stat.isDirectory()) throw new Error('Storage destination ancestor is not a directory.');
        const ancestorIdentity = storageFileIdentity(stat);
        requireMissingSettled();
        return { status: 'missing', empty: true, ancestor, ancestorIdentity };
      }
    } catch (ancestorFailure) {
      // Keep earlier original observations even when a different later ancestor
      // rejects. The new error does not settle work observed before its await.
      throw missing.reduce((failure, original) => original.retain(failure,
        { inspectionPresent: true, inspectionPrimary: true }), ancestorFailure);
    }
  }
};

const sameDirectoryObservation = (expected, actual) => {
  if (expected.status !== actual.status || expected.empty !== actual.empty) return false;
  if (expected.status === 'present') return sameStorageFileIdentity(expected.identity, actual.identity);
  if (expected.status === 'missing') return expected.ancestor === actual.ancestor
    && ['dev', 'ino', 'mode'].every(key => expected.ancestorIdentity[key] === actual.ancestorIdentity[key]);
  return false;
};

// Lock preparation may create home/config while a category beneath home is
// still absent. Retain exactly those newly created ancestors; unrelated new
// directories and replacement ancestors still invalidate the reviewed plan.
const prepareConfigurationDirectory = async directory => {
  const firstCreated = await fs.mkdir(directory, { recursive: true });
  const owned = new Map();
  if (!firstCreated) return owned;
  const boundary = path.resolve(firstCreated);
  for (let current = directory; ; current = path.dirname(current)) {
    assertNoSymlinkPath(path.parse(current).root, current);
    const stat = await fs.lstat(current, { bigint: true });
    if (!stat.isDirectory()) throw new Error('Configuration metadata ancestor is not a directory.');
    owned.set(current, storageFileIdentity(stat));
    if (current === boundary) break;
    if (!isPathWithinRoot(current, boundary) || path.dirname(current) === current) {
      throw new Error('Configuration directory preparation escaped its created owner.');
    }
  }
  return owned;
};

const inspectPreparedDirectory = async (target, expected, owned) => {
  const actual = await inspectDirectory(target);
  if (expected.status !== 'missing' || actual.status !== 'missing'
    || expected.ancestor === actual.ancestor) return actual;
  for (let current = actual.ancestor; current !== expected.ancestor; current = path.dirname(current)) {
    const identity = owned.get(current);
    if (!identity || !isPathWithinRoot(current, expected.ancestor) || path.dirname(current) === current) return actual;
    assertNoSymlinkPath(path.parse(current).root, current);
    const stat = await fs.lstat(current, { bigint: true });
    const observed = storageFileIdentity(stat);
    if (!stat.isDirectory() || !['dev', 'ino', 'mode'].every(key => identity[key] === observed[key])) return actual;
  }
  const ancestor = await fs.lstat(expected.ancestor, { bigint: true });
  return { ...actual, ancestor: expected.ancestor, ancestorIdentity: storageFileIdentity(ancestor) };
};
const machineSource = async file => {
  if (!file) return null;
  const source = await readVerifiedContainedFile(path.parse(file).root, file, { maxBytes: 1024 * 1024 });
  return { path: file, sha256: source.hash };
};
const validateLocations = ({ home, target, source, repoRoot }) => {
  for (const value of [home, target, source]) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || path.parse(value).root === path.resolve(value)) {
      throw new Error('Configuration requires explicit absolute application and category directories, never a volume root.');
    }
    if (repoRoot && isPathWithinRoot(value, path.resolve(repoRoot))) throw new Error('Machine storage selection cannot be saved inside a portable project.');
    assertNoSymlinkPath(path.parse(value).root, value, { allowMissing: true });
  }
  if (target !== source && (isPathWithinRoot(target, source) || isPathWithinRoot(source, target))) {
    throw new Error('Category selection cannot nest or contain its previous location.');
  }
  if (isPathWithinRoot(home, target) || isPathWithinRoot(target, path.join(home, 'config'))) {
    throw new Error('A category selection cannot contain application home or overwrite its configuration owner.');
  }
};

/** Configuration selects an empty location; relocation of existing bytes uses
 * the category migration owner. Neither operation grants deletion authority.
 */
export const planStorageConfiguration = async ({ layout, category, target, currentPath = null,
  currentSource = null, machineConfigPath = null, repoRoot = null } = {}) => {
  if (!layout?.descriptors?.[category] || !CONFIGURABLE_STORAGE_CATEGORIES.includes(category)) {
    throw new Error('Configuration requires a category with adopted application callers.');
  }
  const home = path.resolve(layout.home.path);
  const source = path.resolve(currentPath || layout.descriptors[category].path);
  if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('Configuration requires an absolute target.');
  target = path.resolve(target);
  validateLocations({ home, target, source, repoRoot });
  const locator = readStorageLocator(home);
  if (locator.status === 'invalid') throw new Error('Repair the invalid storage locator before configuration.');
  const [sourceObservation, destinationObservation, configurationSource] = await settleObservations([
    inspectDirectory(source), inspectDirectory(target), machineSource(machineConfigPath)
  ]);
  const blocked = [];
  const selectedSourceBefore = currentSource || layout.descriptors[category].source;
  const shadowedByExplicitOverride = selectedSourceBefore !== 'layout-default'
    && !selectedSourceBefore.startsWith('locator.categories.');
  if (source !== target && shadowedByExplicitOverride) blocked.push('explicit-current-override-would-shadow-locator-selection');
  if (sourceObservation.status === 'unexpected-file' || destinationObservation.status === 'unexpected-file') blocked.push('category-location-is-not-a-directory');
  if (source !== target && !sourceObservation.empty) blocked.push('existing-source-requires-verified-category-migration');
  if (source !== target && !destinationObservation.empty) blocked.push('nonempty-destination-is-not-adopted-by-configuration');
  const body = { schemaVersion: 1, kind: 'pairofcleats-storage-configuration-plan', home, category,
    configFile: locator.target, configurationSource, repoRoot: repoRoot ? path.resolve(repoRoot) : null,
    selectedSourceBefore, before: source, after: target,
    locatorBeforeHash: locator.sha256, priorSelection: locator.value.categories[category] || null,
    sourceObservation, destinationObservation,
    selectionDiff: { [`categories.${category}`]: { before: source, after: target } },
    effectiveDiff: { [`categories.${category}`]: { before: source, after: shadowedByExplicitOverride ? source : target } },
    shadowedByExplicitOverride, activation: shadowedByExplicitOverride
      ? 'Current explicit override retains precedence; remove or change it through its existing owner before relocation.'
      : 'Restart adopted consumers after selection.',
    migrationRequired: source !== target && !sourceObservation.empty, restartRequired: true,
    sourcePreserved: true, deletionAuthority: false, blocked, ready: blocked.length === 0,
    writableDestination: 'unchecked-no-probe-or-category-directory-creation', mutationPerformed: false };
  return { ...body, planId: storagePlanDigest(body), dryRun: true };
};

export const applyStorageConfiguration = async (plan, { approvedPlanId, home, category, target } = {}) => {
  const { planId, dryRun, ...body } = plan || {};
  void dryRun;
  if (body.kind !== 'pairofcleats-storage-configuration-plan' || body.schemaVersion !== 1 || body.ready !== true
    || !CONFIGURABLE_STORAGE_CATEGORIES.includes(body.category) || planId !== storagePlanDigest(body)
    || approvedPlanId !== planId || !path.isAbsolute(home || '') || path.resolve(home) !== body.home
    || category !== body.category || !path.isAbsolute(target || '') || path.resolve(target) !== body.after) {
    throw new Error('Configuration requires the exact reviewed plan and explicit launch-selected home, category and target.');
  }
  validateLocations({ home: body.home, target: body.after, source: body.before, repoRoot: body.repoRoot });
  if (body.before !== body.after && body.shadowedByExplicitOverride) throw new Error('Current explicit override retains authority; locator publication cannot relocate that category.');
  const directory = path.join(body.home, 'config');
  assertNoSymlinkPath(path.parse(directory).root, directory, { allowMissing: true });
  const initial = await settleObservations([inspectDirectory(body.before), inspectDirectory(body.after)]);
  if (!sameDirectoryObservation(body.sourceObservation, initial[0])
    || !sameDirectoryObservation(body.destinationObservation, initial[1])) {
    throw new Error('Storage source or destination changed after preview; both are preserved.');
  }
  const preparedDirectories = await prepareConfigurationDirectory(directory);
  const lock = await acquireFileLock({ lockPath: path.join(directory, 'storage-locator.lock'), waitMs: 0,
    staleMs: Number.MAX_SAFE_INTEGER, metadata: { scope: 'storage-locator', planId } });
  if (!lock) throw new Error('Storage locator already has an exclusive configuration owner.');
  let operationError = null;
  try {
    const current = readStorageLocator(body.home);
    if (current.status === 'invalid' || current.sha256 !== body.locatorBeforeHash) throw new Error('Storage locator changed after configuration preview.');
    if (storagePlanDigest(await machineSource(body.configurationSource?.path)) !== storagePlanDigest(body.configurationSource)) {
      throw new Error('Trusted machine configuration changed after preview.');
    }
    const [source, destination] = await settleObservations([
      inspectPreparedDirectory(body.before, body.sourceObservation, preparedDirectories),
      inspectPreparedDirectory(body.after, body.destinationObservation, preparedDirectories)
    ]);
    if (!sameDirectoryObservation(body.sourceObservation, source) || !sameDirectoryObservation(body.destinationObservation, destination)) {
      throw new Error('Storage source or destination changed after preview; both are preserved.');
    }
    const selections = path.join(directory, 'storage-selections');
    assertNoSymlinkPath(path.parse(selections).root, selections, { allowMissing: true });
    await fs.mkdir(selections, { recursive: true });
    const receipt = { schemaVersion: 1, kind: 'pairofcleats-storage-configuration-selection',
      selectionId: planId, home: body.home, category: body.category, path: body.after,
      priorSelection: body.priorSelection, sourcePreserved: true, deletionAuthority: false };
    const receiptFile = path.join(selections, `${planId}.json`);
    const published = `${JSON.stringify(receipt, null, 2)}\n`;
    try { await atomicWriteJson(receiptFile, receipt, { mkdir: false, createOnly: true }); }
    catch (error) {
      if (error.code !== 'EEXIST' && error.causeCode !== 'EEXIST') throw error;
      const existing = await readVerifiedContainedFile(selections, receiptFile, { maxBytes: 1024 * 1024 });
      if (existing.buffer.toString('utf8') !== published) throw new Error('Immutable configuration receipt conflicts; existing bytes are preserved.');
    }
    const sealed = await readVerifiedContainedFile(selections, receiptFile, { maxBytes: 1024 * 1024 });
    await writeStorageLocator(body.home, { schemaVersion: 1, categories: { ...current.value.categories,
      [body.category]: { path: body.after, migrationId: planId, selectionKind: 'configuration', receiptHash: sealed.hash } } }, {
      expectedHash: current.sha256
    });
    return { schemaVersion: 1, planId, complete: true, mutationPerformed: true, selectedPath: body.after,
      restartRequired: true, sourcePreserved: true, destinationCreated: false, deletionAuthority: false,
      configFile: current.target, receiptFile };
  } catch (error) {
    operationError = error !== null && ['object', 'function'].includes(typeof error) ? error : addStorageFailureContext(error, {});
    throw operationError;
  }
  finally { await releaseStorageOperationLock(lock, operationError); }
};
