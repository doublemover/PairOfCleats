import assert from 'node:assert/strict';
import { createCompilerPortPeerIndex } from '../../../src/index/semantic/compiler-port-peer-index.js';
const candidates = value => value?.ports || (value?.port ? [value] : []);
const index = createCompilerPortPeerIndex({ candidates });
const channels = Array.from({ length: 1000 }, () => ({})), rows = [];
for (let id = 0; id < channels.length; id++) {
  const row = { peerOrdinal: id, receiverPort: { channel: channels[id], port: 'port2' } };
  rows.push(row); index.set(row, row.receiverPort);
}
for (let id = 0; id < channels.length; id++) assert.deepEqual(index.find({ channel: channels[id], port: 'port1' }), [rows[id]]);
assert.equal(index.stats.candidateVisits, 1000, 'disjoint channels avoid the Cartesian peer scan');
const transferred = { ports: [{ channel: channels[1], port: 'port2' }, { channel: channels[2], port: 'port2' }] };
rows[0].receiverPort = transferred; index.set(rows[0], transferred);
assert.deepEqual(index.find({ channel: channels[2], port: 'port1' }), [rows[0], rows[2]]);
assert.deepEqual(index.find({ channel: channels[0], port: 'port1' }), []);
const capped = createCompilerPortPeerIndex({ candidates, maxEntries: 1 });
capped.set(rows[1], rows[1].receiverPort); capped.set(rows[2], rows[2].receiverPort);
assert.equal(capped.stats.fallback, true);
assert.deepEqual(capped.find({ channel: channels[2], port: 'port1' }, { fallback: rows }), [rows[0], rows[2]]);
let work = 0;
assert.ok(capped.find({ channel: channels[2], port: 'port1' }, { fallback: rows, admit: () => ++work < 3 }).length <= 2);
console.log('canonical MessagePort indexes retain all opposite endpoints and bounded overflow fallback');
