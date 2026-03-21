#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import { reconcileIndexIdentity } from '../../../src/index/identity/reconcile.js';
import { createBaseIndex } from '../validate/helpers.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'identity-reconcile-report');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const uidA = 'ck64:v1:repo:src/a.js#seg:segu:v1:seg-a:0011223344556677';
const uidB = 'ck64:v1:repo:src/b.js#seg:segu:v1:seg-b:8899aabbccddeeff';
const missingUid = 'ck64:v1:repo:src/missing.js#seg:segu:v1:seg-x:ffeeddccbbaa9988';

const chunkMeta = [
  {
    id: 0,
    file: 'src/a.js',
    chunkId: 'chunk_0',
    chunkUid: uidA,
    virtualPath: 'src/a.js#seg:segu:v1:seg-a',
    start: 0,
    end: 12,
    metaV2: {
      chunkId: 'chunk_0',
      chunkUid: uidA,
      virtualPath: 'src/a.js#seg:segu:v1:seg-a',
      file: 'src/a.js',
      segment: { segmentUid: 'segu:v1:seg-a', virtualPath: 'src/a.js#seg:segu:v1:seg-a' }
    }
  },
  {
    id: 1,
    file: 'src/b.js',
    chunkId: 'chunk_1',
    chunkUid: uidB,
    virtualPath: 'src/b.js#seg:segu:v1:seg-b',
    start: 0,
    end: 12,
    metaV2: {
      chunkId: 'chunk_1',
      chunkUid: uidB,
      virtualPath: 'src/b.js#seg:segu:v1:seg-b',
      file: 'src/b.js',
      segment: { segmentUid: 'segu:v1:seg-b', virtualPath: 'src/b.js#seg:segu:v1:seg-b' }
    }
  }
];

const { indexDir, manifest } = await createBaseIndex({
  rootDir: tempRoot,
  chunkMeta
});

const symbols = [
  {
    v: 1,
    symbolId: 'sym1:heur:deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    scopedId: 'scope:a',
    symbolKey: 'symkey:a',
    qualifiedName: 'A',
    kindGroup: 'function',
    file: 'src/a.js',
    virtualPath: 'src/a.js#seg:segu:v1:seg-a',
    chunkUid: missingUid
  }
];
const symbolOccurrences = [
  {
    v: 1,
    host: { file: 'src/a.js', chunkUid: uidA },
    role: 'call',
    ref: {
      status: 'resolved',
      resolved: { symbolId: 'sym1:heur:x', chunkUid: missingUid },
      candidates: []
    },
    range: null
  }
];
const symbolEdges = [
  {
    v: 1,
    type: 'call',
    from: { file: 'src/a.js', chunkUid: uidA },
    to: {
      status: 'resolved',
      resolved: { symbolId: 'sym1:heur:y', chunkUid: missingUid },
      candidates: []
    }
  }
];
const chunkUidMap = [
  {
    docId: 0,
    chunkUid: missingUid,
    chunkId: 'chunk_0',
    file: 'src/a.js',
    segmentUid: 'segu:v1:seg-a',
    start: 0,
    end: 12
  }
];

await writeJsonLinesFile(path.join(indexDir, 'symbols.jsonl'), symbols, { atomic: true });
await writeJsonLinesFile(path.join(indexDir, 'symbol_occurrences.jsonl'), symbolOccurrences, { atomic: true });
await writeJsonLinesFile(path.join(indexDir, 'symbol_edges.jsonl'), symbolEdges, { atomic: true });
await writeJsonLinesFile(path.join(indexDir, 'chunk_uid_map.jsonl'), chunkUidMap, { atomic: true });

manifest.pieces.push({ type: 'symbols', name: 'symbols', format: 'jsonl', path: 'symbols.jsonl', count: symbols.length });
manifest.pieces.push({ type: 'symbols', name: 'symbol_occurrences', format: 'jsonl', path: 'symbol_occurrences.jsonl', count: symbolOccurrences.length });
manifest.pieces.push({ type: 'symbols', name: 'symbol_edges', format: 'jsonl', path: 'symbol_edges.jsonl', count: symbolEdges.length });
manifest.pieces.push({ type: 'tooling', name: 'chunk_uid_map', format: 'jsonl', path: 'chunk_uid_map.jsonl', count: chunkUidMap.length });
await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify(manifest, null, 2));

const report = await reconcileIndexIdentity({
  indexDir,
  mode: 'code',
  strict: true
});

assert.equal(report.ok, false, 'expected identity reconciliation to fail for mismatched artifacts');
const issueText = report.issues.map((issue) => issue.message).join('\n');
assert.match(issueText, /symbols chunkUid missing in chunk_meta/i);
assert.match(issueText, /symbol_occurrences resolved chunkUid missing in chunk_meta/i);
assert.match(issueText, /symbol_edges resolved chunkUid missing in chunk_meta/i);
assert.match(issueText, /chunk_uid_map chunkUid mismatch for docId 0/i);

console.log('identity reconcile report test passed');
