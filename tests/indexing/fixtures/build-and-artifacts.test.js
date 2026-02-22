#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ensureFixtureIndex, ensureFixtureSqlite, loadFixtureMetricsDir } from '../../helpers/fixture-index.js';

const { fixtureRoot, env, userConfig, codeDir, proseDir } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'fixture-sample',
  cacheScope: 'shared'
});

const sqlitePaths = await ensureFixtureSqlite({ fixtureRoot, userConfig, env });
const metricsDir = loadFixtureMetricsDir(fixtureRoot, userConfig);

const requiredFiles = [
  path.join(codeDir, 'chunk_meta.json'),
  path.join(codeDir, 'token_postings.json'),
  path.join(codeDir, 'repo_map.json'),
  path.join(proseDir, 'chunk_meta.json'),
  path.join(proseDir, 'token_postings.json'),
  path.join(proseDir, 'repo_map.json'),
  path.join(metricsDir, 'index-code.json'),
  path.join(metricsDir, 'index-prose.json'),
  sqlitePaths.codePath,
  sqlitePaths.prosePath
];

const missing = requiredFiles.filter((filePath) => !fs.existsSync(filePath));
if (missing.length) {
  console.error(`Missing fixture artifacts: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('Fixture build artifacts ok.');
