#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { loadChunkMeta, loadTokenPostings } from '../../../src/shared/artifact-io/loaders.js';
import { getIndexDir } from '../../../src/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-compaction-generation-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
const script = new URL('../../../tools/index/compact-pieces.js', import.meta.url).href;
const chunks = [{ id: 0, file: 'a.js', start: 0, end: 1 }, { id: 1, file: 'b.js', start: 0, end: 1 }];
const seed = async label => {
  const repo = path.join(root, label); await fs.mkdir(repo);
  const dir = getIndexDir(repo, 'code', {});
  const pieces = [];
  const save = async (name, value, artifact) => {
    const file = path.join(dir, name); await fs.mkdir(path.dirname(file), { recursive: true });
    const bytes = typeof value === 'string' ? value : JSON.stringify(value);
    await fs.writeFile(file, bytes);
    pieces.push({ name: artifact, path: name, format: name.endsWith('.jsonl') ? 'jsonl' : 'json',
      bytes: Buffer.byteLength(bytes), checksum: `sha256:${createHash('sha256').update(bytes).digest('hex')}` });
  };
  const chunkParts = [], tokenParts = [];
  for (let i = 0; i < 2; i++) {
    chunkParts.push(`chunk_meta.parts/chunk_meta.part-${i}.jsonl`);
    tokenParts.push(`token_postings.shards/token_postings.part-${i}.json`);
    await save(chunkParts[i], `${JSON.stringify(chunks[i])}\n`, 'chunk_meta');
    await save(tokenParts[i], { vocab: [['alpha', 'beta'][i]], postings: [[[i, 1]]] }, 'token_postings');
  }
  await save('chunk_meta.meta.json', { format: 'jsonl-sharded', totalRecords: 2,
    parts: chunkParts.map(file => ({ path: file, records: 1 })) }, 'chunk_meta_meta');
  await save('token_postings.meta.json', { format: 'sharded', vocabCount: 2, parts: tokenParts,
    totalDocs: 2, docLengths: [1, 1], avgDocLen: 1 }, 'token_postings_meta');
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, version: 2, pieces };
  await fs.mkdir(path.join(dir, 'pieces')); await fs.writeFile(path.join(dir, 'pieces', 'manifest.json'), JSON.stringify(manifest));
  return { repo, dir, manifest };
};
const verify = async (dir, manifest) => {
  for (const piece of manifest.pieces) {
    const bytes = await fs.readFile(path.join(dir, piece.path));
    if (piece.checksum.startsWith('sha256:')) assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, piece.checksum);
    assert.equal(bytes.length, piece.bytes);
  }
  assert.deepEqual(await loadChunkMeta(dir, { manifest }), chunks);
  assert.deepEqual(loadTokenPostings(dir, { manifest }).vocab, ['alpha', 'beta']);
};
try {
  for (const boundary of ['meta-fail', 'manifest-fail', 'crash-before', 'crash-after', 'success']) {
    const { repo, dir, manifest: old } = await seed(boundary);
    const manifestPath = path.join(dir, 'pieces', 'manifest.json');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs/promises';
      const rename = fs.rename, boundary = ${JSON.stringify(boundary)}, manifest = ${JSON.stringify(manifestPath)};
      fs.rename = async (from, to) => {
        if (boundary === 'meta-fail' && to.endsWith('token_postings.meta.json')) throw Object.assign(new Error('metadata failure'), {code:'EIO'});
        if (to === manifest) {
          if (boundary === 'manifest-fail') throw Object.assign(new Error('manifest failure'), {code:'EIO'});
          if (boundary === 'crash-before') process.exit(73);
          const result = await rename(from,to);
          if (boundary === 'crash-after') process.exit(73);
          return result;
        }
        return rename(from,to);
      };
      process.argv = [process.execPath, ${JSON.stringify(script)}, '--repo', ${JSON.stringify(repo)}, '--mode', 'code', '--chunk-meta-size', '2', '--token-postings-size', '2'];
      await import(${JSON.stringify(script)});
    `], { cwd: process.cwd(), encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, boundary.startsWith('crash') ? 73 : boundary.endsWith('fail') ? 1 : 0, child.stderr || child.error?.message);
    const current = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    await verify(dir, old);
    await verify(dir, current);
    if (['crash-after', 'success'].includes(boundary)) {
      assert.equal(current.pieces.filter(piece => piece.name === 'chunk_meta').length, 1);
      assert.notEqual(current.pieces.find(piece => piece.name === 'chunk_meta_meta').path, 'chunk_meta.meta.json');
    } else assert.deepEqual(current, old, 'failed/interrupted staging preserves the published authority');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('piece compaction publishes one coherent immutable generation across failures and process exits');
