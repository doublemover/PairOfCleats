import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { ANSWER_PATCH_SCHEMA, ANSWER_EVIDENCE_VERSION } from '../../contracts/schemas/answer-evidence.js';
import { assertAnswerEvidence } from '../../contracts/validators/answer-evidence.js';
import { ANSWER_MAX_BYTES, inspectAnswerRevision } from './render.js';

const mismatch = message => Object.assign(new Error(message), { code: 'ERR_ANSWER_BASE_MISMATCH' });
/** Conservative correctness baseline: recompute every supported rule from each
 * admitted input snapshot. A changed inventory invalidates all old-world claims,
 * including count, failed-lookup and domain dependencies. No text/name matching
 * or unqualified cross-world correspondence preserves an old conclusion.
 */
export const reconcileAnswerRevisions = (before, after, options = {}) => {
  before = inspectAnswerRevision(before, options); after = inspectAnswerRevision(after, options);
  if (before.questionRef.id !== after.questionRef.id || before.world.repositoryNamespace !== after.world.repositoryNamespace) {
    throw mismatch('Answer comparison requires the same question identity and authorized repository namespace.');
  }
  const old = new Set(before.claims.map(claim => claim.id)), current = new Set(after.claims.map(claim => claim.id));
  const patch = { schemaVersion: ANSWER_EVIDENCE_VERSION, kind: 'repository-answer-patch', baseDigest: before.digest, nextDigest: after.digest,
    strategy: 'full-deterministic-recomputation', addedClaimIds: [...current].filter(id => !old.has(id)).sort(),
    removedClaimIds: [...old].filter(id => !current.has(id)).sort(), retainedClaimIds: [...current].filter(id => old.has(id)).sort(),
    sourceWorldChanged: before.worldId !== after.worldId, textChanged: before.text !== after.text, next: after };
  canonicalSemanticJson(patch, { maxBytes: 2 * ANSWER_MAX_BYTES });
  return assertAnswerEvidence('patch', patch);
};
export const applyAnswerPatch = (base, input, options = {}) => {
  const patch = captureSemanticRequest(input, ANSWER_PATCH_SCHEMA); assertAnswerEvidence('patch', patch);
  canonicalSemanticJson(patch, { maxBytes: 2 * ANSWER_MAX_BYTES });
  base = inspectAnswerRevision(base, options);
  if (base.digest !== patch.baseDigest) throw mismatch('Answer patch base differs; request the self-contained current answer.');
  const expected = reconcileAnswerRevisions(base, patch.next, options);
  if (canonicalSemanticJson(expected, { maxBytes: 2 * ANSWER_MAX_BYTES }) !== canonicalSemanticJson(patch, { maxBytes: 2 * ANSWER_MAX_BYTES })) {
    throw mismatch('Answer patch delta, revision or source-world metadata disagrees with fresh deterministic recomputation.');
  }
  return expected.next;
};
