#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyBucketCulling } from '../../src/map/isometric/client/culling.js';

const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
const mesh = new THREE.InstancedMesh(geometry, material, 1);
const baseMatrix = new THREE.Matrix4().makeTranslation(0, 0, 0);
mesh.setMatrixAt(0, baseMatrix);
mesh.instanceMatrix.needsUpdate = true;

const bucket = {
  mesh,
  instances: [{ index: 0, baseMatrix }],
  sphere: new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1),
  visible: true
};

const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

const frustumHide = { intersectsSphere: () => false };
applyBucketCulling({ frustum: frustumHide, buckets: [bucket], hiddenMatrix });
const hiddenCheck = new THREE.Matrix4();
mesh.getMatrixAt(0, hiddenCheck);
assert.ok(hiddenCheck.equals(hiddenMatrix), 'expected instance to be hidden');

const frustumShow = { intersectsSphere: () => true };
applyBucketCulling({ frustum: frustumShow, buckets: [bucket], hiddenMatrix });
const visibleCheck = new THREE.Matrix4();
mesh.getMatrixAt(0, visibleCheck);
assert.ok(visibleCheck.equals(baseMatrix), 'expected instance to be restored');

console.log('map viewer culling correctness test passed');
