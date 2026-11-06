import { CONTEXT_DELIVERY_VERSION } from '../../contracts/schemas/context-delivery.js';
import { throwIfAborted } from '../../shared/abort.js';
import { observeStorageResource, createStorageObservationLedger } from '../../shared/storage/failure-observation.js';
import { captureDelivery, deliveryJson, deliveryBytes, deliveryError, buildEvidenceWindow, inspectEvidenceWindow } from './manifest.js';
import { planEvidenceDelivery } from './plan.js';
import { applyEvidenceDelivery } from './apply.js';
import { createEvidenceWindowWitnessOwner } from './window-witness.js';
import { confirmDeliveryPermission } from './permission.js';

const equal = (a, b) => deliveryJson(a) === deliveryJson(b);
const key = context => JSON.stringify([context.consumerId, context.sessionId]);
const authority = ({ windowRevision: _revision, ...context }) => context;
const requiredMethods = (value, names) => names.every(name => typeof value?.[name] === 'function');

/** Trusted host integration, never a remote ACK/identity declaration. Boundary
 * authentication and provider admission are out-of-band installed functions.
 * Every plan/redelivery/apply rechecks the consumer and actual source selection.
 * Responses sent do not advance visibility; only verified host replacement does.
 */
export const createEvidenceDeliveryHost = ({ boundary, adapter, provider } = {}) => {
  if (!requiredMethods(boundary, ['bind']) || !requiredMethods(provider, ['captureSelection', 'admit'])
    || !requiredMethods(adapter, ['readWindow', 'replaceWindow']) || adapter.rendererId !== 'evidence-window-json-v1' || adapter.exactPackWindow !== true) {
    throw deliveryError('UnsupportedAdapter', 'Evidence deltas require a trusted exact pack-window adapter, authenticated boundary and admitted provider.');
  }
  const states = new Map(); let retainedBytes = 0;
  const bind = async (transport, signal) => {
    throwIfAborted(signal);
    const bound = await boundary.bind(transport, 'evidence-delivery');
    const observation = observeStorageResource(bound, { phase: 'evidence-host-binding' }); observation.requireSettled();
    if (!requiredMethods(bound, ['recheck', 'authorizeSelection', 'authorizeEvidence'])) throw deliveryError('ScopeDenied', 'Host boundary supplied no current selection/evidence admission owner.');
    const contextRef = captureDelivery('context', bound.contextRef);
    await confirmDeliveryPermission(bound.recheck(), 'Host consumer or scope is no longer admitted.'); observation.requireSettled();
    throwIfAborted(signal); return { bound, contextRef };
  };
  const recheck = async (binding, transport, signal) => {
    await confirmDeliveryPermission(binding.bound.recheck(), 'Host consumer or scope changed during evidence work.');
    const current = await bind(transport, signal);
    if (!equal(authority(current.contextRef), authority(binding.contextRef))) throw deliveryError('ScopeDenied', 'Host epoch, task, scope, policy or world changed during evidence work.');
    return current;
  };
  const stateFor = context => {
    const id = key(context); let state = states.get(id);
    if (!state) {
      if (states.size >= 16) throw deliveryError('MandatoryOverflow', 'Evidence host consumer allowance exceeded.');
      state = { owner: createEvidenceWindowWitnessOwner({ consumerId: context.consumerId, sessionId: context.sessionId }),
        pending: null, busy: false, observations: createStorageObservationLedger() }; states.set(id, state);
    }
    return state;
  };
  const run = async (transport, signal, action) => {
    const binding = await bind(transport, signal), state = stateFor(binding.contextRef);
    state.observations.requireSettled();
    if (state.busy) throw deliveryError('UnknownBase', 'This consumer already has admitted window work in progress.');
    state.busy = true;
    try { return await action(binding, state); }
    catch (error) {
      const observation = observeStorageResource(error, { phase: 'evidence-host-operation' });
      if (observation.hasResourceObservation) state.observations.remember(error);
      throw error;
    } finally { state.busy = false; }
  };
  const read = async (binding, signal) => {
    const actual = await adapter.readWindow(binding.bound, { signal });
    throwIfAborted(signal); return actual === null ? null : inspectEvidenceWindow(actual, { signal });
  };
  const produce = async (selection, request, binding, signal) => {
    await confirmDeliveryPermission(binding.bound.authorizeSelection(selection, { contextRef: request.contextRef, phase: 'admit' }), 'Selected evidence request is outside this consumer authority.');
    const admitted = await provider.admit(selection, { contextRef: request.contextRef, binding: binding.bound, signal });
    throwIfAborted(signal);
    const world = admitted?.worldRef;
    if (!equal(world, request.contextRef.worldRef)) throw deliveryError('SourceStale', 'Admitted provider output belongs to another pinned source world.');
    if (!Array.isArray(admitted.evidence) || admitted.evidence.length > 128) throw deliveryError('MandatoryOverflow', 'Admitted delivery evidence exceeds its entry allowance.');
    return admitted;
  };
  const revalidate = async (pending, binding, signal) => {
    await confirmDeliveryPermission(binding.bound.authorizeSelection(pending.selection, { contextRef: pending.request.contextRef, phase: 'reuse' }), 'Selected evidence can no longer be expanded by this consumer.');
    await confirmDeliveryPermission(binding.bound.authorizeEvidence(pending.window, { phase: 'reuse' }), 'Selected source/representation is no longer permitted for this consumer.');
    if (typeof provider.revalidate === 'function') {
      const result = await provider.revalidate(pending.selection, { contextRef: pending.request.contextRef,
        binding: binding.bound, window: pending.window, signal });
      observeStorageResource(result, { phase: 'evidence-provider-revalidation' }).requireSettled();
      if (result !== undefined) throw deliveryError('TargetDigestMismatch', 'Provider revalidation must confirm its standard void result.');
      return;
    }
    const admitted = await produce(pending.selection, pending.request, binding, signal);
    // Delivery-only cursor identities are intentionally not replaced. Revalidate
    // the same selected evidence/world using the original opaque continuation.
    const rebuilt = buildEvidenceWindow(pending.request, admitted.evidence, { signal });
    if (rebuilt.manifest.digest !== pending.plan.target.digest) throw deliveryError('SourceStale', 'Selected evidence changed since this packet was planned.');
  };
  const receipt = plan => captureDelivery('receipt', { schemaVersion: CONTEXT_DELIVERY_VERSION, kind: 'evidence-window-receipt',
    packetId: plan.packetId, baseDigest: plan.baseDigest, targetDigest: plan.target.digest, contextRef: plan.target.contextRef,
    rendererId: 'evidence-window-json-v1', availability: 'host-owned-pack-window', interpretation: 'exact-reconstruction-not-comprehension-or-truth',
    renderedPackBytes: plan.cost.reconstructedPackBytes, fullPromptBytes: null, fullPromptTokens: null });
  return Object.freeze({
    describe: async (transport, { signal = null } = {}) => run(transport, signal, async binding => {
      const actual = await read(binding, signal); await recheck(binding, transport, signal);
      return { contextRef: binding.contextRef, actualWindowDigest: actual?.manifest.digest ?? null,
        availability: 'host-owned-pack-window', fullPromptTokens: null };
    }),
    plan: async (input, selectionInput, transport, { signal = null } = {}) => {
      const request = captureDelivery('request', input), selection = provider.captureSelection(selectionInput);
      // The installed provider owns selection capture and its closed schema.
      // Bound its retained encoding before source work or pending publication.
      const selectionBytes = deliveryBytes(selection);
      if (selectionBytes > 128 * 1024) throw deliveryError('MandatoryOverflow', 'Evidence host selection exceeds its retained-byte allowance.');
      return run(transport, signal, async (binding, state) => {
        if (!equal(request.contextRef, { ...binding.contextRef, windowRevision: binding.contextRef.windowRevision + 1 })) {
          throw deliveryError('EpochMismatch', 'Delivery request does not match the authenticated host context and next revision.');
        }
        const actual = await read(binding, signal), admitted = await produce(selection, request, binding, signal);
        const effective = captureDelivery('request', { ...request, continuation: admitted.continuation });
        // Selection/source admission precedes reuse of any old visible entry.
        const witness = actual && actual.manifest.contextRef.consumerId === binding.contextRef.consumerId
          && actual.manifest.contextRef.sessionId === binding.contextRef.sessionId ? state.owner.issue(actual) : null;
        const plan = planEvidenceDelivery(effective, admitted.evidence, witness, { signal });
        const window = applyEvidenceDelivery(actual, plan, { signal });
        const pendingBytes = deliveryBytes(plan) + selectionBytes + deliveryBytes(window);
        if (retainedBytes - (state.pending?.bytes || 0) + pendingBytes > 4 * 1024 * 1024) throw deliveryError('MandatoryOverflow', 'Evidence host pending packet allowance exceeded.');
        const current = await recheck(binding, transport, signal);
        const latest = await read(current, signal);
        if ((latest?.manifest.digest ?? null) !== (actual?.manifest.digest ?? null)) throw deliveryError('UnknownBase', 'Host window changed while planning evidence.');
        await confirmDeliveryPermission(current.bound.authorizeEvidence(window, { phase: 'release' }), 'Actual evidence sources are outside this consumer authority.');
        throwIfAborted(signal);
        const published = await admitted.publish?.();
        observeStorageResource(published, { phase: 'evidence-provider-publication' }).requireSettled();
        if (published !== undefined) throw deliveryError('TargetDigestMismatch', 'Evidence provider publication must confirm its standard void result.');
        retainedBytes += pendingBytes - (state.pending?.bytes || 0);
        state.pending = { selection, request: effective, plan, window, bytes: pendingBytes, sourceBaseDigest: actual?.manifest.digest ?? null };
        return plan;
      });
    },
    redeliver: async (packetId, transport, { signal = null } = {}) => run(transport, signal, async (binding, state) => {
      const pending = state.pending;
      if (!pending || pending.plan.packetId !== packetId) throw deliveryError('UnknownBase', 'Evidence packet is not the current bound delivery.');
      if (!equal(authority(pending.plan.target.contextRef), authority(binding.contextRef))) throw deliveryError('EpochMismatch', 'Packet belongs to a retired host context.');
      const actual = await read(binding, signal);
      if ((actual?.manifest.digest ?? null) !== pending.sourceBaseDigest && actual?.manifest.digest !== pending.plan.target.digest) {
        throw deliveryError('UnknownBase', 'Host window changed before redelivery.');
      }
      await revalidate(pending, binding, signal);
      const current = await recheck(binding, transport, signal);
      await confirmDeliveryPermission(current.bound.authorizeEvidence(pending.window, { phase: 'release' }), 'Evidence permission changed before redelivery.');
      return pending.plan;
    }),
    apply: async (packetId, transport, { signal = null } = {}) => run(transport, signal, async (binding, state) => {
      const pending = state.pending;
      if (!pending || pending.plan.packetId !== packetId) throw deliveryError('UnknownBase', 'Unknown or superseded evidence packet cannot acknowledge a window.');
      const plan = pending.plan;
      if (!equal(authority(plan.target.contextRef), authority(binding.contextRef))) throw deliveryError('EpochMismatch', 'Packet belongs to another epoch, task, world or scope.');
      const actual = await read(binding, signal);
      if ((actual?.manifest.digest ?? null) !== pending.sourceBaseDigest && actual?.manifest.digest !== plan.target.digest) {
        throw deliveryError('UnknownBase', 'Host window changed after packet planning.');
      }
      if (actual?.manifest.digest !== plan.target.digest && binding.contextRef.windowRevision + 1 !== plan.target.contextRef.windowRevision) {
        throw deliveryError('UnknownBase', 'Host window revision differs from the packet base.');
      }
      await revalidate(pending, binding, signal);
      const staged = applyEvidenceDelivery(actual, plan, { signal });
      await recheck(binding, transport, signal); throwIfAborted(signal);
      if (actual?.manifest.digest !== staged.manifest.digest) {
        if (await adapter.replaceWindow({ expectedDigest: actual?.manifest.digest ?? null, window: staged, packetId }, binding.bound, { signal }) !== true) {
          throw deliveryError('TargetDigestMismatch', 'Host did not confirm exact atomic window replacement.');
        }
      }
      const current = await recheck(binding, transport, signal), committed = await read(current, signal);
      if (!committed || committed.manifest.digest !== staged.manifest.digest || !equal(committed, staged)
        || current.contextRef.windowRevision !== plan.target.contextRef.windowRevision) throw deliveryError('TargetDigestMismatch', 'Host readback/revision differs from the reconstructed target.');
      await confirmDeliveryPermission(current.bound.authorizeEvidence(committed, { phase: 'ack' }), 'Evidence permission changed before acknowledgement.');
      // Only this point is an ACK. No provider response or transport send can
      // advance the acknowledged witness, and no native work is retained here.
      state.owner.issue(committed); return receipt(plan);
    })
  });
};
