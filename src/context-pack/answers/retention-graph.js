import { createHash } from 'node:crypto';
import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { ANSWER_RETENTION_VERSION } from '../../contracts/schemas/answer-retention.js';
import { assertAnswerRetention } from '../../contracts/validators/answer-retention.js';
import { ANSWER_MAX_BYTES, inspectAnswerRevision } from './render.js';

export const retainedAnswerBytes = value => canonicalSemanticJson(value, { maxBytes: 2 * ANSWER_MAX_BYTES }) + '\n';
export const retainedAnswerHash = bytes => createHash('sha256').update(bytes).digest('hex');
const envelope = (kind, value) => ({ schemaVersion: ANSWER_RETENTION_VERSION, kind: 'retained-answer-' + kind, value });

/** Factorized immutable objects, not paths for every derivation. Shared support
 * bundles and inputs are written once by encoded content identity. Rehydration
 * remains historical content inspection, never current source admission. */
export const buildRetainedAnswerGraph = (input, options = {}) => {
  const answer = inspectAnswerRevision(input, options), objects = new Map();
  const add = (kind, value) => {
    assertAnswerRetention(kind, value);
    const bytes = retainedAnswerBytes(value), hash = retainedAnswerHash(bytes);
    objects.set(hash, bytes); return hash;
  };
  const { inputs, claims, fragments, ...fields } = answer;
  const manifest = { schemaVersion: ANSWER_RETENTION_VERSION, kind: 'retained-answer-manifest', answerDigest: answer.digest, fields,
    inputs: add('input', envelope('input', inputs)),
    claims: claims.map(({ support, ...value }) => add('claim', { ...envelope('claim', value), support: add('support', envelope('support', support)) })),
    fragments: add('fragments', envelope('fragments', fragments)) };
  const manifestHash = add('manifest', manifest);
  return { answer, objects, manifestHash };
};

export const readRetainedAnswerGraph = async (head, read, options = {}) => {
  const manifest = assertAnswerRetention('manifest', await read(head.manifestHash));
  if (manifest.answerDigest !== head.answerDigest) throw Object.assign(new Error('Retained answer manifest identity differs from its head.'), { code: 'ERR_ANSWER_RETENTION_INTEGRITY' });
  const inputs = assertAnswerRetention('input', await read(manifest.inputs)).value;
  const claims = [];
  for (const ref of manifest.claims) {
    const claim = assertAnswerRetention('claim', await read(ref));
    const support = assertAnswerRetention('support', await read(claim.support));
    claims.push({ ...claim.value, support: support.value });
  }
  const fragments = assertAnswerRetention('fragments', await read(manifest.fragments)).value;
  const answer = inspectAnswerRevision({ ...manifest.fields, inputs, claims, fragments }, options);
  if (answer.digest !== head.answerDigest || retainedAnswerBytes(answer.questionRef) !== retainedAnswerBytes(head.questionRef) || answer.worldId !== head.worldId) {
    throw Object.assign(new Error('Retained answer content differs from its pinned head.'), { code: 'ERR_ANSWER_RETENTION_INTEGRITY' });
  }
  return answer;
};
