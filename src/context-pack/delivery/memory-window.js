import { captureDelivery, inspectEvidenceWindow, deliveryError } from './manifest.js';

/** Reference pack-window owner. It owns this actual bounded JSON window, not
 * a third-party model's prompt. A real host must implement the same atomic
 * read/compare-and-replace contract for its own context before enabling deltas.
 */
export const createMemoryEvidenceWindowAdapter = () => {
  const windows = new Map();
  const key = context => JSON.stringify([context.consumerId, context.sessionId]);
  return Object.freeze({ rendererId: 'evidence-window-json-v1', exactPackWindow: true,
    readWindow: async binding => windows.get(key(binding.contextRef)) ?? null,
    replaceWindow: async ({ expectedDigest, window }, binding) => {
      const next = inspectEvidenceWindow(window), context = captureDelivery('context', binding.contextRef), id = key(context);
      if (next.manifest.contextRef.consumerId !== context.consumerId || next.manifest.contextRef.sessionId !== context.sessionId) {
        throw deliveryError('ScopeDenied', 'Window replacement belongs to another host consumer.');
      }
      const current = windows.get(id);
      if ((current?.manifest.digest ?? null) !== expectedDigest) throw deliveryError('UnknownBase', 'Host window changed before atomic replacement.');
      if (!current && windows.size >= 16) throw deliveryError('MandatoryOverflow', 'Reference host consumer allowance exceeded.');
      windows.set(id, next); return true;
    },
    reset: binding => { windows.delete(key(binding.contextRef)); }
  });
};
