const retiredObjects = new WeakSet();
const disposalContext = () => ({ geometries: new Set(), materials: new Set(), textures: new Set() });

export const disposeMaterial = (material, context = disposalContext()) => {
  if (!material || material.userData?.shared) return;
  if (Array.isArray(material)) {
    material.forEach((entry) => disposeMaterial(entry, context));
    return;
  }
  if (context.materials.has(material)) return;
  context.materials.add(material);

  const disposeTexture = (texture) => {
    if (!texture) return;
    if (texture.userData?.shared) return;
    if (context.textures.has(texture)) return;
    context.textures.add(texture);
    texture.dispose?.();
  };

  disposeTexture(material.map);
  disposeTexture(material.normalMap);
  disposeTexture(material.clearcoatNormalMap);
  disposeTexture(material.envMap);
  material.dispose?.();
};

export const disposeObject = (object, context = disposalContext()) => {
  if (!object || retiredObjects.has(object)) return;
  retiredObjects.add(object);
  // InstancedMesh owns renderer bindings and instance buffers independently of
  // the shared geometry/material lifecycle.
  if (object.isInstancedMesh) object.dispose?.();
  const geometry = object.geometry;
  if (geometry && !geometry.userData?.shared && !context.geometries.has(geometry)) {
    context.geometries.add(geometry);
    geometry.dispose?.();
  }
  if (object.material) disposeMaterial(object.material, context);
};

export const clearGroup = (group) => {
  if (!group) return;
  const context = disposalContext();
  group.traverse((child) => {
    if (child === group) return;
    disposeObject(child, context);
  });
  while (group.children.length) {
    group.remove(group.children[0]);
  }
};
