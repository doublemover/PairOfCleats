import { deliveryDigest, deliveryJson } from './manifest.js';

/** Internal projection of a live admitted answer. Logical roles remain caller
 * selections, not new semantic support or a replacement for original qualifiers. */
export const projectAnswerDeliveryEvidence = (answer, quoteRoles = []) => {
  const evidence = [{ observationIds: [answer.digest], representation: 'qualified-answer', source: null,
    roles: ['qualified-answer'], qualifiers: ['retained-query-facts-and-exact-source-quotations', 'program-semantics-not-established'],
    dependencyIds: [answer.inputs.queryReceipt.requestDigest, answer.world.sourceSnapshotId], text: deliveryJson(answer) }];
  for (const [index, quote] of answer.inputs.quotations.entries()) evidence.push({
    observationIds: [deliveryDigest('admitted-source-quotation', quote)], representation: 'exact-source', source: quote.source,
    roles: quoteRoles[index] || ['quoted-source'], qualifiers: ['verified-retained-source-bytes', 'role-is-selected-not-a-proof-of-semantic-sufficiency'],
    dependencyIds: [quote.source.sourceHash, answer.world.sourceSnapshotId], text: quote.text
  });
  return evidence;
};
export const answerDeliveryContinuation = (answer, cursor) => cursor ? {
  producerId: answer.inputs.queryReceipt.profile, requestDigest: answer.inputs.queryReceipt.requestDigest, cursor
} : null;
