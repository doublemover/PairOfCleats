export const createEndpointDotTracker = ({ THREE }) => {
  const endpointDots = new Map();
  const addEndpointDot = (key, anchor, color) => {
    if (!key || !anchor) return;
    const entry = endpointDots.get(key) || {
      x: anchor.x,
      y: anchor.y,
      z: anchor.z,
      color: new THREE.Color(0, 0, 0),
      weight: 0
    };
    if (color) {
      entry.color.add(color.clone().multiplyScalar(1));
      entry.weight += 1;
    }
    endpointDots.set(key, entry);
  };

  return { endpointDots, addEndpointDot };
};

export const buildEndpointDotsMesh = ({ THREE, endpointDots, edgeGroup, visuals, state, applyHeightFog }) => {
  if (!endpointDots.size) return;
  const dotGeometry = state.edgeDotGeometry || (state.edgeDotGeometry = (() => {
    const geom = new THREE.SphereGeometry(0.08, 10, 10);
    geom.userData = { ...(geom.userData || {}), shared: true };
    return geom;
  })());
  const dotMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: visuals.flowGlowBase,
    metalness: 0.7,
    roughness: 0.25,
    envMapIntensity: visuals.glass.envMapIntensity,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    depthTest: true,
    vertexColors: true
  });
  dotMaterial.userData = {
    glowBase: visuals.flowGlowBase,
    glowRange: visuals.flowGlowRange,
    glowSpeed: 1.1,
    glowPhase: 0.4
  };
  applyHeightFog(dotMaterial);
  state.edgeDotMaterial = dotMaterial;
  state.glowMaterials.push(dotMaterial);
  const dotMesh = new THREE.InstancedMesh(dotGeometry, dotMaterial, endpointDots.size);
  const dummy = new THREE.Object3D();
  let index = 0;
  endpointDots.forEach((entry) => {
    const color = entry.weight ? entry.color.multiplyScalar(1 / entry.weight) : new THREE.Color(0xffffff);
    dummy.position.set(entry.x, entry.y, entry.z);
    dummy.updateMatrix();
    dotMesh.setMatrixAt(index, dummy.matrix);
    dotMesh.setColorAt(index, color);
    index += 1;
  });
  dotMesh.instanceMatrix.needsUpdate = true;
  if (dotMesh.instanceColor) dotMesh.instanceColor.needsUpdate = true;
  dotMesh.renderOrder = 8;
  edgeGroup.add(dotMesh);
  state.edgeDotMesh = dotMesh;
};
