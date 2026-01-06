#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, getRepoCacheRoot, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'two-stage-state');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({
    indexing: {
      twoStage: {
        enabled: true,
        stage2: {
          embeddings: { enabled: false, mode: 'off' }
        }
      },
      treeSitter: { enabled: false }
    }
  }, null, 2)
);
await fsPromises.writeFile(path.join(repoRoot, 'alpha.js'), 'const alpha = 1;\n');

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const runBuild = (label, args) => {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

runBuild('stage1', [path.join(root, 'build_index.js'), '--stub-embeddings', '--stage', 'stage1', '--repo', repoRoot]);

process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const statePath = path.join(codeDir, 'index_state.json');
if (!fs.existsSync(statePath)) {
  console.error('Missing index_state.json after stage1');
  process.exit(1);
}
const stateStage1 = JSON.parse(await fsPromises.readFile(statePath, 'utf8'));
if (stateStage1.stage !== 'stage1' || stateStage1.enrichment?.pending !== true) {
  console.error('Expected stage1 index_state to show pending enrichment');
  process.exit(1);
}
const relationsPath = path.join(codeDir, 'file_relations.json');
if (fs.existsSync(relationsPath)) {
  console.error('Did not expect file_relations.json after stage1');
  process.exit(1);
}

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const enrichmentPath = path.join(repoCacheRoot, 'enrichment_state.json');
const enrichmentStage1 = JSON.parse(await fsPromises.readFile(enrichmentPath, 'utf8'));
if (enrichmentStage1.status !== 'pending') {
  console.error('Expected enrichment_state pending after stage1');
  process.exit(1);
}

runBuild('stage2', [path.join(root, 'build_index.js'), '--stub-embeddings', '--stage', 'stage2', '--repo', repoRoot]);

const stateStage2 = JSON.parse(await fsPromises.readFile(statePath, 'utf8'));
if (stateStage2.stage !== 'stage2' || stateStage2.enrichment?.pending === true) {
  console.error('Expected stage2 index_state to clear pending enrichment');
  process.exit(1);
}
if (!fs.existsSync(relationsPath)) {
  console.error('Expected file_relations.json after stage2');
  process.exit(1);
}
const enrichmentStage2 = JSON.parse(await fsPromises.readFile(enrichmentPath, 'utf8'));
if (enrichmentStage2.status !== 'done') {
  console.error('Expected enrichment_state done after stage2');
  process.exit(1);
}

runBuild('stage3', [path.join(root, 'build_index.js'), '--stub-embeddings', '--stage', 'stage3', '--repo', repoRoot]);

const stateStage3 = JSON.parse(await fsPromises.readFile(statePath, 'utf8'));
if (stateStage3.embeddings?.ready !== true) {
  console.error('Expected stage3 to mark embeddings ready');
  process.exit(1);
}
const densePath = path.join(codeDir, 'dense_vectors_uint8.json');
if (!fs.existsSync(densePath)) {
  console.error('Expected dense_vectors_uint8.json after stage3');
  process.exit(1);
}

console.log('two-stage state test passed');
