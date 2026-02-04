#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../helpers/test-env.js';
import { getIndexDir, resolveRepoConfig } from '../../tools/shared/dict-utils.js';
import { buildCodeMap } from '../../src/map/build-map.js';
import { writeMapJsonStream } from '../../src/map/build-map/io.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'map-build-streaming');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'alpha.js'),
  'export function alpha() { return 1; }\n'
);
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'beta.js'),
  'import { alpha } from "./alpha.js";\n' +
    'export function beta() { return alpha(); }\n'
);

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' }
    }
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (buildResult.status !== 0) {
  console.error('Failed: build index for map build streaming test');
  process.exit(buildResult.status ?? 1);
}

const { userConfig } = resolveRepoConfig(repoRoot);
const indexDir = getIndexDir(repoRoot, 'code', userConfig, {});
const mapModel = await buildCodeMap({ repoRoot, indexDir, options: { mode: 'code' } });

const outPath = path.join(tempRoot, 'map-stream.json');
await writeMapJsonStream({
  filePath: outPath,
  mapBase: (() => {
    const base = { ...mapModel };
    delete base.nodes;
    delete base.edges;
    return base;
  })(),
  nodes: mapModel.nodes || [],
  edges: mapModel.edges || []
});

const streamed = JSON.parse(await fsPromises.readFile(outPath, 'utf8'));
assert.deepEqual(streamed, mapModel, 'streamed map should match in-memory model');

console.log('map build streaming test passed');
