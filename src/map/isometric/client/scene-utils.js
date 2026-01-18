export const disposeMaterial = (material) => {
  if (!material) return;
  if (Array.isArray(material)) {
    material.forEach((entry) => disposeMaterial(entry));
    return;
  }

  const disposeTexture = (texture) => {
    if (!texture) return;
    if (texture.userData?.shared) return;
    texture.dispose?.();
  };

  disposeTexture(material.map);
  disposeTexture(material.normalMap);
  disposeTexture(material.clearcoatNormalMap);
  disposeTexture(material.envMap);
  material.dispose?.();
};

export const disposeObject = (object) => {
  if (!object) return;
  if (object.geometry && !object.geometry.userData?.shared) object.geometry.dispose();
  if (object.material) disposeMaterial(object.material);
};

export const clearGroup = (group) => {
  if (!group) return;
  const disposedGeometries = new Set();
  const disposedMaterials = new Set();
  group.traverse((child) => {
    if (child === group) return;
    const geometry = child.geometry;
    if (geometry && !geometry.userData?.shared && !disposedGeometries.has(geometry)) {
      disposedGeometries.add(geometry);
      geometry.dispose?.();
    }
    const material = child.material;
    if (material) {
      const materials = Array.isArray(material) ? material : [material];
      for (const entry of materials) {
        if (entry && !disposedMaterials.has(entry)) {
          disposedMaterials.add(entry);
          disposeMaterial(entry);
        }
      }
    }
  });
  while (group.children.length) {
    group.remove(group.children[0]);
  }
};
