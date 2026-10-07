#!/usr/bin/env node
import { ensureFixtureIndex, loadFixtureIndexMeta } from '../../helpers/fixture-index.js';

const { fixtureRoot, userConfig } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture',
  cacheScope: 'shared',
  requiredModes: ['code']
});
const { chunkMeta, resolveChunkFile } = loadFixtureIndexMeta(fixtureRoot, userConfig);

const requiredFiles = [
  'src/Dockerfile',
  'src/Makefile',
  'src/BUILD',
  'src/WORKSPACE',
  'src/CMakeLists.txt',
  'src/defs.bzl',
  'src/scripts/common.sh',
  'tools/BUILD',
  'tools/defs.bzl'
];

const missing = requiredFiles.filter(
  (file) => !chunkMeta.some((chunk) => resolveChunkFile(chunk) === file)
);
if (missing.length) {
  console.error(`Missing buildfile chunks: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('Buildfile contract checks ok.');
