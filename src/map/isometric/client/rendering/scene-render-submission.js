const owners = new WeakMap();
const failure = message => new Error(`Scene render observation: ${message}`);

/** Internal single-frame observation at the real captured render operation.
 * No RAF, GPU resource or render replacement is acquired by an observer. */
export const createSceneRenderSubmissionOwner = ({ state, renderer, render, isCurrent }) => {
  if (!state || !renderer || typeof render !== 'function' || typeof isCurrent !== 'function') {
    throw new TypeError('Scene render observation requires the original render owner.');
  }
  if (owners.has(renderer)) throw failure('renderer already has an active submission owner.');
  let retired = false, pending = null, sequence = 0;
  const notify = (observer, name, value) => {
    const result = Reflect.apply(observer[name], undefined, [value]);
    if (result !== undefined) throw failure('frame observers must return synchronously without work.');
  };
  const reject = error => {
    const observer = pending; pending = null;
    if (observer) notify(observer, 'onError', error);
  };
  const owner = Object.freeze({
    observe(observer) {
      if (retired || !isCurrent()) throw failure('original scene owner is unavailable.');
      if (pending) throw failure('a frame observation is already pending.');
      pending = observer;
      return () => { if (pending === observer) pending = null; };
    },
    submit(scene, camera) {
      if (retired || !isCurrent()) return;
      const observer = pending;
      const before = observer ? { model: state.map, layout: state.layoutMetrics, revision: state.geometryRevision,
        scene, camera, fileGroup: state.fileGroup, memberGroup: state.memberGroup, edgeGroup: state.edgeGroup,
        frame: renderer.info?.render?.frame } : null;
      let result;
      try { result = render(scene, camera); }
      catch (primary) {
        try { reject(primary); } catch (secondary) { throw new AggregateError([primary, secondary], 'Render and observation failed.', { cause: primary }); }
        throw primary;
      }
      if (!observer || pending !== observer) return result;
      if (retired || !isCurrent() || state.preparingScene || state.contextLost || state.scene !== scene || state.camera !== camera
        || state.map !== before.model || state.layoutMetrics !== before.layout || state.geometryRevision !== before.revision
        || state.fileGroup !== before.fileGroup || state.memberGroup !== before.memberGroup || state.edgeGroup !== before.edgeGroup) {
        reject(failure('committed scene generation changed during submission.')); return result;
      }
      pending = null;
      const info = renderer.info?.render;
      notify(observer, 'onFrame', Object.freeze({ sequence: ++sequence, scene: scene.uuid || null,
        geometryRevision: before.revision ?? null, frameBefore: before.frame ?? null, frame: info?.frame ?? null,
        calls: info?.calls ?? null, triangles: info?.triangles ?? null,
        groups: Object.freeze([before.fileGroup, before.memberGroup, before.edgeGroup].map(group => group?.uuid || null)) }));
      return result;
    },
    dispose() {
      if (retired) return;
      retired = true;
      if (owners.get(renderer) === owner) owners.delete(renderer);
      reject(failure('original scene retired before the requested frame completed.'));
    }
  });
  owners.set(renderer, owner);
  return owner;
};

/** One bounded observer; the caller must cancel it on timeout or failure. */
export const observeNextSceneRender = (renderer, { onFrame, onError } = {}) => {
  if (typeof onFrame !== 'function' || typeof onError !== 'function') throw new TypeError('Scene render observer callbacks are required.');
  const owner = owners.get(renderer);
  if (!owner) throw failure('no original controls submission owner is active.');
  return owner.observe(Object.freeze({ onFrame, onError }));
};
