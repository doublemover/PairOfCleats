#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { planShards } from '../src/index/build/shards.js';

const makeEntry = (rel) => ({
  rel,
  abs: path.join('C:\\repo', rel)
});

const entriesA = [
  makeEntry('src/sub/a.js'),
  makeEntry('src/sub/b.js'),
  makeEntry('src/root.js')
];
const shardsA = planShards(entriesA, {
  mode: 'code',
  dirDepth: 2,
  lineCounts: new Map()
});
const labelsA = new Set(shardsA.map((shard) => shard.label));
assert.ok(labelsA.has('src/javascript'), 'parent shard missing');
assert.ok(labelsA.has('./javascript'), 'root shard missing');
assert.ok(!Array.from(labelsA).some((label) => label.startsWith('src/sub/')));
const srcShardA = shardsA.find((shard) => shard.label === 'src/javascript');
assert.equal(srcShardA.entries.length, 2);

const entriesB = [];
const lineCountsB = new Map();
for (let i = 0; i < 10; i += 1) {
  const rel = `src/large${i}/file.js`;
  entriesB.push(makeEntry(rel));
  lineCountsB.set(rel, 100);
}
entriesB.push(makeEntry('src/huge/file.js'));
lineCountsB.set('src/huge/file.js', 60);
entriesB.push(makeEntry('src/small/file.js'));
lineCountsB.set('src/small/file.js', 1);
const shardsB = planShards(entriesB, {
  mode: 'code',
  dirDepth: 2,
  lineCounts: lineCountsB
});
const labelsB = new Set(shardsB.map((shard) => shard.label));
assert.ok(labelsB.has('src/huge/javascript'), 'huge-file shard should stay separate');
assert.ok(!labelsB.has('src/small/javascript'), 'small shard should merge to parent');
const parentB = shardsB.find((shard) => shard.label === 'src/javascript');
assert.ok(parentB, 'parent shard should exist for merged subdirs');
assert.ok(parentB.entries.some((entry) => entry.rel === 'src/small/file.js'));

const entriesC = [];
const lineCountsC = new Map();
const extensions = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
for (const ext of extensions) {
  const rel = `file.${ext}`;
  entriesC.push(makeEntry(rel));
  lineCountsC.set(rel, 10);
}
for (let i = 0; i < 10; i += 1) {
  const rel = `big${i}.js`;
  entriesC.push(makeEntry(rel));
  lineCountsC.set(rel, 10);
}
const shardsC = planShards(entriesC, {
  mode: 'code',
  dirDepth: 1,
  lineCounts: lineCountsC
});
const splitParts = shardsC.filter((shard) => shard.label.startsWith('./javascript#'));
assert.equal(splitParts.length, 10, 'expected split shards for large group');
assert.ok(splitParts.every((shard) => shard.splitFrom === './javascript'));

const entriesD = [];
const lineCountsD = new Map();
for (let i = 0; i < 50; i += 1) {
  for (let j = 0; j < 20; j += 1) {
    const rel = `src/pkg${String(i).padStart(2, '0')}/file${String(j).padStart(2, '0')}.js`;
    entriesD.push(makeEntry(rel));
    lineCountsD.set(rel, 10 + (i % 5));
  }
}
const shardsD1 = planShards(entriesD, {
  mode: 'code',
  dirDepth: 2,
  lineCounts: lineCountsD,
  maxShards: 200
});
const shardsD2 = planShards(entriesD, {
  mode: 'code',
  dirDepth: 2,
  lineCounts: lineCountsD,
  maxShards: 200
});
assert.equal(shardsD1.length, shardsD2.length, 'expected stable shard counts for large input');
assert.deepEqual(
  shardsD1.map((shard) => shard.id),
  shardsD2.map((shard) => shard.id),
  'expected deterministic shard IDs for large input'
);

const entriesE = [];
const lineCountsE = new Map();
for (let dir = 0; dir < 30; dir += 1) {
  for (let file = 0; file < 10; file += 1) {
    const rel = `src/pkg${String(dir).padStart(2, '0')}/file${String(file).padStart(2, '0')}.js`;
    entriesE.push({ rel, abs: path.join('C:\\repo', rel), bytes: 1024 });
    lineCountsE.set(rel, 10);
  }
}
const perfProfile = {
  buckets: [{ id: 'xs', maxBytes: 2048 }, { id: 'xl', maxBytes: null }],
  totals: { avgMsPerFile: 5, byteCostMs: 0.01, lineCostMs: 0.1 },
  languages: {
    javascript: { totals: { avgMsPerFile: 5, byteCostMs: 0.01, lineCostMs: 0.1 }, buckets: {} }
  }
};
const shardsE1 = planShards(entriesE, {
  mode: 'code',
  dirDepth: 2,
  lineCounts: lineCountsE,
  perfProfile,
  maxShards: 10
});
const shardsE2 = planShards(entriesE, {
  mode: 'code',
  dirDepth: 2,
  lineCounts: lineCountsE,
  perfProfile,
  maxShards: 10
});
assert.equal(shardsE1.length, shardsE2.length, 'expected stable shard counts with perf profile');
assert.deepEqual(
  shardsE1.map((shard) => shard.id),
  shardsE2.map((shard) => shard.id),
  'expected deterministic shard IDs with perf profile'
);
const totalEntriesE = shardsE1.reduce((sum, shard) => sum + shard.entries.length, 0);
assert.equal(totalEntriesE, entriesE.length, 'expected all entries to be assigned');
assert.ok(shardsE1.every((shard) => shard.costMs > 0), 'expected perf-based cost totals');

console.log('shard-plan test passed.');
