#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCodeMap } from '../../../src/map/build-map.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'map-build-symbol-identity');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const chunkMeta = [
  {
    id: 1,
    start: 0,
    end: 10,
    file: 'src/alpha.js',
    name: 'alpha',
    kind: 'function',
    chunkUid: 'uid-alpha',
    metaV2: {
      chunkUid: 'uid-alpha',
      file: 'src/alpha.js',
      name: 'alpha',
      kind: 'function',
      symbol: {
        v: 1,
        scheme: 'heur',
        kindGroup: 'function',
        qualifiedName: 'alpha',
        symbolKey: 'src/alpha.js::alpha::function',
        signatureKey: null,
        scopedId: 'function|src/alpha.js::alpha::function|uid-alpha',
        symbolId: 'sym1:heur:alpha'
      }
    }
  }
];

await fs.writeFile(path.join(tempRoot, 'chunk_meta.json'), JSON.stringify(chunkMeta, null, 2));

const mapModel = await buildCodeMap({
  repoRoot: root,
  indexDir: tempRoot,
  options: { include: [], strict: false }
});

const member = mapModel.nodes?.[0]?.members?.[0];
assert.ok(member, 'expected member in map');
assert.equal(member.id, 'sym1:heur:alpha', 'expected member id to prefer symbolId');
assert.notEqual(member.id, 'uid-alpha', 'expected member id to differ from chunkUid');

console.log('map build symbol identity test passed');
