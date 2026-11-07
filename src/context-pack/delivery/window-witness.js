import { captureDelivery, inspectEvidenceWindow, deliveryError } from './manifest.js';

const witnesses = new WeakMap();
/** Internal host integration only. Wire manifests/ACK flags cannot construct a
 * witness. The host issues it only after owning and checking the actual window.
 * This issuer itself performs no source, permission or transport admission. */
export const createEvidenceWindowWitnessOwner = input => {
  const binding = captureDelivery('binding', input);
  let current = null, token = null;
  const state = { read: expected => token === expected ? current : null };
  return Object.freeze({
    issue: inputWindow => {
      const window = inspectEvidenceWindow(inputWindow), context = window.manifest.contextRef;
      if (context.consumerId !== binding.consumerId || context.sessionId !== binding.sessionId) throw deliveryError('ScopeDenied', 'Window belongs to another bound host consumer.');
      current = window; token = Object.freeze({});
      const witness = Object.freeze({ digest: window.manifest.digest }); witnesses.set(witness, { state, token }); return witness;
    },
    reset: () => { current = null; token = null; }
  });
};
export const readEvidenceWindowWitness = witness => {
  const record = witness !== null && typeof witness === 'object' ? witnesses.get(witness) : null;
  return record?.state.read(record.token) ?? null;
};
