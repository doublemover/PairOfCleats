import { VIEW_LIMITS } from './projection.js';
export const RELADRAW_VERSION = '0.16.0';
/** Labels are data, never Reladraw statements, markup or line-break syntax. */
export const quoteLabel = text => '"' + String(text).slice(0, 240).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  .replace(/\[/g, '\\[').replace(/\//g, '\\/').replace(/[\r\n\t\u0000-\u001f]/g, ' ')+ '"';
export function authorProjection(projection) {
  if (projection.nodes.length > VIEW_LIMITS.nodes || projection.edges.length > VIEW_LIMITS.edges) throw new RangeError('Reladraw admission exceeded.');
  const bindings = {}, names = new Map(), source = [];
  const admitted = new Set(projection.nodes.map(node => node.id));
  // Topological containment, including paged-out parents and cyclic/broken source scopes.
  const remaining = new Map(projection.nodes.map(node => [node.id, node]));
  let index = 0;
  const roots = [];
  const rootPlacement = name => {
    const at = roots.length; let placement = '';
    if (at > 0 && at % 4 === 0) placement = ` below ${roots.slice(at - 4, at).join(' and ')} left level with ${roots[at - 4]}`;
    else if (at > 0) placement = ` right of ${roots[at - 1]} top level with ${roots[at - at % 4]}`;
    roots.push(name); return placement;
  };
  while (remaining.size) {
    let progress = false;
    for (const [id, node] of remaining) {
      if (node.parentId && admitted.has(node.parentId) && !names.has(node.parentId)) continue;
      const parent = names.get(node.parentId);
      const name = parent ? `${parent}.n${index++}` : `n${index++}`;
      names.set(id, name); bindings[name] = { id, ref: node.ref, label: node.label };
      source.push(`node ${name} ${quoteLabel(node.label)}${parent ? '' : rootPlacement(name) + ' shape: rectangle'}`);
      remaining.delete(id); progress = true;
    }
    if (!progress) {
      // A cyclic scope is not evidence of containment; keep nodes at the root.
      const [id, node] = remaining.entries().next().value;
      const name = `n${index++}`;
      names.set(id, name); bindings[name] = { id, ref: node.ref, label: node.label };
      source.push(`node ${name} ${quoteLabel(node.label)}${rootPlacement(name)}`); remaining.delete(id);
    }
  }
  // Edges retain source orientation; layout constraints never reverse the graph.
  for (const edge of projection.edges) source.push(`edge ${names.get(edge.from)} -> ${names.get(edge.to)} ${quoteLabel(edge.kind)}`);
  return { source: source.join('\n'), bindings, version: RELADRAW_VERSION, projectionVersion: projection.version, generation: projection.generation };
}

/** One worker and one deadline; cancellation always terminates synchronous compilation. */
export function createCompileController({ WorkerClass = globalThis.Worker, timeoutMs = 1000 } = {}) {
  let active = null, serial = 0;
  const cancel = () => {
    if (!active) return;
    const old = active; active = null; clearTimeout(old.timer); old.worker.terminate();
    old.reject(Object.assign(new Error('Compilation replaced.'), { name: 'AbortError' }));
  };
  return {
    cancel,
    compile(source) {
      cancel();
      if (new TextEncoder().encode(source).length > VIEW_LIMITS.sourceBytes) return Promise.reject(new RangeError('Reladraw source exceeds 256 KiB.'));
      const id = ++serial;
      return new Promise((resolve, reject) => {
        const worker = new WorkerClass(new URL('./reladraw-worker.js', import.meta.url), { type: 'module' });
        const finish = (error, value) => {
          if (active?.id !== id) return;
          clearTimeout(active.timer); worker.terminate(); active = null;
          if (error) reject(error); else resolve(value);
        };
        const timer = setTimeout(() => finish(new Error('Reladraw exceeded its 1-second deadline; last valid view retained.')), timeoutMs);
        active = { id, worker, timer, reject };
        worker.onmessage = ({ data }) => data.error ? finish(new Error(data.error)) : finish(null, data);
        worker.onerror = event => finish(new Error(event.message || 'Reladraw worker failed.'));
        worker.postMessage({ source, id });
      });
    }
  };
}
