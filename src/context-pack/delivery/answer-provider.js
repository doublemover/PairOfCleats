import { captureDelivery, deliveryDigest, deliveryJson, deliveryError } from './manifest.js';
import { captureRepositoryAnswerRequest, runRepositoryAnswer } from '../../integrations/tooling/repository-answer.js';
import { publishSemanticPage } from '../../semantic/page-publication.js';
import { throwIfAborted } from '../../shared/abort.js';
import { verifyRepositoryAnswerEvidence } from '../../integrations/tooling/repository-answer-evidence.js';

/** Actual pinned query/source admission. Raw checked claims or quoted source
 * bodies are never public selection input. Every host release re-executes this
 * provider against the same immutable world and current repository admission.
 */
export const createRepositoryAnswerDeliveryProvider = ({ runner = runRepositoryAnswer, verify = verifyRepositoryAnswerEvidence } = {}) => Object.freeze({
  captureSelection: input => {
    const selection = captureDelivery('answerSelection', input), request = captureRepositoryAnswerRequest(selection.answerRequest);
    if (request.mode !== 'compile' || request.retention) throw deliveryError('RepresentationMismatch', 'Delivery uses ephemeral live answer compilation, without retention or historical input.');
    if (selection.quoteRoles && selection.quoteRoles.length !== (request.quoteRefs?.length || 0)) {
      throw deliveryError('RepresentationMismatch', 'Exact-source role mappings must match the requested quotation refs.');
    }
    return selection;
  },
  admit: async (selection, { contextRef, signal = null } = {}) => {
    const request = selection.answerRequest;
    if (deliveryJson(contextRef.worldRef) !== deliveryJson(request.query.question.world) || deliveryJson(contextRef.taskRef) !== deliveryJson(request.questionRef)) {
      throw deliveryError('SourceStale', 'Live answer selection differs from the authenticated host question/world.');
    }
    const page = await runner(request, { signal, deferPublication: true }); throwIfAborted(signal);
    const answer = page.answer;
    const evidence = [{ observationIds: [answer.digest], representation: 'qualified-answer', source: null,
      roles: ['qualified-answer'], qualifiers: ['retained-query-facts-and-exact-source-quotations', 'program-semantics-not-established'],
      dependencyIds: [answer.inputs.queryReceipt.requestDigest, answer.world.sourceSnapshotId], text: deliveryJson(answer) }];
    for (const [index, quote] of answer.inputs.quotations.entries()) evidence.push({
      observationIds: [deliveryDigest('admitted-source-quotation', quote)], representation: 'exact-source', source: quote.source,
      roles: selection.quoteRoles?.[index] || ['quoted-source'], qualifiers: ['verified-retained-source-bytes', 'role-is-selected-not-a-proof-of-semantic-sufficiency'],
      dependencyIds: [quote.source.sourceHash, answer.world.sourceSnapshotId], text: quote.text
    });
    return { worldRef: answer.world, evidence,
      continuation: page.continuation ? { producerId: answer.inputs.queryReceipt.profile, requestDigest: answer.inputs.queryReceipt.requestDigest, cursor: page.continuation } : null,
      publish: () => { publishSemanticPage(page); } };
  },
  revalidate: async (selection, { contextRef, window, signal = null } = {}) => {
    const descriptors = window.manifest.entries.filter(entry => entry.representation === 'qualified-answer');
    if (descriptors.length !== 1) throw deliveryError('IncompleteManifest', 'Live answer delivery requires its exact qualified report.');
    const body = window.bodies.find(body => body.id === descriptors[0].id);
    const report = JSON.parse(body.text);
    if (descriptors[0].observationIds.length !== 1 || descriptors[0].observationIds[0] !== report.digest
      || deliveryJson(report.world) !== deliveryJson(contextRef.worldRef)) throw deliveryError('SourceStale', 'Delivered answer identity differs from its bound context.');
    await verify(selection.answerRequest, report, { signal });
  }
});
