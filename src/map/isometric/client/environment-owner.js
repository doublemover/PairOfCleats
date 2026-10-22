import { captureSceneResource, preserveSceneCleanupFailures } from './scene-retirement.js';

// The PMREM result, generator and input texture are independent acquired owners.
export const createEnvironmentOwner = ({ THREE, renderer, scene }) => {
  let retired = false, disposing = false, target = null;
  const resources = new Set(), captured = new WeakMap();
  const adopt = (resource, label) => {
    const reusable = resource && (typeof resource === 'object' || typeof resource === 'function');
    if (reusable && captured.has(resource)) return captured.get(resource);
    const owner = captureSceneResource(resource, label);
    if (reusable) captured.set(resource, owner);
    resources.add(owner); return owner;
  };
  const release = (owner, errors, retry = false) => {
    if (!owner) return;
    try { if (retry) owner.release(); else owner.retire(); }
    catch (error) { errors.push(error); }
    if (!owner.pending) resources.delete(owner);
  };
  return {
    get pendingOwners() { return Object.freeze([...resources].filter(owner => owner.pending)); },
    replace(texture) {
      if (!texture) return false;
      const input = adopt(texture, 'environment input texture'), errors = [];
      if (retired) {
        release(input, errors);
        const failure = preserveSceneCleanupFailures(null, errors); if (failure) throw failure;
        return false;
      }
      let generator = null, next = null, primary = null, published = false;
      try {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        const converter = new THREE.PMREMGenerator(renderer);
        generator = adopt(converter, 'environment PMREM generator');
        const output = converter.fromEquirectangular(texture);
        if (output) next = adopt(output, 'environment PMREM render target');
        if (!output?.texture) throw new Error('Environment conversion produced no texture.');
        const previous = target;
        scene.environment = output.texture;
        target = next; published = true;
        if (previous !== target) release(previous, errors);
      } catch (error) { primary = error; }
      // Independent transient cleanup cannot replace a conversion failure.
      if (next && !published) release(next, errors);
      release(generator, errors); release(input, errors);
      const failure = preserveSceneCleanupFailures(primary, errors); if (failure) throw failure;
      return true;
    },
    dispose() {
      const retry = disposing; disposing = true; retired = true;
      const errors = [];
      try { if (scene.environment === target?.resource?.texture) scene.environment = null; }
      catch (error) { errors.push(error); }
      target = null;
      for (const owner of [...resources]) release(owner, errors, retry);
      const failure = preserveSceneCleanupFailures(null, errors); if (failure) throw failure;
    }
  };
};
