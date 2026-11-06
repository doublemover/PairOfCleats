import { createHash } from 'node:crypto';
import { semanticHash, canonicalSemanticJson } from '../../../index/semantic/identity.js';
import { captureSemanticRequest } from '../../../semantic/request-snapshot.js';
import { isUtf16Boundary } from '../../../shared/embedded-content.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { createAjv, compileSchema } from '../../../shared/validation/ajv-factory.js';
import { EVIDENCE_JUDGMENTS_SCHEMA } from '../../../contracts/schemas/evidence-judgments.js';
import { inspectEvidenceTaskCompilation, readEvidenceTaskInputs, readEvidenceTaskCompiledSource } from './compiler.js';
import { evidenceTaskSplitMembership } from './splits.js';

const owned = new WeakMap();
const validate = compileSchema(createAjv({ strict: true, allErrors: true }), EVIDENCE_JUDGMENTS_SCHEMA);
const fail = message => Object.assign(new Error(message), { code: 'ERR_EVIDENCE_TASK_JUDGMENTS' });
const key = value => canonicalSemanticJson(value, { maxBytes: 2 * 1024 * 1024 });
const hash = (kind, value) => semanticHash('evidence-task.judgments.' + kind + '.v1', value, { maxBytes: 2 * 1024 * 1024 });
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};
const scope = (task, manifest) => {
  const compilation = inspectEvidenceTaskCompilation(task), membership = evidenceTaskSplitMembership(manifest, task);
  if (membership.state !== 'frozen') throw fail('Source judgments require a frozen, non-quarantined task.');
  return { compilation, membership, taskInput: readEvidenceTaskInputs(task) };
};

/** Annotation admission owns no new split, corpus, oracle or semantic checker.
 * It binds explicit authored judgments to the exact original task and sources.
 * Review IDs are provenance metadata, never executable verification authority.
 */
export const compileEvidenceTaskJudgments = ({ task, manifest, input }, { signal = null } = {}) => {
  throwIfAborted(signal);
  const { compilation, membership, taskInput } = scope(task, manifest);
  input = captureSemanticRequest(input, EVIDENCE_JUDGMENTS_SCHEMA);
  if (!validate(input)) throw fail('Invalid source relevance judgment contract.');
  key(input);
  const rawQueryHash = createHash('sha256').update(taskInput.spec.problem, 'utf8').digest('hex');
  if (input.compilationId !== compilation.compilationId || input.privateOracleId !== compilation.privateOracleId
    || input.splitManifestId !== membership.manifestId || input.requirementId !== taskInput.spec.publicTaskKey
    || input.rawQueryHash !== rawQueryHash) throw fail('Judgment task, oracle, split, requirement or raw query identity changed.');
  const sources = new Map();
  const bind = ref => {
    const id = hash('document', { world: taskInput.spec.worldRef, source: ref, representation: 'exact-source-span-utf8-v1' });
    if (!sources.has(id)) {
      const file = readEvidenceTaskCompiledSource(task, ref.sourceUnitId);
      if (!file || ref.path !== file.path || ref.sourceHash !== file.ref.sourceHash || ref.span[0] >= ref.span[1]
        || !isUtf16Boundary(file.text, ref.span[0]) || !isUtf16Boundary(file.text, ref.span[1])) throw fail('Judgment source differs from its compiled original UTF-16 snapshot.');
      sources.set(id, immutable({ documentId: id, world: taskInput.spec.worldRef, source: ref,
        representation: 'exact-source-span-utf8-v1', text: file.text.slice(...ref.span) }));
    }
    return id;
  };
  const judgments = input.judgments.map(row => {
    throwIfAborted(signal);
    if (row.label === 'positive' && (row.grade === 0 || row.basis !== 'explicit-task-relevance-annotation')
      || row.label === 'positive' && row.weight !== 1
      || row.label === 'verified-negative' && (row.grade !== 0 || row.basis === 'unknown')
      || row.label === 'unknown' && (row.grade !== 0 || row.weight !== 0 || row.basis !== 'unknown')) throw fail('Label, grade, weight and named requirement basis disagree.');
    return { documentId: bind(row.source), label: row.label, grade: row.grade, weight: row.weight,
      basis: row.basis, receiptIds: [...row.receiptIds].sort(order) };
  }).sort((a, b) => order(key(a), key(b)));
  const aliases = input.positiveAliases.map(row => {
    throwIfAborted(signal); const left = bind(row.left), right = bind(row.right);
    if (sources.get(left).text !== sources.get(right).text) throw fail('The initial reviewed alias profile requires exact source-span text equality.');
    return { documentIds: [left, right].sort(order), reviewReceiptIds: [...row.reviewReceiptIds].sort(order) };
  }).sort((a, b) => order(key(a), key(b)));
  const participatingUnits = new Set(taskInput.privateOracle.alternatives.flatMap(alt => alt.groups.flatMap(group => group.unitIds)));
  const protectedSources = taskInput.privateOracle.units.filter(unit => participatingUnits.has(unit.id)).map(unit => unit.source);
  const protectedDocuments = [...sources.values()].filter(doc => protectedSources.some(ref => ref.sourceUnitId === doc.source.sourceUnitId
    && ref.span[0] < doc.source.span[1] && doc.source.span[0] < ref.span[1])).map(doc => doc.documentId).sort(order);
  const unique = rows => [...new Map(rows.map(row => [key(row), row])).values()];
  const content = immutable({ compilationId: compilation.compilationId, privateOracleId: compilation.privateOracleId,
    publicTaskId: compilation.publicTaskId, splitManifestId: membership.manifestId, groupId: membership.groupId,
    split: membership.split, requirementId: input.requirementId, rawQueryHash, normalizedQueryHash: rawQueryHash,
    normalization: 'identity-raw-query-v1', query: taskInput.spec.problem, world: taskInput.spec.worldRef,
    producerId: input.producerId, assumptionsId: input.assumptionsId, rightsScopeId: input.rightsScopeId,
    reviewReceiptIds: [...input.reviewReceiptIds].sort(order), labelCoverage: taskInput.privateOracle.labelCoverage,
    judgments: unique(judgments), aliases: unique(aliases), protectedDocuments, documents: [...sources.values()].sort((a, b) => order(a.documentId, b.documentId)) });
  const judgmentSetId = hash('set', content);
  const report = immutable({ schemaVersion: 1, kind: 'authored-source-relevance-judgments', judgmentSetId,
    compilationId: content.compilationId, publicTaskId: content.publicTaskId, splitManifestId: content.splitManifestId,
    split: content.split, groupId: content.groupId, annotations: content.judgments.length, sourceSpans: sources.size,
    authority: 'explicit-source-pinned-authored-annotations', review: 'receipt-identities-not-independently-revalidated' });
  const handle = Object.freeze({ version: 1 }); owned.set(handle, { task, manifest, report, content });
  throwIfAborted(signal); return handle;
};
const get = handle => {
  const state = handle && typeof handle === 'object' ? owned.get(handle) : null;
  if (!state) throw fail('Original compiled evidence judgments required.');
  scope(state.task, state.manifest); return state;
};
export const inspectEvidenceTaskJudgments = handle => get(handle).report;
/** Trusted training/evaluation API; never part of a candidate-facing task view. */
export const readEvidenceTaskJudgments = handle => get(handle).content;
