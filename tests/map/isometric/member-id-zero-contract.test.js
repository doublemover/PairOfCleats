#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { state } from '../../../src/map/isometric/client/state.js';
import { initMapData } from '../../../src/map/isometric/client/map-data.js';

applyTestEnv();

state.map = {
  nodes: [
    {
      id: 'file-1',
      path: 'src/a.js',
      members: [
        {
          id: 0,
          name: 'zeroMember',
          file: 'src/a.js',
          range: { startLine: 1, endLine: 1 }
        },
        {
          id: 2,
          name: 'otherMember',
          file: 'src/a.js',
          range: { startLine: 3, endLine: 5 }
        }
      ]
    }
  ],
  edges: [],
  edgeAggregates: []
};

initMapData();

assert.equal(state.memberById.get(0)?.name, 'zeroMember');
assert.equal(state.fileByMember.get(0), 'src/a.js');
const rangeKey = state.buildMemberKey('src/a.js', 'zeroMember', { startLine: 1, endLine: 1 });
assert.equal(state.memberByKey.get(rangeKey)?.id, 0);

console.log('map isometric member id zero contract test passed');
