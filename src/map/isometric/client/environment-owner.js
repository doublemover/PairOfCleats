// The PMREM result is caller-owned. Disposing its generator does not retire it.
export const createEnvironmentOwner = ({ THREE, renderer, scene }) => {
  let retired = false;
  let target = null;
  return {
    replace(texture) {
      if (!texture) return false;
      if (retired) {
        texture.dispose?.();
        return false;
      }
      let generator;
      let next;
      try {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        generator = new THREE.PMREMGenerator(renderer);
        next = generator.fromEquirectangular(texture);
        if (!next?.texture) throw new Error('Environment conversion produced no texture.');
        const previous = target;
        target = next;
        scene.environment = next.texture;
        previous?.dispose();
        return true;
      } catch (error) {
        if (next && next !== target) next.dispose?.();
        throw error;
      } finally {
        generator?.dispose();
        texture.dispose?.();
      }
    },
    dispose() {
      if (retired) return;
      retired = true;
      if (scene.environment === target?.texture) scene.environment = null;
      target?.dispose();
      target = null;
    }
  };
};
