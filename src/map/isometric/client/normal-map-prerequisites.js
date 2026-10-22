import { captureSceneFailure } from './scene-failure-inspection.js';
import { captureScenePrerequisiteProducer } from './scene-retirement.js';

/** Original work is separate from the local texture/guard close proof. Walk
 * every privately produced constituent and diagnostic independently; only the
 * exact local producer's own scene closure may be delegated to that owner. */
export const createNormalMapPrerequisites = (primitive, guarded) => {
  const scopes = Object.freeze([primitive, guarded]), records = new Map();
  const observe = error => {
    const pending = [error], queued = new Set(pending), visited = new Set(), checks = [];
    let overflow = false, links = 0;
    const enqueue = values => {
      for (const value of values) {
        if (++links > 256) { overflow = true; break; }
        if (visited.has(value) || queued.has(value)) continue;
        if (visited.size + queued.size >= 128) { overflow = true; break; }
        queued.add(value); pending.push(value);
      }
    };
    while (pending.length) {
      const original = pending.pop();
      queued.delete(original);
      if (visited.has(original)) continue; visited.add(original);
      const producer = captureScenePrerequisiteProducer(original, scopes);
      const captured = captureSceneFailure(original);
      checks.push(() => captured.releasedOriginalExcept(producer?.observation));
      enqueue(captured.inspectionErrors);
      if (producer) enqueue(producer.errors);
      if (overflow) break;
    }
    return () => !overflow && checks.every(check => check());
  };
  return Object.freeze({
    get blocked() { return [...records.values()].some(record => !record.observe()); },
    assertReady() { for (const [error, record] of records) if (!record.observe()) throw error; },
    retain(error) {
      let record = records.get(error);
      if (!record) {
        record = { observe: () => true, receipt: null };
        record.receipt = Object.freeze(Object.defineProperties(new AggregateError([error], 'Normal-map original work remains pending.', { cause: error }), {
          sceneResourceOwners: { value: scopes },
          sceneOwnershipReleased: { value: () => record.observe() }
        }));
        records.set(error, record);
      }
      // Refresh only original absent channels; already captured functions and
      // their original receiver remain memoized by the shared snapshot owner.
      record.observe = observe(error);
      // Both actual capabilities receive this work prerequisite. An exposed
      // primitive close cannot bypass a later loader/configuration failure.
      primitive.retainFailure(record.receipt); guarded.retainFailure(record.receipt);
    }
  });
};
