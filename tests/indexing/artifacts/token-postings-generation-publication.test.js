#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { enqueueTokenPostingsArtifacts } from '../../../src/index/build/artifacts/token-postings.js';
import { loadTokenPostings } from '../../../src/shared/artifact-io/loaders.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-token-generation-'));
const oldMeta = { format: 'sharded', parts: ['token_postings.shards/old.json'], docLengths: [1], totalDocs: 1, vocabCount: 1 };
const oldManifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, version: 2, pieces: [
  { name: 'token_postings', path: oldMeta.parts[0], format: 'json' },
  { name: 'token_postings_meta', path: 'token_postings.meta.json', format: 'json' }
] };
await fs.mkdir(path.join(root, 'token_postings.shards')); await fs.mkdir(path.join(root, 'pieces'));
await fs.mkdir(path.join(root, 'token_postings.shards.bak'));
await fs.writeFile(path.join(root, oldMeta.parts[0]), JSON.stringify({ vocab: ['old'], postings: [[[0, 1]]] }));
await fs.writeFile(path.join(root, 'token_postings.meta.json'), JSON.stringify(oldMeta));
await fs.writeFile(path.join(root, 'token_postings.shards.bak', 'recovery'), 'retained recovery');
await fs.writeFile(path.join(root, 'pieces', 'manifest.json'), JSON.stringify(oldManifest));
const write = async fault => {
  const tasks = [], pieces = [];
  await enqueueTokenPostingsArtifacts({ outDir: root,
    postings: { tokenVocab: ['new'], tokenPostingsList: [[[0, 2]]], avgDocLen: 2 }, state: { docLengths: [2] },
    tokenPostingsUseShards: true, tokenPostingsShardSize: 1, tokenPostingsFormat: 'sharded',
    enqueueWrite: (_label, job) => tasks.push(job), formatArtifactLabel: value => value,
    addPieceFile: (piece, file) => pieces.push({ ...piece, path: path.relative(root, file).split(path.sep).join('/') }) });
  const rename = fs.rename;
  fs.rename = async (from, to) => {
    if ((fault === 'promotion' && to.endsWith('token_postings.shards'))
      || (fault === 'metadata' && to.endsWith('token_postings.meta.json'))) throw Object.assign(new Error(fault), { code: 'EIO' });
    return rename(from, to);
  };
  try {
    const run = async () => { for (const job of tasks) await job(); };
    if (fault) await assert.rejects(run(), { code: 'EIO' });
    else await run();
  } finally { fs.rename = rename; }
  return pieces;
};
try {
  for (const fault of ['promotion', 'metadata', null]) {
    const pieces = await write(fault);
    assert.deepEqual(loadTokenPostings(root).vocab, ['old'], 'uncommitted generation cannot alter old manifest readers');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'token_postings.meta.json'), 'utf8')), oldMeta);
    assert.equal(await fs.readFile(path.join(root, 'token_postings.shards.bak', 'recovery'), 'utf8'), 'retained recovery');
    if (!fault) {
      await fs.writeFile(path.join(root, 'pieces', 'manifest.json'), JSON.stringify({ ...oldManifest, pieces }));
      assert.deepEqual(loadTokenPostings(root).vocab, ['new']);
      assert.deepEqual(loadTokenPostings(root, { manifest: oldManifest }).vocab, ['old']);
    }
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('token shard retries retain prior authority until manifest publication');
