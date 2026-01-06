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

console.log('shard-plan test passed.');
