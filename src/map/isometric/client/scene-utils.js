import { captureSceneResource, getPendingSceneResourceOwners, preserveSceneCleanupFailures } from './scene-retirement.js';

export { getPendingSceneResourceOwners };
const objectOwners = new WeakMap(), materialOwners = new WeakMap();
const disposalContext = () => ({ geometries: new Set(), materials: new Set(), textures: new Set() });
const retireParts = parts => {
  const errors = [];
  for (const owner of parts) { try { owner.retire(); } catch (error) { errors.push(error); } }
  const failure = preserveSceneCleanupFailures(null, errors); if (failure) throw failure;
};
const captureMaterial = (material, context) => {
  if (!material || material.userData?.shared) return [];
  if (Array.isArray(material)) return material.flatMap(entry => captureMaterial(entry, context));
  if (context.materials.has(material)) return [];
  context.materials.add(material);
  if (materialOwners.has(material)) return materialOwners.get(material);
  const parts = [];
  for (const texture of [material.map, material.normalMap, material.clearcoatNormalMap, material.envMap]) {
    if (!texture || texture.userData?.shared || context.textures.has(texture)) continue;
    context.textures.add(texture); parts.push(captureSceneResource(texture, 'owned material texture'));
  }
  parts.push(captureSceneResource(material, 'owned scene material'));
  materialOwners.set(material, parts); return parts;
};

export const disposeMaterial = (material, context = disposalContext()) => {
  retireParts(captureMaterial(material, context));
};

export const disposeObject = (object, context = disposalContext()) => {
  if (!object) return;
  if (objectOwners.has(object)) return retireParts(objectOwners.get(object));
  const parts = [];
  // Capture independent object bindings, geometries, textures and materials
  // before attempts. A failed object listener cannot skip sibling resources.
  if (object.isInstancedMesh) parts.push(captureSceneResource(object, 'instanced mesh bindings'));
  const ownedGeometries = object.userData?.ownedGeometries;
  const geometries = ownedGeometries instanceof Set ? [...ownedGeometries, object.geometry] : [object.geometry];
  for (const geometry of geometries) {
    if (!geometry || geometry.userData?.shared || context.geometries.has(geometry)) continue;
    context.geometries.add(geometry); parts.push(captureSceneResource(geometry, 'owned scene geometry'));
  }
  if (object.material) parts.push(...captureMaterial(object.material, context));
  objectOwners.set(object, parts);
  try { retireParts(parts); }
  finally {
    for (const part of parts) if (!part.pending) ownedGeometries?.delete?.(part.resource);
    if (parts.every(part => !part.pending)) ownedGeometries?.clear?.();
  }
};

export const clearGroup = (group) => {
  if (!group) return;
  const context = disposalContext(), errors = [];
  try {
    group.traverse(child => {
      if (child === group) return;
      try { disposeObject(child, context); } catch (error) { errors.push(error); }
    });
  } catch (error) { errors.push(error); }
  while (group.children.length) {
    try { group.remove(group.children[0]); } catch (error) { errors.push(error); break; }
  }
  const failure = preserveSceneCleanupFailures(null, errors); if (failure) throw failure;
};
