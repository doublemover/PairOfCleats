import { CONTEXT_DELIVERY_VERSION } from '../../contracts/schemas/context-delivery.js';
import { throwIfAborted } from '../../shared/abort.js';
import { buildEvidenceWindow, captureDelivery, deliveryBytes, deliveryDigest, deliveryError, deliveryJson } from './manifest.js';
import { readEvidenceWindowWitness } from './window-witness.js';

const equal = (a, b) => deliveryJson(a) === deliveryJson(b);
export const deliveryBaseDecision = (request, base) => {
  if (!request.expectedBaseDigest) return null;
  if (!base || base.manifest.digest !== request.expectedBaseDigest) return 'UnknownBase';
  const prior = base.manifest.contextRef, next = request.contextRef;
  if (prior.consumerId !== next.consumerId || prior.sessionId !== next.sessionId
    || prior.scopeDigest !== next.scopeDigest || prior.policyDigest !== next.policyDigest) return 'ScopeDenied';
  if (prior.contextEpoch !== next.contextEpoch) return 'EpochMismatch';
  if (!equal(prior.worldRef, next.worldRef)) return 'SourceStale';
  if (!equal(prior.taskRef, next.taskRef) || prior.branchId !== next.branchId || prior.windowRevision + 1 !== next.windowRevision) return 'UnknownBase';
  return null;
};
export const deliveryOperations = (target, base = null) => {
  const old = new Set(base?.manifest.entries.map(entry => entry.id) || []), next = new Set(target.entries.map(entry => entry.id));
  const removed = (base?.manifest.entries || []).filter(entry => !next.has(entry.id)).map(entry => entry.id);
  return { retain: target.entries.filter(entry => old.has(entry.id)).map(entry => entry.id),
    add: target.entries.filter(entry => !old.has(entry.id)).map(entry => entry.id),
    removeFromWindow: removed, invalidateCurrentUse: base ? [...removed] : 'all-previous-window' };
};

/** Pure full/delta plan over already-selected, already-admitted evidence. A
 * serialized manifest or caller's remembered/visible flag is never a base. */
export const planEvidenceDelivery = (input, admittedEvidence, verifiedWindow = null, { signal = null } = {}) => {
  const request = captureDelivery('request', input); throwIfAborted(signal);
  const target = buildEvidenceWindow(request, admittedEvidence, { signal }), witnessed = readEvidenceWindowWitness(verifiedWindow);
  const fallbackReason = request.expectedBaseDigest && verifiedWindow && !witnessed ? 'UnsupportedAdapter' : deliveryBaseDecision(request, witnessed);
  const base = request.expectedBaseDigest && !fallbackReason ? witnessed : null;
  const operations = deliveryOperations(target.manifest, base), required = new Set(operations.add);
  const plan = { schemaVersion: CONTEXT_DELIVERY_VERSION, kind: 'evidence-delivery-plan', mode: base ? 'delta' : 'full', fallbackReason,
    packetId: '0'.repeat(64), baseDigest: base?.manifest.digest ?? null, target: target.manifest,
    bodies: target.bodies.filter(body => required.has(body.id)), limits: request.limits, operations,
    cost: { transmittedBytes: 0, reconstructedPackBytes: target.manifest.cost.renderedPackBytes, fullPromptBytes: null, fullPromptTokens: null } };
  for (let index = 0; index < 8; index++) {
    const bytes = deliveryBytes(plan); if (bytes === plan.cost.transmittedBytes) break; plan.cost.transmittedBytes = bytes;
  }
  const { packetId: _packetId, ...unsigned } = plan; plan.packetId = deliveryDigest('packet', unsigned);
  if (plan.cost.transmittedBytes !== deliveryBytes(plan)) throw deliveryError('TargetDigestMismatch', 'Delivery packet byte accounting differs.');
  if (plan.cost.transmittedBytes > request.limits.packetBytes) throw deliveryError('MandatoryOverflow', 'Required delivery packet exceeds the complete wire allowance.');
  throwIfAborted(signal); return captureDelivery('plan', plan);
};
