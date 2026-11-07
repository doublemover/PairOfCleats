import { captureSceneFailure } from './scene-failure-inspection.js';
import { captureScenePrerequisiteProducer } from './scene-retirement.js';

/** Only exact privately produced local closure may be delegated. Independent
 * original/cache/diagnostic observations remain prerequisites for every cap. */
export const createSceneWorkPrerequisites = (label, initialOwners = []) => {
  const owners = new Set(initialOwners), records = new Map();
  const observe = (error, diagnostics) => {
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
      const original = pending.pop(); queued.delete(original);
      if (visited.has(original)) continue; visited.add(original);
      const producer = captureScenePrerequisiteProducer(original, [...owners]),
        captured = captureSceneFailure(original, { diagnostics });
      checks.push(() => captured.releasedOriginalExcept(producer?.observation));
      enqueue(captured.inspectionErrors); if (producer) enqueue(producer.errors);
      if (overflow) break;
    }
    return () => !overflow && checks.every(check => check());
  };
  const refresh = () => {
    for (const [error, record] of records) record.observe = observe(error, record.diagnostics);
    for (const owner of owners) for (const record of records.values()) owner.retainFailure(record.receipt);
  };
  return Object.freeze({
    attach(owner) { owners.add(owner); refresh(); return owner; },
    detach(owner) { owners.delete(owner); refresh(); },
    refresh,
    get blocked() { return [...records.values()].some(record => !record.observe()); },
    assertReady() { for (const [error, record] of records) if (!record.observe()) throw error; },
    retain(error, { diagnostics = true } = {}) {
      if (!records.has(error)) {
        const record = { observe: () => true, receipt: null, diagnostics };
        record.receipt = Object.freeze(Object.defineProperties(new AggregateError([error], label, { cause: error }), {
          sceneResourceOwners: { value: Object.freeze([...owners]) },
          sceneOwnershipReleased: { value: () => record.observe() }
        }));
        records.set(error, record);
      }
      if (diagnostics) records.get(error).diagnostics = true;
      refresh();
    }
  });
};
