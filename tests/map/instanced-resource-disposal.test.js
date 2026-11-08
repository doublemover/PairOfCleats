// Real Three CPU lifecycle owners; this does not measure a browser GPU.
import assert from 'node:assert/strict';
import { Group, BoxGeometry, MeshBasicMaterial, InstancedMesh, Color } from 'three';
import { WebGLObjects } from 'three/src/renderers/webgl/WebGLObjects.js';
import { clearGroup, disposeObject } from '../../src/map/isometric/client/scene-utils.js';

for (let cycle = 0; cycle < 20; cycle += 1) {
  const attributes = new Set(), retired = [], bindings = [];
  const objects = WebGLObjects({ ARRAY_BUFFER: 34962 }, { get: (_object, geometry) => geometry, update() {} },
    { update: attribute => attributes.add(attribute), remove: attribute => { attributes.delete(attribute); retired.push(attribute); } },
    { releaseStatesOfObject: object => bindings.push(object) }, { render: { frame: cycle } });
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  let geometryDisposals = 0, materialDisposals = 0, objectDisposals = 0;
  geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
  material.addEventListener('dispose', () => { materialDisposals += 1; });
  const root = new Group(), nested = new Group();
  root.add(nested);
  const meshes = Array.from({ length: 2 }, () => {
    const mesh = new InstancedMesh(geometry, material, 1);
    mesh.setColorAt(0, new Color('red'));
    mesh.addEventListener('dispose', () => { objectDisposals += 1; });
    nested.add(mesh);
    objects.update(mesh);
    return mesh;
  });
  assert.equal(attributes.size, 4);
  clearGroup(root);
  meshes.forEach(mesh => disposeObject(mesh));
  assert.equal(objectDisposals, 2);
  assert.equal(geometryDisposals, 1);
  assert.equal(materialDisposals, 1);
  assert.equal(attributes.size, 0, 'actual object-dispose owner retires matrix and color buffers');
  assert.equal(retired.length, 4);
  assert.deepEqual(new Set(bindings), new Set(meshes));
  assert.equal(root.children.length, 0);
  objects.dispose();
}
const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
geometry.userData.shared = true;
material.userData.shared = true;
let sharedDisposals = 0;
geometry.addEventListener('dispose', () => { sharedDisposals += 1; });
material.addEventListener('dispose', () => { sharedDisposals += 1; });
const group = new Group();
group.add(new InstancedMesh(geometry, material, 1));
clearGroup(group);
assert.equal(sharedDisposals, 0, 'retired objects do not dispose explicitly shared assets');
geometry.dispose(); material.dispose();
console.log('Real Three instanced disposal retires object bindings and instance attributes once');
