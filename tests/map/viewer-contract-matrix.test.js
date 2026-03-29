#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { applyBucketCulling, forceBucketVisible } from '../../src/map/isometric/client/culling.js';
import { applyDisplayLimits } from '../../src/map/isometric/client/display-limits.js';
import { performanceDefaults, visualDefaults } from '../../src/map/isometric/client/defaults.js';
import { resolveLodTier } from '../../src/map/isometric/client/lod.js';
import { buildMeshes } from '../../src/map/isometric/client/meshes.js';
import { state } from '../../src/map/isometric/client/state.js';
import { updatePerfStats } from '../../src/map/isometric/client/telemetry.js';

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

const cases = [
  {
    name: 'bucket culling hides and restores instances and force-visible overrides culling',
    run() {
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

      applyBucketCulling({ frustum: { intersectsSphere: () => false }, buckets: [bucket], hiddenMatrix });
      const hiddenCheck = new THREE.Matrix4();
      mesh.getMatrixAt(0, hiddenCheck);
      assert.ok(hiddenCheck.equals(hiddenMatrix));

      applyBucketCulling({ frustum: { intersectsSphere: () => true }, buckets: [bucket], hiddenMatrix });
      const visibleCheck = new THREE.Matrix4();
      mesh.getMatrixAt(0, visibleCheck);
      assert.ok(visibleCheck.equals(baseMatrix));

      applyBucketCulling({ frustum: { intersectsSphere: () => false }, buckets: [bucket], hiddenMatrix });
      forceBucketVisible(bucket);
      const forcedCheck = new THREE.Matrix4();
      mesh.getMatrixAt(0, forcedCheck);
      assert.ok(forcedCheck.equals(baseMatrix));

      const malformedBucket = {
        mesh,
        instances: { broken: true },
        sphere: new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1),
        visible: true
      };
      assert.doesNotThrow(() => applyBucketCulling({ frustum: { intersectsSphere: () => false }, buckets: [malformedBucket], hiddenMatrix }));
    }
  },
  {
    name: 'display limits truncate files members and edges consistently',
    run() {
      const map = {
        nodes: [
          { path: 'src/a.js', name: 'a.js', members: [{ id: 'a1' }, { id: 'a2' }] },
          { path: 'src/b.js', name: 'b.js', members: [{ id: 'b1' }] }
        ],
        edges: [
          { type: 'call', from: { file: 'src/a.js', member: 'a1' }, to: { file: 'src/b.js', member: 'b1' } },
          { type: 'call', from: { file: 'src/a.js', member: 'a2' }, to: { file: 'src/b.js', member: 'b1' } }
        ]
      };

      const { map: limited, limits } = applyDisplayLimits(map, {
        maxFiles: 2,
        maxMembersPerFile: 1,
        maxEdges: 1
      });

      assert.equal(limits.maxFiles, 2);
      assert.equal(limited.nodes.length, 2);
      assert.equal(limited.nodes[0].members.length, 1);
      assert.equal(limited.edges.length, 1);
      assert.ok(limited.summary.truncated);
    }
  },
  {
    name: 'instanced mesh building tracks file and member instance counts',
    run() {
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
          members: [{ height: 0.6, footprint: 0.5, score: 0.5, shape: 'square', member: { id: 'm1', name: 'alpha', file: 'src/a.js' } }]
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
          members: [{ height: 0.6, footprint: 0.5, score: 0.6, shape: 'square', member: { id: 'm2', name: 'beta', file: 'src/b.js' } }]
        }
      ];

      buildMeshes();

      assert.ok(state.fileInstancedMeshes.length > 0);
      assert.equal(state.fileInstanceByKey.size, 2);
      assert.ok(state.memberInstancedMeshes.length > 0);
    }
  },
  {
    name: 'lod switching and telemetry respond to load and dropped frames',
    run() {
      const perf = { ...performanceDefaults, lod: { ...performanceDefaults.lod } };
      assert.equal(resolveLodTier({ zoom: 30, edgeCount: 1000, frameMs: 8, performance: perf }), 'full');
      assert.equal(resolveLodTier({ zoom: 10, edgeCount: 4000, frameMs: 20, performance: perf }), 'simplified');
      assert.equal(resolveLodTier({ zoom: 4, edgeCount: 15000, frameMs: 40, performance: perf }), 'hidden');

      const perfStats = { droppedFrames: 0 };
      let fpsState = { start: 0, frames: 0 };
      const step = (now, frameMs) => {
        const result = updatePerfStats({
          perfStats,
          now,
          frameMs,
          budgetMs: 18,
          fpsState,
          heapUsed: 1024 * 1024
        });
        Object.assign(perfStats, result.stats);
        fpsState = result.fpsState;
      };

      step(0, 16);
      step(16, 22);
      step(32, 40);

      assert.ok(perfStats.droppedFrames >= 1);
      assert.ok(perfStats.frameMs > 0);
      assert.ok(perfStats.heapUsed);
    }
  }
];

for (const entry of cases) {
  entry.run();
}

console.log('map viewer contract matrix test passed');
