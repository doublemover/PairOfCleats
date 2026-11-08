import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../contained-file.js';
import { isPathWithinRoot } from '../file-paths.js';
import { atomicWriteJson } from '../io/atomic-write.js';
import { acquireFileLock } from '../locks/file-lock.js';
import { addStorageFailureContext } from './operation-error.js';
import { releaseStorageOperationLock } from './operation-lock.js';
import { storagePlanDigest } from './migration-plan.js';
import { readStoragePolicy } from './probe-policy-read.js';
import { STORAGE_POLICY_VERSION, assertStoragePolicyCategory, assertStoragePolicy,
  COMMAND_PROBE_STORAGE_POLICY_SCHEMA, LIFECYCLE_QUOTA_POLICY_SCHEMA } from '../../contracts/schemas/storage-policy.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';

const capturePolicy = (category, policy, options = {}) => {
  assertStoragePolicyCategory(category);
  const captured = captureSemanticRequest(policy, category === 'command-probes'
    ? COMMAND_PROBE_STORAGE_POLICY_SCHEMA : LIFECYCLE_QUOTA_POLICY_SCHEMA);
  return assertStoragePolicy(category, captured, options);
};

const locations = (home, repoRoot = null) => {
  if (!path.isAbsolute(home || '') || path.parse(home).root === path.resolve(home)) throw new Error('Policy requires an explicit absolute application home, never a volume root.');
  home = path.resolve(home);
  if (repoRoot && isPathWithinRoot(home, path.resolve(repoRoot))) throw new Error('Machine storage policy cannot be written inside portable project configuration.');
  const config = path.join(home, 'config');
  assertNoSymlinkPath(path.parse(config).root, config, { allowMissing: true });
  return { home, config };
};

export const planStoragePolicy = async ({ home, category = 'command-probes', patch = {}, repoRoot = null } = {}) => {
  const selected = locations(home, repoRoot);
  assertStoragePolicyCategory(category);
  patch = capturePolicy(category, patch, { partial: true });
  const before = readStoragePolicy(selected.home, { category });
  if (before.status === 'invalid') throw new Error('Invalid storage policy must be repaired without replacing unknown evidence.');
  const policy = capturePolicy(category, { ...before.policy, ...patch });
  const body = { schemaVersion: STORAGE_POLICY_VERSION, kind: 'pairofcleats-storage-policy-plan', home: selected.home,
    repoRoot: repoRoot ? path.resolve(repoRoot) : null, category, file: before.target, beforeHash: before.sha256,
    before: before.policy, after: policy, priorSelection: before.value.policies[category] || null,
    effectiveDiff: Object.fromEntries(Object.keys(patch).map(key => [key, { before: before.policy[key], after: policy[key] }])),
    omittedFields: 'preserve-current-or-unselected-default; supplied-global-and-scopes-replace-their-complete-records', zeroSemantics: 'literal-zero-never-unlimited',
    cacheMutationPerformed: false, mutationPerformed: false, ready: true,
    impact: category === 'lifecycle' ? 'next-reviewed-quota-plan-uses-selected-bounds; no-eviction-on-policy-publication'
      : policy.enabled && policy.entryLimit > 0 && policy.hardBytes > 0 && policy.maxAgeMs > 0
        ? 'next-cache-use-applies-bounds; owned-probes-only; unknown-and-pinned-data-retained'
        : 'cache-reads-and-writes-bypassed; existing-bytes-preserved', restartRequired: false };
  return { ...body, planId: storagePlanDigest(body), dryRun: true };
};

export const applyStoragePolicy = async (plan, { approvedPlanId, home, category, repoRoot = null } = {}) => {
  const { planId, dryRun, ...body } = plan || {};
  void dryRun;
  if (body.kind !== 'pairofcleats-storage-policy-plan' || body.schemaVersion !== STORAGE_POLICY_VERSION
    || planId !== storagePlanDigest(body) || approvedPlanId !== planId || body.ready !== true
    || body.category !== category || !path.isAbsolute(home || '') || path.resolve(home) !== body.home) {
    throw new Error('Policy apply requires the exact reviewed plan, category and launch-selected home.');
  }
  const selected = locations(home, repoRoot || body.repoRoot);
  const policy = capturePolicy(category, body.after);
  const lock = await acquireFileLock({ lockPath: path.join(selected.config, 'storage-policy.lock'), waitMs: 0,
    staleMs: Number.MAX_SAFE_INTEGER, metadata: { scope: 'storage-policy', planId } });
  if (!lock) throw new Error('Another owner is publishing storage policy.');
  let operationError = null;
  try {
    const before = readStoragePolicy(selected.home, { category });
    if (before.status === 'invalid' || before.sha256 !== body.beforeHash || before.target !== body.file) throw new Error('Storage policy changed after review.');
    const directory = path.join(selected.config, 'storage-policy-selections');
    assertNoSymlinkPath(path.parse(directory).root, directory, { allowMissing: true });
    await fs.mkdir(directory, { recursive: true });
    const receipt = { schemaVersion: STORAGE_POLICY_VERSION, kind: 'pairofcleats-storage-policy-selection', selectionId: planId,
      home: selected.home, category, policy, priorSelection: body.priorSelection };
    const receiptFile = path.join(directory, `${planId}.json`);
    try { await atomicWriteJson(receiptFile, receipt, { mkdir: false, createOnly: true }); }
    catch (error) {
      let code, causeCode;
      try { code = error?.code; causeCode = error?.causeCode; }
      catch (inspection) { throw addStorageFailureContext(error, { storagePolicyInspectionError: inspection }, inspection,
        { secondaryPresent: true }); }
      if (code !== 'EEXIST' && causeCode !== 'EEXIST') throw error;
      const existing = JSON.parse((await readVerifiedContainedFile(directory, receiptFile, { maxBytes: 1024 * 1024 })).buffer.toString('utf8'));
      if (storagePlanDigest(existing) !== storagePlanDigest(receipt)) throw new Error('Immutable storage policy receipt conflicts; all existing bytes are preserved.');
    }
    const sealed = await readVerifiedContainedFile(directory, receiptFile, { maxBytes: 1024 * 1024 });
    const value = { schemaVersion: STORAGE_POLICY_VERSION, kind: 'pairofcleats-storage-policy-locator', policies: {
      ...before.value.policies, [category]: { policy, selectionId: planId, receiptHash: sealed.hash }
    } };
    await atomicWriteJson(before.target, value, { mkdir: false, beforeCommit: () => {
      assertNoSymlinkPath(path.parse(before.target).root, before.target, { allowMissing: true });
      const current = readStoragePolicy(selected.home, { category });
      if (current.status === 'invalid' || current.sha256 !== body.beforeHash) throw new Error('Storage policy changed before publication.');
    } });
    return { schemaVersion: STORAGE_POLICY_VERSION, planId, category, complete: true, mutationPerformed: true,
      cacheMutationPerformed: false, file: before.target, receiptFile, policy,
      restartRequired: false, existingCacheBytesPreserved: true };
  } catch (value) {
    operationError = value !== null && ['object', 'function'].includes(typeof value) ? value : new Error(String(value), { cause: value });
    throw operationError;
  } finally { await releaseStorageOperationLock(lock, operationError); }
};
