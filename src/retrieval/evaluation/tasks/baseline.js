import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { semanticHash } from '../../../index/semantic/identity.js';
import { captureSemanticRequest } from '../../../semantic/request-snapshot.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { contextEvidenceTerms, contextEvidenceJaccard } from '../../../context-pack/evidence-similarity.js';
import { EVIDENCE_TASK_SCHEMAS } from '../../../contracts/schemas/evidence-task.js';
import { assertEvidenceTask } from '../../../contracts/validators/evidence-task.js';
import { projectEvidenceTaskView, readEvidenceTaskViewPrefix } from './candidate-view.js';

const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = message => Object.assign(new Error(message), { code: 'ERR_EVIDENCE_TASK_BASELINE' });
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};

/** Invocation labels record actual runs; they do not change candidate policy. */
export const evidenceBaselineCandidateId = (publicTaskId, request) => semanticHash('evidence-task.baseline-candidate.v1', {
  publicTaskId, request: { ...request, runId: null }
});

/** Registered cheap baseline. Its imports/capabilities expose visible source
 * only; hidden oracle labels cannot influence file scoring or membership.
 * Lexical features reuse the existing 4096-code-unit/128-term owner.
 */
export const runVisibleEvidenceBaseline = ({ view, request }, { signal = null } = {}) => {
  const began = performance.now(); throwIfAborted(signal);
  request = captureSemanticRequest(request, EVIDENCE_TASK_SCHEMAS.baseline); assertEvidenceTask('baseline', request);
  const first = projectEvidenceTaskView(view, { limit: 1, maxBytes: 131072 }), spec = first.spec;
  if (request.maxSelectedFiles > spec.limits.maxEvidenceSpans || request.maxSelectedSourceBytes > spec.limits.maxSelectedSourceBytes) throw fail('Candidate policy exceeds the task evidence allowance.');
  const lexical = request.method === 'lexical-visible-prefix-v1';
  if (lexical && (!spec.allowedActions.includes('inspect-visible-source') || !spec.allowedActions.includes('search-visible-source'))) throw fail('Lexical source inspection/search is not admitted by this task.');
  let featureWork = 0, sourceBytesRead = 0, inspectedFiles = 0;
  const charge = () => { featureWork++; }, terms = lexical ? contextEvidenceTerms(spec.problem, charge) : null;
  const candidates = [], frontier = [];
  let offset = 0, enumeratedFiles = 0;
  while (offset < first.sourceCount) {
    throwIfAborted(signal);
    if (performance.now() - began >= request.maxWorkMs) { frontier.push({ nextSourceOffset: offset, sourceCount: first.sourceCount - offset, reason: 'work-deadline' }); break; }
    const page = offset === 0 ? first : projectEvidenceTaskView(view, { offset, limit: 1, maxBytes: 131072 });
    const source = page.sources[0]; enumeratedFiles++;
    let score = 0;
    if (lexical) {
      // Reserve a conservative UTF-8 bound before asking for source, then charge
      // exact returned bytes. No inspected prefix becomes a whole-source read.
      const maxCodeUnits = Math.min(4096, Math.floor((request.maxReadBytes - sourceBytesRead) / 4));
      if (maxCodeUnits < 1) { frontier.push({ nextSourceOffset: offset, sourceCount: first.sourceCount - offset, reason: 'source-read-budget' }); break; }
      const excerpt = readEvidenceTaskViewPrefix(view, source.sourceUnitId, { maxCodeUnits, maxBytes: 65536 });
      sourceBytesRead += Buffer.byteLength(excerpt.text); inspectedFiles++;
      const features = contextEvidenceTerms(source.path + '\n' + excerpt.text, charge);
      score = contextEvidenceJaccard(terms, features, charge);
    }
    candidates.push({ source, score }); offset++;
  }
  candidates.sort((a, b) => b.score - a.score || order(a.source.path, b.source.path) || order(a.source.sourceUnitId, b.source.sourceUnitId));
  const evidence = [], excluded = []; let selectedBytes = 0;
  for (const candidate of candidates) {
    const source = candidate.source;
    if (evidence.length === request.maxSelectedFiles || selectedBytes + source.byteLength > request.maxSelectedSourceBytes) {
      excluded.push({ sourceUnitId: source.sourceUnitId, reason: 'selected-evidence-budget' }); continue;
    }
    evidence.push({ sourceUnitId: source.sourceUnitId, sourceHash: source.sourceHash, path: source.path,
      span: [0, source.utf16Length], coordinateUnit: 'utf16' }); selectedBytes += source.byteLength;
  }
  const submission = assertEvidenceTask('submission', { schemaVersion: 1, publicTaskId: view.publicTaskId,
    candidateId: evidenceBaselineCandidateId(view.publicTaskId, request),
    runId: request.runId, status: 'completed', evidence, abstain: false });
  const result = { schemaVersion: 1, kind: 'visible-evidence-baseline', method: request.method, submission,
    featureProfile: lexical ? 'existing-bounded-4096-utf16-prefix-128-term-jaccard' : 'visible-source-code-unit-order',
    frontier, excluded, selection: 'bounded-heuristic-not-certified-ranked-prefix',
    observedReadOrUse: lexical ? 'inspected-prefixes-only; no-model-cognition-claim' : 'visible-metadata-only',
    work: { executionId: randomUUID(), enumeratedFiles, inspectedFiles, sourceBytesRead, selectedSourceBytes: selectedBytes,
      featureWork, elapsedMs: performance.now() - began, sourceTransport: 'compiled-in-memory-snapshot; not-filesystem-io', modelTokens: null } };
  if (Buffer.byteLength(JSON.stringify(result)) + 1 > 131072) throw fail('Candidate baseline artifact exceeds its response allowance.');
  throwIfAborted(signal); return immutable(result);
};
