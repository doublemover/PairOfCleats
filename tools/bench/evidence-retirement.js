import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { withFileLock } from '../../src/shared/locks/file-lock.js';
import { withStorageDirectory } from '../../src/shared/storage/directory.js';
import { inspectStorageInventory, storageFileIdentity, sameStorageFileIdentity } from '../../src/shared/storage/inventory.js';
import { readVerifiedContainedFile, assertNoSymlinkPath } from '../../src/shared/contained-file.js';
import { sha256FileObservation } from '../../src/shared/hash.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { throwIfAborted } from '../../src/shared/abort.js';
import { BENCH_EVIDENCE_VERSION, BENCH_EVIDENCE_OWNER, BENCH_EVIDENCE_SETTLED, BENCH_EVIDENCE_LOCK,
  BENCH_EVIDENCE_ROOT, BENCH_EVIDENCE_CONTROL, BENCH_EVIDENCE_MAX_FILES, BENCH_EVIDENCE_RECORD_BYTES,
  BENCH_EVIDENCE_MIN_AGE_MS, BENCH_EVIDENCE_FAMILIES, benchmarkEvidenceName, benchmarkEvidenceId,
  benchmarkEvidenceRootIdentity, sameBenchmarkEvidenceRoot, benchmarkEvidenceFailure } from './evidence-contract.js';

const maintenanceOwners = new WeakMap();

/** Only this original in-process scope can authorize cooperative collection.
 * Serialized fields, a matching directory name or a copied ID grant no owner. */
export const withBenchmarkEvidenceMaintenance = async ({ root, familyRoot, family, signal = null }, action) => {
  root = path.resolve(root); familyRoot = path.resolve(familyRoot);
  if (!BENCH_EVIDENCE_FAMILIES.includes(family) || typeof action !== 'function') throw new TypeError('Invalid benchmark evidence maintenance owner.');
  const control = path.join(familyRoot, BENCH_EVIDENCE_CONTROL);
  assertNoSymlinkPath(root, control, { allowMissing: true });
  let entered = false;
  const result = await withFileLock({ lockPath: path.join(control, 'maintenance.lock'), waitMs: 5000,
    staleMs: Number.MAX_SAFE_INTEGER, signal,
    metadata: { scope: 'benchmark-evidence-maintenance', hostname: os.hostname(), resourceSettlementVersion: 1 } }, async () => {
    entered = true;
    const owner = Object.freeze({}), scope = { root, familyRoot, family, active: true };
    maintenanceOwners.set(owner, scope);
    try { return await action(owner); } finally { scope.active = false; }
  });
  if (!entered) throw benchmarkEvidenceFailure('ERR_BENCH_EVIDENCE_BUSY', 'Another or unsettled benchmark evidence maintenance owner is active.');
  return result;
};

const budgetFailure = () => benchmarkEvidenceFailure('ERR_BENCH_EVIDENCE_SCAN_BUDGET', 'Benchmark evidence metadata scan allowance is exhausted.');
const readRecord = async (root, filename, { budget = null, signal = null, maxBytes = BENCH_EVIDENCE_RECORD_BYTES } = {}) => {
  const allowance = Math.min(maxBytes, budget?.remaining ?? maxBytes);
  if (allowance < 1) throw budgetFailure();
  // Reserve before dispatch; failed reads never acquire an unlimited refill.
  if (budget) budget.remaining -= allowance;
  const read = await readVerifiedContainedFile(root, filename, { maxBytes: allowance, signal });
  if (budget) budget.remaining += allowance - read.buffer.length;
  return { ...read, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.buffer)) };
};
const optionalStat = async target => {
  try { return await fs.lstat(target, { bigint: true }); }
  catch (error) {
    if (describeStorageFailure(error, { phase: 'benchmark-evidence-retirement-stat' }).code === 'ENOENT') return null;
    throw error;
  }
};
const unchanged = async (filename, identity) => sameStorageFileIdentity(identity, storageFileIdentity(await fs.lstat(filename, { bigint: true })));

/** Caller holds the family maintenance owner. Referenced/unknown/active data
 * stays protected. Only complete flat run inventories can authorize retirement. */
const retireUnderMaintenance = async ({ root, familyRoot, family, owner, signal, observedNow, budget, outcome }) => {
  familyRoot = path.resolve(familyRoot); root = path.resolve(root);
  const scope = maintenanceOwners.get(owner);
  if (!scope?.active || scope.root !== root || scope.familyRoot !== familyRoot || scope.family !== family) {
    throw benchmarkEvidenceFailure('ERR_BENCH_EVIDENCE_AUTHORITY', 'Original benchmark maintenance ownership is required.');
  }
  assertNoSymlinkPath(root, familyRoot);
  const rootStat = await fs.lstat(familyRoot, { bigint: true });
  const markerPath = path.join(familyRoot, BENCH_EVIDENCE_ROOT);
  const marker = (await readRecord(familyRoot, markerPath, { signal, budget })).value;
  if ((await fs.lstat(markerPath, { bigint: true })).nlink !== 1n) throw new Error('Benchmark evidence root marker has a shared physical identity.');
  const protect = (reason, run = true) => { if (run) outcome.protectedRuns++; else outcome.protectedRootEntries++;
    outcome.reasons[reason] = (outcome.reasons[reason] || 0) + 1; };
  if (marker?.schemaVersion !== BENCH_EVIDENCE_VERSION || marker.kind !== 'benchmark-evidence-root'
    || marker.family !== family || marker.root !== familyRoot
    || !sameBenchmarkEvidenceRoot(marker.rootIdentity, benchmarkEvidenceRootIdentity(rootStat))) throw new Error('Benchmark evidence root authority changed.');
  const candidates = await withStorageDirectory(familyRoot, async directory => {
    const result = [];
    let visited = 0;
    for (;;) {
      throwIfAborted(signal);
      const entry = await directory.read(); if (!entry) break;
      if (++visited > BENCH_EVIDENCE_MAX_FILES) throw new Error('Benchmark evidence inventory is incomplete.');
      if ([BENCH_EVIDENCE_ROOT, BENCH_EVIDENCE_CONTROL].includes(entry.name)) continue;
      if (!entry.isDirectory() || !/^run-[a-zA-Z0-9]{6}$/u.test(entry.name)) { protect('unknown-root-entry', false); continue; }
      result.push(entry.name);
    }
    return result;
  });
  for (const candidate of candidates.sort()) {
    throwIfAborted(signal);
    const runDir = path.join(familyRoot, candidate), lockPath = path.join(runDir, BENCH_EVIDENCE_LOCK);
    if (await optionalStat(lockPath)) { protect('active-or-unconfirmed-owner'); continue; }
    let approved = null;
    try {
      assertNoSymlinkPath(familyRoot, runDir);
      const record = await readRecord(runDir, path.join(runDir, BENCH_EVIDENCE_SETTLED), { signal, budget });
      const value = record.value, stat = await fs.lstat(runDir, { bigint: true });
      if (value?.schemaVersion !== BENCH_EVIDENCE_VERSION || value.kind !== 'benchmark-evidence-settlement'
        || value.family !== family || !benchmarkEvidenceId(value.runId) || value.runDir !== runDir || value.state !== 'settled'
        || !sameBenchmarkEvidenceRoot(value.rootIdentity, benchmarkEvidenceRootIdentity(stat))
        || typeof value.referencesIssued !== 'boolean' || value.eligible !== true || !['completed', 'failed'].includes(value.outcome)
        || !Number.isSafeInteger(Date.parse(value.settledAt)) || !Array.isArray(value.files)
        || !value.files.length || value.files.length > BENCH_EVIDENCE_MAX_FILES) { protect('unknown-settlement'); continue; }
      if (value.referencesIssued || value.files.some(file => file?.name === 'final.json')) { protect('saved-or-resume-references'); continue; }
      if (observedNow - Date.parse(value.settledAt) < BENCH_EVIDENCE_MIN_AGE_MS) { protect('recent-settled-evidence'); continue; }
      const names = value.files.map(file => file.name);
      if (new Set(names).size !== names.length || !names.includes(BENCH_EVIDENCE_OWNER)
        || value.files.some(file => !benchmarkEvidenceName(file.name) || [BENCH_EVIDENCE_SETTLED, BENCH_EVIDENCE_LOCK].includes(file.name)
          || file.identity?.nlink !== 1 || !/^sha256:[a-f0-9]{64}$/u.test(file.checksum))) { protect('unknown-file-inventory'); continue; }
      const owner = (await readRecord(runDir, path.join(runDir, BENCH_EVIDENCE_OWNER), { signal, budget })).value;
      if (owner?.schemaVersion !== BENCH_EVIDENCE_VERSION || owner.kind !== 'benchmark-evidence-run' || owner.family !== family
        || owner.runId !== value.runId || owner.runDir !== runDir || !sameBenchmarkEvidenceRoot(owner.rootIdentity, value.rootIdentity)) {
        protect('unknown-run-owner'); continue;
      }
      approved = { value, record };
    } catch (error) {
      const diagnostic = describeStorageFailure(error, { phase: 'benchmark-evidence-retirement-admission' });
      if (diagnostic.code === 'ERR_BENCH_EVIDENCE_SCAN_BUDGET' || signal?.aborted) throw error;
      protect('unreadable-or-unknown-evidence'); continue;
    }
    const removed = await withFileLock({ lockPath, waitMs: 0, staleMs: Number.MAX_SAFE_INTEGER, signal,
      metadata: { scope: 'benchmark-evidence-retirement', hostname: os.hostname(), resourceSettlementVersion: 1 } }, async () => {
      const inventory = await inspectStorageInventory({ roots: [{ id: 'benchmark-run', path: runDir }],
        includeFiles: true, maxEntries: BENCH_EVIDENCE_MAX_FILES + 4, maxDurationMs: 5000, signal });
      const item = inventory.items[0], { value, record } = approved;
      if (!inventory.complete || !item || item.directories.length !== 1) { protect('incomplete-or-nested-inventory'); return false; }
      if (item.files.some(file => file.identity.nlink !== 1)) { protect('shared-physical-file'); return false; }
      const expected = new Set([...value.files.map(file => file.name), BENCH_EVIDENCE_SETTLED, BENCH_EVIDENCE_LOCK]);
      if (item.files.length !== expected.size || item.files.some(file => !expected.has(file.relativePath))) { protect('changed-directory-membership'); return false; }
      for (const file of value.files) {
        const filename = path.join(runDir, file.name);
        if (!await unchanged(filename, file.identity)) { protect('changed-file-identity'); return false; }
        const observed = await sha256FileObservation(filename, { containedRoot: runDir, signal });
        if (!sameBenchmarkEvidenceRoot(observed.fileIdentity, file.identity) || observed.bytes !== file.identity.size
          || `${observed.algo}:${observed.value}` !== file.checksum) { protect('changed-file-content'); return false; }
      }
      const finalRecord = await readRecord(runDir, path.join(runDir, BENCH_EVIDENCE_SETTLED), { signal, budget });
      if (finalRecord.hash !== record.hash || !sameBenchmarkEvidenceRoot(finalRecord.fileIdentity, record.fileIdentity)) { protect('changed-settlement'); return false; }
      if (budget.remaining < record.buffer.length) throw budgetFailure();
      budget.remaining -= record.buffer.length;
      // All members qualify before any unlink. Recheck each exact object again;
      // new/unknown children can only prevent the later empty-directory removal.
      for (const file of value.files) {
        const filename = path.join(runDir, file.name);
        if (!await unchanged(filename, file.identity)) throw new Error('Benchmark evidence changed before its reviewed unlink.');
        const result = await fs.unlink(filename);
        if (result !== undefined) throw new Error('Benchmark evidence unlink did not confirm its standard result.');
        outcome.retiredFiles++; outcome.retiredLogicalBytes += file.identity.size;
      }
      // Finish already-started exact-file retirement without a timer abort in
      // its metadata tail. This final read was reserved before the first unlink.
      const current = await readRecord(runDir, path.join(runDir, BENCH_EVIDENCE_SETTLED), { maxBytes: record.buffer.length });
      if (current.hash !== record.hash || !sameBenchmarkEvidenceRoot(current.fileIdentity, record.fileIdentity)) throw new Error('Benchmark settlement changed before unlink.');
      if (await fs.unlink(path.join(runDir, BENCH_EVIDENCE_SETTLED)) !== undefined) throw new Error('Benchmark settlement unlink remains unconfirmed.');
      outcome.retiredFiles++; outcome.retiredLogicalBytes += record.buffer.length;
      return true;
    });
    if (removed === null) { protect('active-or-unconfirmed-owner'); continue; }
    if (!removed) continue;
    const current = await fs.lstat(runDir, { bigint: true });
    if (!sameBenchmarkEvidenceRoot(approved.value.rootIdentity, benchmarkEvidenceRootIdentity(current))) throw new Error('Benchmark run directory changed before retirement.');
    try {
      if (await fs.rmdir(runDir) !== undefined) throw new Error('Benchmark run retirement remains unconfirmed.');
      outcome.retiredRuns++;
    } catch (error) {
      const diagnostic = describeStorageFailure(error, { phase: 'benchmark-evidence-empty-directory-retirement' });
      if (diagnostic.code !== 'ENOTEMPTY' && diagnostic.code !== 'EEXIST') throw error;
      protect('late-unknown-child');
    }
  }
  return outcome;
};

export const retireSettledBenchmarkEvidence = async options => {
  if (!BENCH_EVIDENCE_FAMILIES.includes(options.family) || options.now !== undefined && typeof options.now !== 'function') {
    throw new TypeError('Unknown benchmark evidence family or clock.');
  }
  const observedNow = (options.now || Date.now)();
  if (!Number.isSafeInteger(observedNow) || observedNow < 0) throw new TypeError('Benchmark retirement requires an observed finite clock.');
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), 5000); timer.unref?.();
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const outcome = { complete: true, retiredRuns: 0, retiredFiles: 0, retiredLogicalBytes: 0,
    protectedRuns: 0, protectedRootEntries: 0, reasons: Object.create(null) };
  try { return await retireUnderMaintenance({ ...options, signal, observedNow, budget: { remaining: 64 * 1024 * 1024 }, outcome }); }
  catch (error) {
    const diagnostic = describeStorageFailure(error, { phase: 'benchmark-evidence-retirement' });
    if (!options.signal?.aborted && (deadline.signal.aborted || diagnostic.code === 'ERR_BENCH_EVIDENCE_SCAN_BUDGET')) {
      return { ...outcome, complete: false, stopped: deadline.signal.aborted ? 'maintenance-time-budget' : 'metadata-byte-budget' };
    }
    throw addStorageFailureContext(error, { benchmarkEvidenceRetirement: outcome });
  } finally { clearTimeout(timer); }
};
