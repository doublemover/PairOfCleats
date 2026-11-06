import { CONTEXT_DELIVERY_VERSION } from '../../contracts/schemas/context-delivery.js';
import { throwIfAborted } from '../../shared/abort.js';
import { captureDelivery, deliveryDigest, deliveryBytes, deliveryJson, deliveryError, inspectEvidenceWindow, describeDeliveryEntry } from './manifest.js';
import { deliveryBaseDecision, deliveryOperations } from './plan.js';

/** Reference reconstruction only. Success establishes exact bytes/manifest,
 * not visibility. Only the authenticated host may attest its committed window. */
export const applyEvidenceDelivery = (inputBase, inputPlan, { signal = null } = {}) => {
  const plan = captureDelivery('plan', inputPlan); throwIfAborted(signal);
  const { packetId, ...unsigned } = plan;
  if (packetId !== deliveryDigest('packet', unsigned) || plan.cost.transmittedBytes !== deliveryBytes(plan)) throw deliveryError('TargetDigestMismatch', 'Delivery packet identity or wire cost differs.');
  if (plan.cost.transmittedBytes > plan.limits.packetBytes || plan.cost.reconstructedPackBytes > plan.limits.reconstructedBytes) {
    throw deliveryError('MandatoryOverflow', 'Delivery exceeds its complete wire or reconstructed-window allowance.');
  }
  const { digest: targetDigest, ...unsignedTarget } = plan.target;
  if (targetDigest !== deliveryDigest('manifest', unsignedTarget) || plan.cost.reconstructedPackBytes !== plan.target.cost.renderedPackBytes
    || (plan.mode === 'full' && plan.baseDigest !== null)
    || (plan.mode === 'delta' && (plan.baseDigest === null || plan.fallbackReason !== null))) throw deliveryError('TargetDigestMismatch', 'Delivery target or mode identity differs.');
  const descriptors = new Map(plan.target.entries.map(entry => [entry.id, entry]));
  const retainedIds = new Set(plan.operations.retain), addedIds = new Set(plan.operations.add);
  if (descriptors.size !== plan.target.entries.length || [...retainedIds].some(id => addedIds.has(id) || !descriptors.has(id))
    || [...addedIds].some(id => !descriptors.has(id)) || retainedIds.size + addedIds.size !== descriptors.size
    || plan.bodies.length !== addedIds.size || new Set(plan.bodies.map(body => body.id)).size !== plan.bodies.length
    || plan.operations.removeFromWindow.some(id => descriptors.has(id))) throw deliveryError('IncompleteManifest', 'Delivery operations do not partition the complete target.');
  for (const body of plan.bodies) {
    const descriptor = descriptors.get(body.id);
    if (!descriptor || !addedIds.has(body.id)) throw deliveryError('IncompleteManifest', 'Delivery contains an unrequested body.');
    const { id: _id, contentHash: _hash, bodyBytes: _bytes, ...metadata } = descriptor;
    if (deliveryJson(describeDeliveryEntry({ ...metadata, text: body.text }).descriptor) !== deliveryJson(descriptor)) {
      throw deliveryError('TargetDigestMismatch', 'Delivery body differs from its source/representation descriptor.');
    }
  }
  if (plan.mode === 'full' && deliveryJson(plan.operations) !== deliveryJson(deliveryOperations(plan.target))) throw deliveryError('IncompleteManifest', 'Full delivery must include every target representation.');
  if (plan.mode === 'delta' && deliveryJson(plan.operations.invalidateCurrentUse) !== deliveryJson(plan.operations.removeFromWindow)) {
    throw deliveryError('IncompleteManifest', 'Evicted representations must invalidate their current-window reuse.');
  }
  const base = inputBase === null ? null : inspectEvidenceWindow(inputBase, { signal });
  if (base?.manifest.digest === plan.target.digest) return base;
  if (plan.mode === 'delta') {
    const reason = deliveryBaseDecision({ expectedBaseDigest: plan.baseDigest, contextRef: plan.target.contextRef }, base);
    if (!plan.baseDigest || reason) throw deliveryError(reason || 'UnknownBase', 'Evidence delta requires its exact current consumer/window base.');
  } else if (plan.baseDigest !== null) throw deliveryError('UnknownBase', 'A full pack cannot name a suppressed base.');
  const actualBase = plan.mode === 'delta' ? base : null, expected = deliveryOperations(plan.target, actualBase);
  if (deliveryJson(expected) !== deliveryJson(plan.operations)) throw deliveryError('IncompleteManifest', 'Evidence packet operations disagree with its exact target membership.');
  const retained = new Map(actualBase?.bodies.map(body => [body.id, body]) || []), additions = new Map();
  for (const body of plan.bodies) {
    if (additions.has(body.id) || !expected.add.includes(body.id)) throw deliveryError('IncompleteManifest', 'Unexpected or duplicated delivery body.');
    additions.set(body.id, body);
  }
  if (additions.size !== expected.add.length) throw deliveryError('IncompleteManifest', 'A required delivery body is missing.');
  const bodies = plan.target.entries.map(entry => {
    throwIfAborted(signal);
    const body = additions.get(entry.id) || retained.get(entry.id);
    if (!body) throw deliveryError('IncompleteManifest', 'A supposedly retained representation is unavailable.');
    return body;
  });
  const rebuilt = inspectEvidenceWindow({ schemaVersion: CONTEXT_DELIVERY_VERSION, kind: 'evidence-window', manifest: plan.target, bodies }, { signal });
  if (rebuilt.manifest.cost.renderedPackBytes !== plan.cost.reconstructedPackBytes || deliveryBytes(rebuilt) > plan.limits.reconstructedBytes) {
    throw deliveryError('TargetDigestMismatch', 'Reconstructed pack does not match its exact admitted cost.');
  }
  throwIfAborted(signal); return rebuilt;
};
