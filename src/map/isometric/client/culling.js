import { toArray } from '../../../shared/iterables.js';

export const applyBucketCulling = ({ frustum, buckets, hiddenMatrix }) => {
  if (!frustum) return new Set();
  const meshUpdates = new Set();
  for (const bucket of toArray(buckets)) {
    if (!bucket?.sphere || !bucket?.mesh) continue;
    const visible = frustum.intersectsSphere(bucket.sphere);
    if (visible === bucket.visible) continue;
    bucket.visible = visible;
    for (const entry of toArray(bucket.instances)) {
      const matrix = visible ? entry.baseMatrix : hiddenMatrix;
      bucket.mesh.setMatrixAt(entry.index, matrix);
    }
    meshUpdates.add(bucket.mesh);
  }
  for (const mesh of meshUpdates) {
    if (mesh.instanceMatrix) mesh.instanceMatrix.needsUpdate = true;
  }
  return meshUpdates;
};

export const forceBucketVisible = (bucket) => {
  if (!bucket || !bucket.mesh || !bucket.instances) return;
  bucket.visible = true;
  for (const entry of toArray(bucket.instances)) {
    bucket.mesh.setMatrixAt(entry.index, entry.baseMatrix);
  }
  if (bucket.mesh.instanceMatrix) bucket.mesh.instanceMatrix.needsUpdate = true;
};

export const applyEdgeCulling = ({ frustum, targets }) => {
  if (!frustum) return;
  for (const target of toArray(targets)) {
    const mesh = target?.mesh;
    if (!mesh || !target.sphere) continue;
    if (mesh.parent?.visible === false) continue;
    const worldSphere = target.sphere.clone().applyMatrix4(mesh.matrixWorld);
    mesh.visible = frustum.intersectsSphere(worldSphere);
  }
};
