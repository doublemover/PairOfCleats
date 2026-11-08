import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHoverFrame } from '../../src/map/isometric/client/hover-frame.js';

const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
camera.position.z = 5; camera.updateMatrixWorld();
const geometry = new THREE.BoxGeometry(1, 1, 1), material = new THREE.MeshBasicMaterial();
const mesh = new THREE.Mesh(geometry, material); mesh.updateMatrixWorld();
const raycaster = new THREE.Raycaster();
let picks = 0, clears = 0, lastPointer, lastHit;
const hover = createHoverFrame({
  pick(pointer) {
    picks += 1; lastPointer = pointer;
    raycaster.setFromCamera({ x: pointer.clientX, y: pointer.clientY }, camera);
    lastHit = raycaster.intersectObjects([mesh], false)[0] || null;
  },
  clear() { clears += 1; lastHit = null; }
});
for (let index = 0; index < 100; index += 1) hover.move({ clientX: index / 100, clientY: 0 });
hover.move({ clientX: 0, clientY: 0 });
assert.equal(picks, 0);
assert.equal(hover.frame(), true);
assert.equal(picks, 1);
assert.deepEqual(lastPointer, { clientX: 0, clientY: 0 });
assert.equal(lastHit.object, mesh, 'the latest delivered position is tested by the actual raycaster');
for (let index = 0; index < 30; index += 1) hover.frame();
assert.equal(picks, 1, 'idle frames do no rectangle/target/raycast work');
hover.invalidate(); hover.frame();
assert.equal(picks, 2, 'camera/visibility/culling owners explicitly invalidate a stationary pointer');
hover.move({ clientX: 1, clientY: 1 }); hover.leave(); hover.frame();
assert.equal(picks, 2); assert.equal(lastHit, null, 'leave cannot be undone by an old pending hover');
hover.move({ clientX: 0, clientY: 0 }); hover.startDrag(); hover.frame();
assert.equal(picks, 2, 'dragging suppresses hover picks');
hover.endDrag(); hover.frame(); assert.equal(picks, 3);
hover.dispose(); hover.move({ clientX: 0, clientY: 0 }); hover.invalidate(); hover.frame();
assert.equal(picks, 3); assert.ok(clears >= 3);
geometry.dispose(); material.dispose();
console.log('Frame-owned hover coalesces real raycasts, remains idle without changes and fences leave/drag/disposal.');
