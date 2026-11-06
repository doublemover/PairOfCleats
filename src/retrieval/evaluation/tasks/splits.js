import { performance } from 'node:perf_hooks';
import { semanticHash } from '../../../index/semantic/identity.js';
import { captureSemanticRequest } from '../../../semantic/request-snapshot.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { EVIDENCE_TASK_SCHEMAS, EVIDENCE_TASK_VERSION } from '../../../contracts/schemas/evidence-task.js';
import { assertEvidenceTask } from '../../../contracts/validators/evidence-task.js';
import { inspectEvidenceTaskCompilation, readEvidenceTaskInputs, readEvidenceTaskVisibleManifest, projectCandidateEvidenceTask } from './compiler.js';

const owned = new WeakMap();
const hash = (kind, value) => semanticHash('evidence-task.' + kind + '.v' + EVIDENCE_TASK_VERSION, value, { maxBytes: 1024 * 1024 });
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = message => Object.assign(new Error(message), { code: 'ERR_EVIDENCE_TASK_SPLIT' });
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};

/** Exact/declared leakage components, without consulting oracle answers.
 * Shared source hashes conservatively group equal text even when independent
 * origins are declared: origin independence and memorization leakage differ.
 */
export const assignEvidenceTaskSplits = (tasks, policy, { signal = null } = {}) => {
  const began = performance.now(); throwIfAborted(signal);
  policy = captureSemanticRequest(policy, EVIDENCE_TASK_SCHEMAS.split); assertEvidenceTask('split', policy);
  if (['train', 'dev', 'calibration', 'test'].reduce((sum, name) => sum + policy[name], 0) !== 10000) throw fail('Declared split weights must sum to 10000.');
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > 64 || new Set(tasks).size !== tasks.length) throw fail('Bounded unique compiled tasks required.');
  let sourceBytes = 0;
  const rows = tasks.map(handle => {
    const report = inspectEvidenceTaskCompilation(handle), input = readEvidenceTaskInputs(handle); sourceBytes += report.work.sourceBytes;
    return { handle, report, input, keys: new Set(), parent: null };
  });
  if (sourceBytes > 16 * 1024 * 1024 || new Set(rows.map(row => row.report.compilationId)).size !== rows.length) throw fail('Task split input exceeds source allowance or repeats a compiled identity.');
  const byPublic = new Map();
  for (const row of rows) {
    if (byPublic.has(row.report.publicTaskId) && byPublic.get(row.report.publicTaskId) !== row.report.privateOracleId) throw fail('One visible task has conflicting private oracle revisions in this frozen corpus.');
    byPublic.set(row.report.publicTaskId, row.report.privateOracleId); row.parent = row;
  }
  const root = row => { let at = row; while (at.parent !== at) at = at.parent; return at; };
  const groupsByKey = new Map();
  for (const row of rows) {
    throwIfAborted(signal);
    if (row.report.state === 'quarantined') continue;
    const lineage = row.input.lineage;
    row.keys.add('public-task:' + row.report.publicTaskId); row.keys.add('repository:' + lineage.repositoryFamilyId);
    for (const name of ['cloneFamilyIds', 'issueFixFamilyIds', 'trajectoryFamilyIds', 'sourceOriginIds', 'synthesisAncestorIds']) {
      for (const id of lineage[name]) row.keys.add(name + ':' + id);
    }
    for (const source of readEvidenceTaskVisibleManifest(row.handle)) row.keys.add('exact-source:' + source.sourceHash);
    for (const id of row.keys) {
      const previous = groupsByKey.get(id);
      if (previous) root(row).parent = root(previous); else groupsByKey.set(id, row);
    }
  }
  const components = new Map();
  for (const row of rows) {
    if (row.report.state === 'quarantined') continue;
    const group = root(row); if (!components.has(group)) components.set(group, []); components.get(group).push(row);
  }
  const assignments = [];
  for (const members of components.values()) {
    throwIfAborted(signal);
    const leakageKeys = [...new Set(members.flatMap(row => [...row.keys]))].sort(order);
    const groupId = hash('leakage-component', leakageKeys);
    const bucket = Number(BigInt('0x' + hash('split-bucket', { seed: policy.seed, groupId })) % 10000n);
    let boundary = 0, split = null;
    for (const name of ['train', 'dev', 'calibration', 'test']) { boundary += policy[name]; if (bucket < boundary) { split = name; break; } }
    for (const row of members) assignments.push({ compilationId: row.report.compilationId, publicTaskId: row.report.publicTaskId,
      groupId, split, state: 'frozen', reasons: [] });
  }
  for (const row of rows.filter(row => row.report.state === 'quarantined')) assignments.push({ compilationId: row.report.compilationId,
    publicTaskId: row.report.publicTaskId, groupId: null, split: null, state: 'quarantined', reasons: row.report.reasons });
  assignments.sort((a, b) => order(a.compilationId, b.compilationId));
  const manifest = { schemaVersion: EVIDENCE_TASK_VERSION, kind: 'finite-evidence-task-split', policy, assignments,
    audit: { knownExactAndDeclaredEdges: 'complete-in-supplied-corpus', nearDuplicateCoverage: 'unchecked',
      belowThresholdReview: 'not-performed', futureVisibleSources: 'quarantined-by-compiler', hiddenOracleAvailability: 'retained-privately',
      trainingContamination: 'not-established', falsePositiveGrouping: 'equal-utility/source-text-may-overcluster' } };
  const manifestId = hash('split-manifest', manifest);
  const result = immutable({ ...manifest, manifestId, work: { executionId: hash('split-execution', randomUUID()), sourceBytes, compiledTasks: rows.length, leakageComponents: components.size,
    sourceIdentityReuse: 'compiler-owned-digests; no-text-rehash', elapsedMs: performance.now() - began } });
  const memberships = new Map(rows.map(row => [row.handle, immutable({ ...assignments.find(assignment => assignment.compilationId === row.report.compilationId), manifestId })]));
  owned.set(result, memberships); throwIfAborted(signal); return result;
};

export const evidenceTaskSplitMembership = (manifest, task) => {
  const members = manifest && typeof manifest === 'object' ? owned.get(manifest) : null, membership = members?.get(task);
  if (!membership) throw fail('Original split manifest and exact compiled member required.'); return membership;
};
export const projectRunnableEvidenceTask = (manifest, task, options = {}) => {
  const membership = evidenceTaskSplitMembership(manifest, task);
  if (membership.state !== 'frozen') throw fail('Quarantined task is not runnable.');
  // Candidate projection excludes split membership, oracle/compilation hashes
  // and private leakage keys. Only the trusted runner sees this manifest.
  return projectCandidateEvidenceTask(task, options);
};
import { randomUUID } from 'node:crypto';
