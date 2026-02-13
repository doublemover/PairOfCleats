#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { toRealPathSync } from '../../src/workspace/identity.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-signature-variants-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');

const repoCacheRoot = getRepoCacheRoot(toRealPathSync(repoRoot));
const buildRoot = path.join(repoCacheRoot, 'builds', 'build-1');
const indexDir = path.join(buildRoot, 'index-code');
await fs.mkdir(path.join(indexDir, 'chunk_meta.parts'), { recursive: true });
await fs.mkdir(path.join(indexDir, 'token_postings.shards'), { recursive: true });
await fs.writeFile(path.join(indexDir, 'chunk_meta.meta.json'), '{"parts":1}', 'utf8');
await fs.writeFile(path.join(indexDir, 'chunk_meta.parts', 'chunk_meta.part-00001.jsonl'), '{"id":1}\n', 'utf8');
await fs.writeFile(path.join(indexDir, 'token_postings.meta.json'), '{"parts":1}', 'utf8');
await fs.writeFile(path.join(indexDir, 'token_postings.shards', 'token_postings.part-00001.jsonl'), '{"token":"a"}\n', 'utf8');
await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
  buildId: 'build-1',
  buildRoot
}), 'utf8');

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [{ "root": "./repo" }]
}`, 'utf8');

const workspaceConfig = loadWorkspaceConfig(workspacePath);
const first = await generateWorkspaceManifest(workspaceConfig, { write: false });
const firstSignature = first.manifest.repos[0].indexes.code.indexSignatureHash;
assert.ok(firstSignature && firstSignature.startsWith('is1-'), 'sharded artifacts should produce an index signature');

await fs.rm(path.join(indexDir, 'chunk_meta.parts'), { recursive: true, force: true });
await fs.rm(path.join(indexDir, 'token_postings.shards'), { recursive: true, force: true });
await fs.rm(path.join(indexDir, 'chunk_meta.meta.json'), { force: true });
await fs.rm(path.join(indexDir, 'token_postings.meta.json'), { force: true });
await fs.writeFile(path.join(indexDir, 'chunk_meta.jsonl'), '{"id":1}\n', 'utf8');
await fs.writeFile(path.join(indexDir, 'token_postings.packed.bin'), 'packed', 'utf8');
await fs.writeFile(path.join(indexDir, 'token_postings.packed.meta.json'), '{"rows":1}', 'utf8');

const second = await generateWorkspaceManifest(workspaceConfig, { write: false });
const secondSignature = second.manifest.repos[0].indexes.code.indexSignatureHash;
assert.ok(secondSignature && secondSignature.startsWith('is1-'), 'jsonl/packed variants should produce an index signature');
assert.notEqual(firstSignature, secondSignature, 'index signature should change when artifact variants change');

console.log('workspace index signature sharded variants test passed');
