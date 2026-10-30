import { VIEW_LIMITS } from './projection.js';
import { captureSceneResource, preserveSceneCleanupFailures } from '../isometric/client/scene-retirement.js';
import { createSceneWorkPrerequisites } from '../isometric/client/scene-work-prerequisites.js';
import { captureSceneFailure } from '../isometric/client/scene-failure-inspection.js';
export const RELADRAW_VERSION = '0.21.0';
/** Labels are data, never Reladraw statements, markup or line-break syntax. */
export const quoteLabel = text => '"' + String(text).slice(0, 240).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  .replace(/\[/g, '\\[').replace(/\//g, '\\/').replace(/[\r\n\t\u0000-\u001f]/g, ' ')+ '"';
export function authorProjection(projection) {
  if (projection.nodes.length > VIEW_LIMITS.nodes || projection.edges.length > VIEW_LIMITS.edges) throw new RangeError('Reladraw admission exceeded.');
  const bindings = {}, names = new Map(), source = [];
  const admitted = new Set(projection.nodes.map(node => node.id));
  const containers = new Set(projection.nodes.filter(node => admitted.has(node.parentId)).map(node => node.parentId));
  // Topological containment, including paged-out parents and cyclic/broken source scopes.
  const remaining = new Map(projection.nodes.map(node => [node.id, node]));
  let index = 0;
  const roots = [];
  const rootPlacement = name => {
    const at = roots.length; let placement = '';
    if (at > 0 && at % 4 === 0) placement = ` below ${roots.slice(at - 4, at).join(' and ')} left even with ${roots[at - 4]}`;
    else if (at > 0) placement = ` right of ${roots[at - 1]} top even with ${roots[at - at % 4]}`;
    roots.push(name); return placement;
  };
  while (remaining.size) {
    let progress = false;
    for (const [id, node] of remaining) {
      if (node.parentId && admitted.has(node.parentId) && !names.has(node.parentId)) continue;
      const parent = names.get(node.parentId);
      const name = parent ? `${parent}.n${index++}` : `n${index++}`;
      names.set(id, name); bindings[name] = { id, ref: node.ref, label: node.label };
      source.push(`node ${name} ${quoteLabel(node.label)}${parent ? '' : rootPlacement(name) + ' shape: rectangle'}${containers.has(id) ? ' layout: column' : ''}`);
      remaining.delete(id); progress = true;
    }
    if (!progress) {
      // A cyclic scope is not evidence of containment; keep nodes at the root.
      const [id, node] = remaining.entries().next().value;
      const name = `n${index++}`;
      names.set(id, name); bindings[name] = { id, ref: node.ref, label: node.label };
      source.push(`node ${name} ${quoteLabel(node.label)}${rootPlacement(name)}${containers.has(id) ? ' layout: column' : ''}`); remaining.delete(id);
    }
  }
  // Edges retain source orientation; layout constraints never reverse the graph.
  for (const edge of projection.edges) source.push(`edge ${names.get(edge.from)} -> ${names.get(edge.to)} ${quoteLabel(edge.kind)}`);
  return { source: source.join('\n'), bindings, version: RELADRAW_VERSION, projectionVersion: projection.version, generation: projection.generation };
}

/** One original worker and deadline. An unconfirmed termination permanently
 * retires this controller; explicit owner reconciliation never admits new work. */
export function createCompileController({ WorkerClass = globalThis.Worker, timeoutMs = 1000 } = {}) {
  let active = null, retiring = null, serial = 0, retiredFailure = null;
  const owners = new Set();
  const settle = record => {
    if (!record.outcome || record.work || record.settled) return;
    record.settled = true; retiring = record;
    if (active === record) active = null;
    clearTimeout(record.timer);
    const errors = [...record.workErrors], { hasPrimary, primary, value } = record.outcome;
    try {
      if (hasPrimary) record.prerequisites.retain(primary);
      for (const error of record.workErrors) record.prerequisites.retain(error);
      if (record.owner) record.owner.retire();
    } catch (error) { errors.push(error); }
    const failure = preserveSceneCleanupFailures(primary, errors, { hasPrimary });
    if (record.owner?.pending || (!record.owner && hasPrimary && !captureSceneFailure(primary).released())) {
      retiredFailure = preserveSceneCleanupFailures(new Error('Reladraw controller retired after unconfirmed original worker cleanup.'),
        [failure], { hasPrimary: true, forceAggregate: true });
    }
    if (record.owner && !record.owner.pending) owners.delete(record.owner);
    retiring = null;
    // A failed native close cannot prevent settlement of the original request.
    if (hasPrimary || errors.length) record.reject(failure);
    else record.resolve(value);
  };
  const finish = (record, hasPrimary, primary, value) => {
    if (record.settled) return;
    if (record.outcome) { if (hasPrimary && record.work) record.workErrors.push(primary); return; }
    record.outcome = { hasPrimary, primary, value }; settle(record);
  };
  const cancel = () => {
    const record = active;
    if (record) finish(record, true, Object.assign(new Error('Compilation replaced.'), { name: 'AbortError' }));
    return Object.freeze({ retired: retiredFailure !== null, pendingOwners: Object.freeze([...owners].filter(owner => owner.pending)) });
  };
  return {
    cancel,
    get retired() { return retiredFailure !== null; },
    get pendingOwners() { return Object.freeze([...owners].filter(owner => owner.pending)); },
    compile(source) {
      cancel();
      if (retiredFailure !== null) return Promise.reject(retiredFailure);
      // Reentrant construction/termination cannot allocate a sibling worker.
      if (active || retiring) return Promise.reject(new Error('Original Reladraw worker acquisition or retirement has not returned.'));
      if (typeof source !== 'string') return Promise.reject(new TypeError('Reladraw source must be a string.'));
      if (new TextEncoder().encode(source).length > VIEW_LIMITS.sourceBytes) return Promise.reject(new RangeError('Reladraw source exceeds 256 KiB.'));
      const record = { id: ++serial, work: 1, workErrors: [], settled: false, outcome: null, owner: null, timer: null,
        prerequisites: createSceneWorkPrerequisites('Original Reladraw worker work remains pending.') };
      const result = new Promise((resolve, reject) => { record.resolve = resolve; record.reject = reject; });
      active = record;
      const work = Object.freeze(Object.defineProperty(new Error('Original Reladraw worker acquisition has not returned.'),
        'sceneOwnershipReleased', { value: () => record.work === 0 }));
      record.prerequisites.retain(work);
      const current = () => active === record && !record.outcome && !record.settled;
      try {
        const worker = new WorkerClass(new URL('./reladraw-worker.js', import.meta.url), { type: 'module' });
        const resource = { worker, get dispose() {
          const terminate = worker.terminate;
          if (typeof terminate !== 'function') throw new TypeError('Reladraw worker has no original terminate method.');
          return () => {
            record.work++;
            try { return Reflect.apply(terminate, worker, []); }
            finally { record.work--; }
          };
        } };
        record.owner = record.prerequisites.attach(captureSceneResource(resource, 'original Reladraw worker', 'dispose', [], { required: true }));
        owners.add(record.owner); record.owner.assertCaptured();
        const invoke = callback => {
          if (!current()) return;
          record.work++;
          try { callback(); }
          catch (primary) { finish(record, true, primary); }
          finally { record.work--; settle(record); }
        };
        if (current()) worker.onmessage = event => invoke(() => {
          const data = event.data;
          if (Object.hasOwn(data, 'error')) {
            const original = data.error;
            finish(record, true, typeof original === 'string' ? new Error(original) : original);
          } else finish(record, false, undefined, data);
        });
        if (current()) worker.onerror = event => invoke(() => {
          const message = event.message;
          finish(record, true, new Error(typeof message === 'string' ? message : 'Reladraw worker failed.'));
        });
        if (current()) {
          const post = worker.postMessage;
          if (current()) {
            if (typeof post !== 'function') throw new TypeError('Reladraw worker has no original postMessage method.');
            record.timer = setTimeout(() => finish(record, true,
              new Error('Reladraw exceeded its 1-second deadline; last valid view retained.')), timeoutMs);
            Reflect.apply(post, worker, [{ source, id: record.id }]);
          }
        }
      } catch (primary) { finish(record, true, primary); }
      finally { record.work--; settle(record); }
      return result;
    }
  };
}
