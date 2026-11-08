import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { canonicalSemanticJson, semanticHash, createSourceUnitId } from '../../../index/semantic/identity.js';
import { captureSemanticRequest } from '../../../semantic/request-snapshot.js';
import { captureSourcePath } from '../../../semantic/source-order.js';
import { isUtf16Boundary } from '../../../shared/embedded-content.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { EVIDENCE_TASK_SCHEMAS, EVIDENCE_TASK_VERSION } from '../../../contracts/schemas/evidence-task.js';
import { assertEvidenceTask } from '../../../contracts/validators/evidence-task.js';
import { isSemanticJsonBudgetError } from '../../../index/semantic/canonical-json-bounds.js';

const tasks = new WeakMap(), retired = new WeakMap(), MAX_BYTES = 4 * 1024 * 1024;
const key = value => canonicalSemanticJson(value, { maxBytes: MAX_BYTES });
const hash = (kind, value) => semanticHash('evidence-task.' + kind + '.v' + EVIDENCE_TASK_VERSION, value, { maxBytes: MAX_BYTES });
const fail = (suffix, message) => Object.assign(new Error(message), { code: 'ERR_EVIDENCE_TASK_' + suffix });
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};
const excludedParts = new Set(['.git', '.hg', '.svn', '.jj', '.tmp', '.cache', 'node_modules', '.oracle', 'hidden-oracle']);

/** The canonical source-identity owner hashes actual supplied immutable text.
 * It is not a reader/admission capability for a current repository snapshot.
 */
export const evidenceTaskSourceReference = ({ repositoryNamespace, path, language, text, span }) => {
  captureSourcePath(path);
  if (typeof text !== 'string' || !text.isWellFormed() || Buffer.byteLength(text) > 131072 || typeof language !== 'string' || !language.length) throw fail('SOURCE', 'Bounded well-formed UTF-8 source text and language required.');
  if (!Array.isArray(span) || span.length !== 2 || !isUtf16Boundary(text, span[0]) || !isUtf16Boundary(text, span[1]) || span[1] < span[0]) throw fail('SOURCE', 'Exact original UTF-16 boundaries required.');
  const sourceHash = createHash('sha256').update(text, 'utf8').digest('hex');
  return immutable({ sourceUnitId: createSourceUnitId({ repositoryNamespace, path, byteHash: sourceHash, decoding: 'utf8-fatal-preserve-bom-v1',
    language, dialect: null, mapping: null }), sourceHash, path, span: [...span], coordinateUnit: 'utf16' });
};
const get = handle => {
  const state = handle && typeof handle === 'object' ? tasks.get(handle) : null;
  if (!state) throw fail('HANDLE', 'Original compiled finite evidence task required.'); return state;
};

/** Compile only the declared in-memory source snapshot and a separate private
 * oracle. Candidate-facing identity excludes oracle content to avoid dictionary
 * attacks against small hidden answer sets through a public rubric digest.
 */
export const compileEvidenceTask = (input, { signal = null } = {}) => {
  const began = performance.now(); throwIfAborted(signal);
  input = captureSemanticRequest(input, EVIDENCE_TASK_SCHEMAS.compilation); assertEvidenceTask('compilation', input);
  try { key(input); }
  catch (cause) {
    if (!isSemanticJsonBudgetError(cause)) throw cause;
    throw Object.assign(new Error('Finite task compiler canonical-input allowance exceeded.', { cause }), { code: 'ERR_EVIDENCE_TASK_INPUT_LIMIT' });
  }
  const reasons = [], files = new Map(), bySource = new Map(), units = new Map(), groupDefinitions = new Map(); let sourceBytes = 0;
  const quarantine = (reason, path = null) => { reasons.push({ reason, path }); };
  if (input.spec.taskAvailableAt > input.spec.cutoffAt) quarantine('task-unavailable-at-cutoff');
  if (input.spec.historyRegime !== 'declared-base-only') quarantine('history-permitted-profile-requires-a-qualified-adapter');
  for (const source of input.sourceSnapshot) {
    throwIfAborted(signal);
    captureSourcePath(source.path);
    if (files.has(source.path)) throw fail('CONTRACT', 'Duplicate source path.');
    if (source.path.split('/').some(part => excludedParts.has(part.toLowerCase()))) quarantine('metadata-cache-or-hidden-input-in-visible-manifest', source.path);
    if (source.availableAt > input.spec.cutoffAt) quarantine('source-unavailable-at-cutoff', source.path);
    const ref = evidenceTaskSourceReference({ repositoryNamespace: input.spec.worldRef.repositoryNamespace, ...source, span: [0, source.text.length] });
    const bytes = Buffer.byteLength(source.text); sourceBytes += bytes;
    if (sourceBytes > MAX_BYTES) throw fail('INPUT_LIMIT', 'Aggregate visible source allowance exceeded.');
    const file = immutable({ ...source, ref, byteLength: bytes }); files.set(source.path, file); bySource.set(ref.sourceUnitId, file);
  }
  const oracle = input.privateOracle;
  if (oracle.validation.status === 'externally-reviewed' && !oracle.validation.receiptIds.length) quarantine('external-review-receipt-unavailable');
  for (const unit of oracle.units) {
    throwIfAborted(signal);
    const source = bySource.get(unit.source.sourceUnitId);
    if (units.has(unit.id)) throw fail('CONTRACT', 'Duplicate private evidence unit identity.');
    if (!source || unit.source.sourceHash !== source.ref.sourceHash || unit.source.path !== source.path
      || unit.source.span[0] >= unit.source.span[1] || !isUtf16Boundary(source.text, unit.source.span[0])
      || !isUtf16Boundary(source.text, unit.source.span[1])) quarantine('private-oracle-source-unit-does-not-match-snapshot', unit.source.path);
    units.set(unit.id, unit);
  }
  const alternatives = new Set();
  for (const alternative of oracle.alternatives) {
    if (alternatives.has(alternative.id)) throw fail('CONTRACT', 'Duplicate private alternative identity.'); alternatives.add(alternative.id);
    const seen = new Set();
    for (const group of alternative.groups) {
      if (seen.has(group.id) || group.require > group.unitIds.length || group.unitIds.some(id => !units.has(id))) throw fail('CONTRACT', 'Private q-of evidence group is incomplete or references unknown units.');
      if (groupDefinitions.has(group.id) && key(groupDefinitions.get(group.id)) !== key(group)) throw fail('CONTRACT', 'Private group identity changed across alternatives.');
      seen.add(group.id); groupDefinitions.set(group.id, group);
    }
  }
  if (oracle.noLocalAnswer === 'verified-in-supplied-model' && (oracle.labelCoverage !== 'complete-in-declared-universe' || oracle.units.length || oracle.alternatives.length)) quarantine('verified-empty-oracle-conflicts-with-labels-or-coverage');
  const visible = [...files.values()].sort((a, b) => order(a.path, b.path)).map(file => ({ path: file.path, language: file.language,
    sourceUnitId: file.ref.sourceUnitId, sourceHash: file.ref.sourceHash, byteLength: file.byteLength, utf16Length: file.text.length,
    availableAt: file.availableAt, role: file.role }));
  const visibleManifestId = hash('visible-manifest', visible), publicTaskId = hash('public-task', { spec: input.spec, visibleManifestId });
  const privateOracleId = hash('private-oracle', oracle), lineageId = hash('lineage', input.lineage);
  const compilationId = hash('compilation', { publicTaskId, privateOracleId, lineageId });
  const report = immutable({ schemaVersion: EVIDENCE_TASK_VERSION, kind: 'finite-evidence-task-compilation', compilationId,
    publicTaskId, visibleManifestId, privateOracleId, lineageId, state: reasons.length ? 'quarantined' : 'awaiting-lineage-and-split-audit', reasons,
    funnel: { discovered: true, sourceValidated: !reasons.some(row => /source|visible-manifest|cutoff/.test(row.reason)),
      oracleStructureValidated: !reasons.some(row => /oracle|review/.test(row.reason)), lineageDeclared: true, lineageAudited: false,
      splitAssigned: false, frozen: false, runnable: false },
    qualification: { sourceAuthority: 'supplied-in-memory-snapshot-only', oracleAuthority: 'supplied-authored-or-reviewed-metadata',
      nearDuplicateAudit: 'not-performed', filesystemIsolation: 'not-performed', trainingContamination: 'not-established' },
    work: { executionId: hash('compile-execution', randomUUID()), sourceBytes, sourceFiles: files.size,
      oracleUnits: units.size, elapsedMs: performance.now() - began } });
  // Internal capability exposes no private digest/labels through reflection.
  // Only the explicit trusted inspection API returns the compilation receipt.
  const handle = Object.freeze({ version: EVIDENCE_TASK_VERSION });
  tasks.set(handle, { input, files, bySource, units, visible: immutable(visible), report }); throwIfAborted(signal); return handle;
};
export const inspectEvidenceTaskCompilation = handle => get(handle).report;

/** Trusted split/scoring seam. It returns frozen JSON only, never the mutable
 * source maps or caller-owned containers behind an original compiled handle.
 */
export const readEvidenceTaskInputs = handle => get(handle).input;
export const readEvidenceTaskVisibleManifest = handle => get(handle).visible;
export const readEvidenceTaskCompiledSource = (handle, sourceUnitId) => get(handle).bySource.get(sourceUnitId) ?? null;
export const disposeEvidenceTask = handle => {
  if (handle && typeof handle === 'object' && retired.has(handle)) return retired.get(handle);
  const state = get(handle);
  const receipt = immutable({ schemaVersion: EVIDENCE_TASK_VERSION, kind: 'finite-evidence-task-retirement',
    compilationId: state.report.compilationId, executionId: hash('retirement', randomUUID()), status: 'retired', nativeResources: 'none',
    memory: 'owner-source-and-oracle-references-released; returned-immutable-views-remain-caller-owned' });
  tasks.delete(handle); retired.set(handle, receipt); return receipt;
};

export const projectCandidateEvidenceTask = (handle, { offset = 0, limit = 16, maxBytes = 65536 } = {}) => {
  const state = get(handle);
  if (state.report.state === 'quarantined') throw fail('QUARANTINED', 'Quarantined tasks cannot expose a candidate packet.');
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 32
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 131072) throw new TypeError('Invalid candidate task projection allowance.');
  const end = Math.min(offset + limit, state.visible.length);
  const result = { schemaVersion: EVIDENCE_TASK_VERSION, kind: 'visible-evidence-task', publicTaskId: state.report.publicTaskId,
    visibleManifestId: state.report.visibleManifestId, spec: state.input.spec, sources: state.visible.slice(offset, end),
    sourceCount: state.visible.length, nextOffset: end < state.visible.length ? end : null,
    oracleVisibility: 'private-not-in-candidate-packet', executionProfile: 'read-only-finite-source-evidence' };
  if (Buffer.byteLength(JSON.stringify(result)) + 1 > maxBytes) throw fail('OUTPUT_LIMIT', 'Candidate task packet exceeds its output allowance; request fewer sources.');
  return immutable(result);
};
export const readCandidateEvidenceSource = (handle, reference, { maxBytes = 65536 } = {}) => {
  const state = get(handle);
  if (state.report.state === 'quarantined') throw fail('QUARANTINED', 'Quarantined tasks cannot expose source.');
  if (!state.input.spec.allowedActions.includes('inspect-visible-source')) throw fail('ACTION_UNAVAILABLE', 'Source inspection is outside this task profile.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 131072) throw new TypeError('Invalid candidate source allowance.');
  const captured = captureSemanticRequest({ schemaVersion: 1, publicTaskId: state.report.publicTaskId, candidateId: '0'.repeat(64),
    runId: '0'.repeat(64), status: 'completed', evidence: [reference], abstain: false }, EVIDENCE_TASK_SCHEMAS.submission);
  assertEvidenceTask('submission', captured); const source = captured.evidence[0], file = state.bySource.get(source.sourceUnitId);
  if (!file || source.sourceHash !== file.ref.sourceHash || source.path !== file.path || source.span[1] < source.span[0]
    || !isUtf16Boundary(file.text, source.span[0]) || !isUtf16Boundary(file.text, source.span[1])) throw fail('SOURCE', 'Candidate read differs from its original visible source.');
  const result = { publicTaskId: state.report.publicTaskId, source, text: file.text.slice(...source.span), sourceAuthority: 'compiled-visible-snapshot' };
  if (Buffer.byteLength(JSON.stringify(result)) + 1 > maxBytes) throw fail('OUTPUT_LIMIT', 'Candidate excerpt exceeds its byte allowance.'); return immutable(result);
};
export const readCandidateEvidencePrefix = (handle, sourceUnitId, { maxCodeUnits = 4096, maxBytes = 65536 } = {}) => {
  const state = get(handle), file = state.bySource.get(sourceUnitId);
  if (!file) throw fail('SOURCE', 'Visible source identity is absent.');
  if (!Number.isSafeInteger(maxCodeUnits) || maxCodeUnits < 1 || maxCodeUnits > 4096) throw new TypeError('Invalid candidate prefix allowance.');
  let end = Math.min(file.text.length, maxCodeUnits);
  if (!isUtf16Boundary(file.text, end)) end--;
  return readCandidateEvidenceSource(handle, { ...file.ref, span: [0, end] }, { maxBytes });
};
