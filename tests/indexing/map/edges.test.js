#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createEdgeResolvers } from '../../../src/map/isometric/client/edges/resolvers.js';
import { createRoutingHelpers } from '../../../src/map/isometric/client/edges/routing.js';
import { aggregateEdges } from '../../../src/map/isometric/client/edges/aggregate.js';

class Color {
  constructor(r = 0, g = 0, b = 0) {
    this.r = r;
    this.g = g;
    this.b = b;
  }
  add(color) {
    this.r += color.r;
    this.g += color.g;
    this.b += color.b;
    return this;
  }
  clone() {
    return new Color(this.r, this.g, this.b);
  }
  lerp(color, alpha) {
    this.r += (color.r - this.r) * alpha;
    this.g += (color.g - this.g) * alpha;
    this.b += (color.b - this.b) * alpha;
    return this;
  }
  multiplyScalar(scale) {
    this.r *= scale;
    this.g *= scale;
    this.b *= scale;
    return this;
  }
}

const THREE = { Color };

const routingHelpers = createRoutingHelpers({
  useRouting: true,
  layoutStyle: 'grid',
  routingStep: 1,
  layoutMetrics: { baseSize: 1 },
  routingPadding: 0,
  obstacles: [],
  bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 }
});
const route = routingHelpers.findRoute({ x: 0, z: 0 }, { x: 2, z: 3 });
assert.deepEqual(route, [
  { x: 0, z: 0 },
  { x: 2, z: 0 },
  { x: 2, z: 3 }
]);

const fileByMember = new Map([['m1', 'file-a']]);
const memberColorById = new Map([['m1', new Color(1, 0, 0)]]);
const fileColorByPath = new Map([['file-a', new Color(0, 0, 1)]]);
const memberAnchors = new Map([['m1', { x: 1, y: 2, z: 3 }]]);
const fileAnchors = new Map([['file-a', { x: 4, y: 5, z: 6 }]]);
const { resolveEdgeFile, resolveEdgeColor, resolveAnchor } = createEdgeResolvers({
  fileByMember,
  memberColorById,
  fileColorByPath,
  memberAnchors,
  fileAnchors,
  useMemberAnchors: true
});

assert.equal(resolveEdgeFile({ member: 'm1' }), 'file-a');
assert.equal(resolveEdgeColor({ member: 'm1' }).r, 1);
assert.deepEqual(resolveAnchor({ member: 'm1' }), { x: 1, y: 2, z: 3 });

const edges = [
  { type: 'calls', from: { file: 'file-a' }, to: { file: 'file-b' } },
  { type: 'calls', from: { file: 'file-a' }, to: { file: 'file-b' } },
  { type: 'other', from: { file: 'file-a' }, to: { file: 'file-c' } }
];
const edgeWeights = { calls: 2, other: 1 };
const resolveEdgeType = (type) => type;
const resolveEdgeFileForAggregate = (endpoint) => endpoint?.file || null;

const aggregated = aggregateEdges({
  edges,
  edgeWeights,
  fileColorByPath: new Map(),
  resolveEdgeType,
  resolveEdgeFile: resolveEdgeFileForAggregate,
  THREE
});

assert.equal(aggregated.length, 2);
const callsEntry = aggregated.find((entry) => entry.type === 'calls');
assert.equal(callsEntry.weight, 4);

console.log('map edges test passed');
