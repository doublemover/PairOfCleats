import fs from 'node:fs';
import path from 'node:path';
import { inspectStorageInventory } from '../../src/shared/storage/inventory.js';
import { withStorageDirectory } from '../../src/shared/storage/directory.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { persistenceFileIdentity, assertPersistenceFileIdentity } from '../../src/shared/io/file-identity.js';
import { readJsonResourceTextSync } from '../../src/shared/file-read-resource.js';
import { requireCheckoutMutationSession } from './checkout-mutation.js';
import { BOOTSTRAP_RECEIPT } from './checkout-bootstrap-paths.js';
import { getCheckoutEvidenceFiles } from './checkout-evidence-files.js';
import { CHECKOUT_EVIDENCE_LIMITS as limits, evidenceFailure, captureEvidenceParents, checkEvidenceParents,
  readEvidenceFile, readEvidenceJson, publishEvidenceJson } from './checkout-evidence-records.js';

const base = '.tmp/checkout-bootstrap', journal = /^j-[a-zA-Z0-9_-]{6,32}$/;
const manifestName = 'evidence-manifest.json';
const filePattern = /^\.tmp\/checkout-bootstrap\/(?:j-[a-zA-Z0-9_-]{6,32}\/(?:stages\.jsonl|prior-readiness\.json|result\.json)|logs\/n-[a-zA-Z0-9_-]{6,32}\/\d{3}\.(?:stdout|stderr|json))$/;
const leafPattern = /^\.tmp\/checkout-bootstrap\/(?:j-[a-zA-Z0-9_-]{6,32}|logs\/n-[a-zA-Z0-9_-]{6,32})$/;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const runId = value => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(value);

/** Qualify closed text artifacts only through their actual producer group.
 * The manifest is later comparison data for this narrow category adapter; it
 * never retires native work, reclaims a lock, or grants general path authority. */
export const publishCheckoutEvidenceManifest = async (root, session, directory, state) => {
  requireCheckoutMutationSession(root, session);
  const name = path.basename(directory);
  if (!journal.test(name) || path.dirname(directory) !== path.join(root, base) || !['completed', 'failed'].includes(state)) throw evidenceFailure('Evidence manifest requires its original journal destination and terminal state.');
  const closed = getCheckoutEvidenceFiles(root, session).closedFiles();
  const value = { schemaVersion: 1, kind: 'checkout-bootstrap-closed-evidence', root: session.root, runId: session.runId,
    state, finishedAt: Date.now(), journal: base + '/' + name, files: closed.files, parents: closed.parents };
  return publishEvidenceJson(root, session, value.journal + '/' + manifestName, value);
};

const readCandidate = (root, relative) => {
  const selected = readEvidenceJson(root, relative), value = selected.value;
  if (value?.schemaVersion !== 1 || value.kind !== 'checkout-bootstrap-closed-evidence' || value.root !== root
    || !runId(value.runId) || !['completed', 'failed'].includes(value.state) || !Number.isSafeInteger(value.finishedAt) || value.finishedAt < 0
    || value.journal !== path.posix.dirname(relative) || !journal.test(path.posix.basename(value.journal))
    || !Array.isArray(value.files) || !value.files.length || value.files.length > limits.files
    || !Array.isArray(value.parents) || value.parents.length > limits.files * 4) throw evidenceFailure('Unsupported or unbounded closed-evidence manifest.');
  const paths = new Set(), parents = new Map(); let bytes = selected.record.bytes;
  for (const row of value.parents) {
    if (typeof row?.path !== 'string' || !(leafPattern.test(row.path) || [base, '.tmp', base + '/logs'].includes(row.path))
      || parents.has(row.path) || !['dev', 'ino', 'birthtime'].every(key => typeof row[key] === 'string' && row[key].length <= 64)) throw evidenceFailure('Invalid manifest parent comparison.');
    parents.set(row.path, row);
  }
  const leaves = new Map([[value.journal, new Set([manifestName])]]);
  for (const row of value.files) {
    if (!filePattern.test(row?.path) || paths.has(row.path) || !hash(row.sha256) || !Number.isSafeInteger(row.bytes)
      || row.bytes < 0 || row.bytes > limits.fileBytes || !row.identity || typeof row.identity !== 'object'
      || Object.values(row.identity).some(member => typeof member !== 'string' || member.length > 64)) throw evidenceFailure('Invalid manifest file comparison.');
    const leaf = path.posix.dirname(row.path);
    if (!leafPattern.test(leaf) || (leaf.startsWith(base + '/j-') && leaf !== value.journal)) throw evidenceFailure('Manifest crosses an unrelated journal namespace.');
    const parts = row.path.split('/').slice(0, -1);
    for (let index = 1; index <= parts.length; index++) if (!parents.has(parts.slice(0, index).join('/'))) throw evidenceFailure('Manifest omits an original evidence parent.');
    paths.add(row.path); bytes += row.bytes;
    if (!leaves.has(leaf)) leaves.set(leaf, new Set());
    leaves.get(leaf).add(path.posix.basename(row.path));
  }
  if (bytes > limits.reserveBytes || !paths.has(value.journal + '/stages.jsonl') || !paths.has(value.journal + '/result.json')
    || !parents.has(value.journal)) throw evidenceFailure('Manifest lacks its bounded original journal/result evidence.');
  return { ...selected, bytes, leaves, value };
};

const validateCandidate = async (root, session, candidate, checkDeadline) => {
  requireCheckoutMutationSession(root, session);
  const { value, leaves } = candidate;
  checkEvidenceParents(root, value.parents);
  for (const row of [...value.files, candidate.record]) {
    checkDeadline();
    readEvidenceFile(root, row, captureEvidenceParents(root, row.path));
    requireCheckoutMutationSession(root, session);
  }
  const result = readEvidenceJson(root, value.journal + '/result.json', 256 * 1024).value;
  const originalStage = value.files.find(row => row.path === value.journal + '/stages.jsonl');
  if (result?.runId !== value.runId || result.root !== root || result.state !== value.state || result.originalResources !== 'retired'
    || result.file?.path !== originalStage.path || result.file.sha256 !== originalStage.sha256 || result.file.bytes !== originalStage.bytes
    || result.file.complete !== true) throw evidenceFailure('Retained result differs from its original completed owner.');
  const nativeRecords = new Map();
  for (const row of value.files.filter(row => row.path.startsWith(base + '/logs/') && row.path.endsWith('.json'))) {
    checkDeadline();
    const record = readEvidenceJson(root, row.path, 32 * 1024).value;
    if (record?.schemaVersion !== 1 || record.kind !== 'native-command-diagnostics' || record.runId !== value.runId
      || !Array.isArray(record.logs) || record.logs.length > 2) throw evidenceFailure('Native text evidence belongs to a different or invalid original run.');
    nativeRecords.set(row.path.slice(0, -5), record);
  }
  for (const row of value.files.filter(row => /\.(?:stdout|stderr)$/.test(row.path))) {
    const prefix = row.path.replace(/\.(?:stdout|stderr)$/, ''), channel = path.posix.extname(row.path).slice(1);
    const original = nativeRecords.get(prefix)?.logs.find(log => log.channel === channel);
    if (!original || original.path !== path.join(root, row.path) || original.writtenBytes !== row.bytes || original.sha256 !== row.sha256) throw evidenceFailure('Native stream lacks its matching original attempt evidence.');
  }
  for (const [leaf, expected] of leaves) {
    checkDeadline();
    checkEvidenceParents(root, value.parents); let count = 0;
    await withStorageDirectory(path.join(root, leaf), async directory => {
      for (;;) {
        const entry = await directory.read(); if (!entry) break;
        if (++count > expected.size || !expected.has(entry.name) || !entry.isFile() || entry.isSymbolicLink()) throw evidenceFailure('Retained evidence contains unregistered or nonordinary entries.');
      }
    });
    if (count !== expected.size) throw evidenceFailure('Retained evidence membership changed.');
  }
  checkEvidenceParents(root, value.parents); requireCheckoutMutationSession(root, session);
};

const protectedReadinessRun = root => {
  const file = path.join(root, BOOTSTRAP_RECEIPT);
  try {
    const parent = fs.lstatSync(path.dirname(file));
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw evidenceFailure('Readiness protection requires an ordinary dependency directory.');
    const identity = persistenceFileIdentity(fs.lstatSync(file, { bigint: true }));
    const receipt = JSON.parse(readJsonResourceTextSync(file, stat => {
      if (stat.size > limits.fileBytes) throw evidenceFailure('Readiness protection exceeds its read bound.');
    }, stat => assertPersistenceFileIdentity(stat, identity)));
    assertPersistenceFileIdentity(fs.lstatSync(file, { bigint: true }), identity);
    const selected = receipt?.verification?.checkoutRunId;
    return { runId: runId(selected) ? selected : null, protectAll: !runId(selected) };
  } catch (error) {
    const diagnostic = describeStorageFailure(error, { phase: 'checkout-evidence-readiness-protection' });
    return { runId: null, protectAll: diagnostic.code !== 'ENOENT' };
  }
};

/** One bounded read-only inventory, then exact-file cleanup under the already
 * held checkout lock. Unknown, partial or edited evidence stays protected.
 * Ordering timestamps choose retention only; they never infer native closure. */
export const prepareCheckoutEvidenceRetention = async (root, session) => {
  requireCheckoutMutationSession(root, session); root = session.root;
  const inventory = await inspectStorageInventory({ roots: [{ id: 'checkout-bootstrap', category: 'checkout-bootstrap', path: path.join(root, base) }],
    includeFiles: true, maxEntries: limits.entries, maxDurationMs: limits.scanMs });
  requireCheckoutMutationSession(root, session);
  if (!inventory.complete || !Number.isSafeInteger(inventory.totals.logicalAttributedBytes)) throw evidenceFailure('Checkout evidence inventory is incomplete; no cleanup or new evidence admission is authorized.');
  const candidates = [], protectedReasons = []; let protectedCount = 0, inspectedManifests = 0, metadataBytes = 0;
  const protect = (relative, error) => {
    const diagnostic = describeStorageFailure(error, { phase: 'checkout-evidence-retention' });
    protectedCount++; if (protectedReasons.length < 32) protectedReasons.push({ path: relative, code: diagnostic.code });
  };
  for (const row of inventory.items[0].files || []) {
    const relative = row.relativePath.replaceAll('\\', '/');
    if (!/^j-[a-zA-Z0-9_-]{6,32}\/evidence-manifest\.json$/.test(relative)) continue;
    if (++inspectedManifests > limits.manifests || metadataBytes + row.identity.size > limits.metadataBytes) {
      protect(relative, evidenceFailure('Manifest inspection allowance exhausted; remaining evidence stays protected.')); continue;
    }
    metadataBytes += row.identity.size;
    try { candidates.push(readCandidate(root, base + '/' + relative)); }
    catch (error) { protect(relative, error); }
  }
  candidates.sort((a, b) => b.value.finishedAt - a.value.finishedAt || a.value.journal.localeCompare(b.value.journal));
  const readiness = protectedReadinessRun(root), keep = new Set(candidates.slice(0, 2));
  const failed = candidates.find(row => row.value.state === 'failed'); if (failed) keep.add(failed);
  for (const candidate of candidates) if (candidate.value.runId === readiness.runId || readiness.protectAll) keep.add(candidate);
  // Overlapping manifests are not independent deletion claims.
  const claims = new Map();
  for (const candidate of candidates) for (const leaf of candidate.leaves.keys()) {
    if (!claims.has(leaf)) claims.set(leaf, []); claims.get(leaf).push(candidate);
  }
  for (const claimed of claims.values()) if (claimed.length > 1) for (const candidate of claimed) keep.add(candidate);
  let removedBytes = 0, removedFiles = 0, removedRuns = 0;
  const deadline = Date.now() + limits.scanMs, checkDeadline = () => {
    if (Date.now() > deadline) throw evidenceFailure('Closed evidence cleanup exhausted its inspection deadline; remaining runs stay protected.');
  };
  for (const candidate of [...candidates].reverse()) {
    if (keep.has(candidate)) continue;
    try { checkDeadline(); await validateCandidate(root, session, candidate, checkDeadline); }
    catch (error) { protect(candidate.value.journal, error); continue; }
    try {
      for (const row of [...candidate.value.files, candidate.record]) {
        requireCheckoutMutationSession(root, session); checkEvidenceParents(root, candidate.value.parents);
        assertPersistenceFileIdentity(fs.lstatSync(path.join(root, row.path), { bigint: true }), row.identity);
        fs.unlinkSync(path.join(root, row.path)); removedBytes += row.bytes; removedFiles++;
      }
      for (const leaf of candidate.leaves.keys()) {
        requireCheckoutMutationSession(root, session);
        checkEvidenceParents(root, candidate.value.parents.filter(row => leaf === row.path || leaf.startsWith(row.path + '/')));
        fs.rmdirSync(path.join(root, leaf));
      }
    } catch (error) { throw addStorageFailureContext(error, { checkoutEvidenceCleanup: Object.freeze({ removedBytes, removedFiles, removedRuns }) }); }
    removedRuns++;
  }
  let retainedBytes = inventory.totals.logicalAttributedBytes;
  if (removedFiles) {
    const after = await inspectStorageInventory({ roots: [{ id: 'checkout-bootstrap', category: 'checkout-bootstrap', path: path.join(root, base) }],
      includeFiles: false, maxEntries: limits.entries, maxDurationMs: limits.scanMs });
    requireCheckoutMutationSession(root, session);
    if (!after.complete || !Number.isSafeInteger(after.totals.logicalAttributedBytes)) throw evidenceFailure('Post-cleanup evidence inventory is incomplete; no new dependency work is admitted.');
    retainedBytes = after.totals.logicalAttributedBytes;
  }
  if (retainedBytes + limits.reserveBytes > limits.bytes) throw Object.assign(evidenceFailure('Retained checkout evidence exceeds its admission bound. Protected or incomplete files require deliberate inspection; no dependency work started.'), {
    retainedBytes, reserveBytes: limits.reserveBytes, removedBytes, removedFiles, protectedCount, protectedReasons
  });
  return Object.freeze({ retainedBytes, reserveBytes: limits.reserveBytes, limitBytes: limits.bytes,
    removedBytes, removedFiles, removedRuns, protectedCount, protectedReasons: Object.freeze(protectedReasons),
    accounting: 'observed-logical-bytes; allocation-and-deleted-open-bytes-unknown' });
};
