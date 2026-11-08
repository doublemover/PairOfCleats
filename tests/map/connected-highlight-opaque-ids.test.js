import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyHighlights } from '../../src/map/isometric/client/selection.js';
import { parseEndpointKey } from '../../src/map/isometric/client/selection-endpoints.js';
import { state } from '../../src/map/isometric/client/state.js';

const file = 'src/日本語:name.js', member = 'sym:v1:😀:member';
for (const [key, expected] of [
  [`file:${file}`, { type: 'file', id: file }],
  [`member:${member}`, { type: 'member', id: member }],
  ['member:0', { type: 'member', id: '0' }], ['unknown:a:b', null], ['file:', null]
]) assert.deepEqual(parseEndpointKey(key), expected);

const colored = new Map(), writes = [];
const chunkId = 'ck64:v1:repo:path:😀:segment';
const instance = id => ({ mesh: { setColorAt: (_index, color) => (writes.push(id), colored.set(id, color.clone())),
  instanceColor: new THREE.InstancedBufferAttribute(new Float32Array(3), 3) }, instanceId: 0 });
Object.assign(state, {
  THREE, sourceIndex: { resolve: info => ({ ...info, id: info.id === '0' ? 0 : info.id }) }, selected: { object: { userData: { type: 'file', file: 'root.js' } } },
  selectedInfo: { type: 'file', file: 'root.js' },
  hovered: null, hoveredRef: null,
  fileMeshes: [], memberMeshes: [], chunkMeshes: [], edgeMeshes: [], wireMaterials: [],
  fileMeshByKey: new Map(), fileWireByKey: new Map(), wireByMesh: new Map(),
  memberInstanceById: new Map([[member, instance(member)], [0, instance(0)], [chunkId, instance(chunkId)]]),
  fileInstanceByKey: new Map([[file, instance(file)], [member, instance('file:' + member)]]),
  memberColorById: new Map([[member, new THREE.Color(0x222222)], [0, new THREE.Color(0x333333)], [chunkId, new THREE.Color(0x666666)]]),
  fileColorByPath: new Map([[file, new THREE.Color(0x444444)], [member, new THREE.Color(0x555555)]]),
  highlightedMemberIds: new Set(), highlightedFileKeys: new Set(), fileByMember: new Map(),
  edgeSegments: [{ endpoints: new Set(['file:root.js', `member:${member}`, `file:${file}`, 'member:0', `member:${chunkId}`, `file:${member}`]),
    edgeColor: new THREE.Color(0xff0000), mesh: null, index: 0 }]
});
applyHighlights();
for (const id of [member, file, 0, chunkId, 'file:' + member]) assert.ok(colored.has(id), `connected tint: ${id}`);
assert.ok(state.highlightedMemberIds.has(member));
assert.ok(state.highlightedMemberIds.has(0));
assert.ok(state.highlightedFileKeys.has(file));
const priorWrites = writes.length;
state.memberInstanceById.set(member, instance('replacement:' + member));
state.memberColorById.set(member, new THREE.Color(0x777777));
applyHighlights();
assert.ok(writes.slice(priorWrites).includes('replacement:' + member));
assert.ok(!writes.slice(priorWrites).includes(member), 'rebatching only tints the new source-instance mapping');
state.selected = null;
state.selectedInfo = null;
applyHighlights();
assert.equal(colored.get('replacement:' + member).getHex(), 0x777777);
assert.equal(colored.get(chunkId).getHex(), 0x666666);
assert.equal(colored.get('file:' + member).getHex(), 0x555555);
assert.equal(colored.get(0).getHex(), 0x333333);
assert.equal(colored.get(file).getHex(), 0x444444);
assert.equal(state.highlightedMemberIds.size, 0);
assert.equal(state.highlightedFileKeys.size, 0);
console.log('Connected highlights and resets preserve opaque colon/Unicode IDs and numeric zero.');
