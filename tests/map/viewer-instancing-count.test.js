#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { state } from '../../src/map/isometric/client/state.js';
import { buildMeshes } from '../../src/map/isometric/client/meshes.js';
import { performanceDefaults, visualDefaults } from '../../src/map/isometric/client/defaults.js';

const resetState = () => {
  Object.assign(state, {
    THREE,
    visuals: { ...visualDefaults, glass: { ...visualDefaults.glass } },
    visualDefaults,
    performance: { ...performanceDefaults, drawCaps: { ...performanceDefaults.drawCaps } },
    allFiles: [],
    layoutMetrics: {
      labelOffset: 0.1,
      memberCell: 1,
      memberGap: 0.1,
      baseSize: 3,
      memberInset: 0.3,
      routingPadding: 1,
      routingStep: 1
    },
    fileGroup: new THREE.Group(),
    memberGroup: new THREE.Group(),
    labelGroup: new THREE.Group(),
    wireGroup: new THREE.Group(),
    fileMeshes: [],
    fileInstancedMeshes: [],
    fileInstancedInnerMeshes: [],
    chunkMeshes: [],
    memberInstancedMeshes: [],
    memberClusters: [],
    memberInstanceById: new Map(),
    memberClusterByMemberId: new Map(),
    fileInstanceByKey: new Map(),
    fileBuckets: [],
    fileBucketByKey: new Map(),
    highlightedMemberIds: new Set(),
    highlightedFileKeys: new Set(),
    fileAnchors: new Map(),
    memberAnchors: new Map(),
    fileColorByPath: new Map(),
    memberColorById: new Map(),
    fileWireByKey: new Map(),
    wireByMesh: new Map(),
    normalMapState: { texture: null },
    glowMaterials: [],
    glassMaterials: [],
    wireMaterials: [],
    scoreToColor: () => new THREE.Color(0xffffff)
  });
  state.labelGroup.visible = false;
};

resetState();

state.allFiles = [
  {
    node: { path: 'src/a.js', name: 'a.js', category: 'source', id: 'a' },
    shape: 'box',
    x: 0,
    z: 0,
    width: 2,
    depth: 2,
    height: 1,
    topY: 1,
    memberSlots: [{ x: 0, z: 0 }],
    members: [
      {
        height: 0.6,
        footprint: 0.5,
        score: 0.5,
        shape: 'square',
        member: { id: 'm1', name: 'alpha', file: 'src/a.js' }
      }
    ]
  },
  {
    node: { path: 'src/b.js', name: 'b.js', category: 'source', id: 'b' },
    shape: 'box',
    x: 4,
    z: 0,
    width: 2,
    depth: 2,
    height: 1,
    topY: 1,
    memberSlots: [{ x: 0, z: 0 }],
    members: [
      {
        height: 0.6,
        footprint: 0.5,
        score: 0.6,
        shape: 'square',
        member: { id: 'm2', name: 'beta', file: 'src/b.js' }
      }
    ]
  }
];

buildMeshes();

assert.ok(state.fileInstancedMeshes.length > 0, 'expected instanced file meshes');
assert.equal(state.fileInstanceByKey.size, 2, 'expected file instance count to match file count');
assert.ok(state.memberInstancedMeshes.length > 0, 'expected instanced member meshes');

console.log('map viewer instancing count test passed');
