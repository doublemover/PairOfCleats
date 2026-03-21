#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import { createBaseIndex } from '../../indexing/validate/helpers.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'reconcile-identity-cli');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const uidA = 'ck64:v1:repo:src/a.js#seg:segu:v1:seg-a:0011223344556677';
const missingUid = 'ck64:v1:repo:src/missing.js#seg:segu:v1:seg-x:ffeeddccbbaa9988';

const { indexRoot, indexDir, manifest } = await createBaseIndex({
  rootDir: tempRoot,
  chunkMeta: [
    {
      id: 0,
      file: 'src/a.js',
      chunkId: 'chunk_0',
      chunkUid: uidA,
      virtualPath: 'src/a.js#seg:segu:v1:seg-a',
      metaV2: {
        chunkId: 'chunk_0',
        chunkUid: uidA,
        virtualPath: 'src/a.js#seg:segu:v1:seg-a',
        file: 'src/a.js',
        segment: { segmentUid: 'segu:v1:seg-a', virtualPath: 'src/a.js#seg:segu:v1:seg-a' }
      }
    }
  ]
});

await writeJsonLinesFile(path.join(indexDir, 'symbols.jsonl'), [
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
], { atomic: true });

manifest.pieces.push({ type: 'symbols', name: 'symbols', format: 'jsonl', path: 'symbols.jsonl', count: 1 });
await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify(manifest, null, 2));

const result = spawnSync(
  process.execPath,
  ['tools/index/reconcile-identity.js', '--index-root', indexRoot, '--mode', 'code', '--json'],
  {
    cwd: root,
    encoding: 'utf8'
  }
);

assert.equal(result.status, 1, `expected failing exit status, got ${result.status}\n${result.stderr}`);
const report = JSON.parse(result.stdout);
assert.equal(report.ok, false, 'expected failing JSON report');
assert.ok(
  report.issues.some((issue) => /symbols chunkUid missing in chunk_meta/i.test(issue.message)),
  'expected CLI report to surface symbol drift'
);

console.log('reconcile identity CLI test passed');
