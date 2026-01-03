#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'formats');
const cacheRoot = path.join(root, 'tests', '.cache', 'format-fidelity');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const result = spawnSync(process.execPath, [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', fixtureRoot], {
  cwd: fixtureRoot,
  env,
  stdio: 'inherit'
});
if (result.status !== 0) {
  console.error('Failed to build format fixture index.');
  process.exit(result.status ?? 1);
}

const userConfig = loadUserConfig(fixtureRoot);
const codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
const proseDir = getIndexDir(fixtureRoot, 'prose', userConfig);
const codeMeta = JSON.parse(fs.readFileSync(path.join(codeDir, 'chunk_meta.json'), 'utf8'));
const proseMeta = JSON.parse(fs.readFileSync(path.join(proseDir, 'chunk_meta.json'), 'utf8'));

function findChunk(meta, match) {
  return meta.find((chunk) => {
    if (!chunk || !chunk.file) return false;
    if (match.file && chunk.file !== match.file) return false;
    if (match.kind && chunk.kind !== match.kind) return false;
    if (match.nameIncludes && !String(chunk.name || '').includes(match.nameIncludes)) return false;
    return true;
  });
}

const failures = [];

if (!findChunk(codeMeta, { file: 'src/config.json', nameIncludes: 'database' })) {
  failures.push('Missing JSON chunk for database.');
}
if (!findChunk(codeMeta, { file: 'src/config.toml', nameIncludes: 'database' })) {
  failures.push('Missing TOML chunk for database.');
}
if (!findChunk(codeMeta, { file: 'src/config.ini', nameIncludes: 'server' })) {
  failures.push('Missing INI chunk for server.');
}
if (!findChunk(codeMeta, { file: 'src/config.xml', nameIncludes: 'database' })) {
  failures.push('Missing XML chunk for database.');
}
if (!findChunk(codeMeta, { file: 'src/Dockerfile', nameIncludes: 'FROM' })) {
  failures.push('Missing Dockerfile chunk for FROM.');
}
if (!findChunk(codeMeta, { file: 'src/Makefile', nameIncludes: 'build' })) {
  failures.push('Missing Makefile chunk for build target.');
}
if (!findChunk(codeMeta, { file: 'src/config.yaml', nameIncludes: 'database' })) {
  failures.push('Missing YAML chunk for database.');
}
if (!findChunk(codeMeta, { file: '.github/workflows/ci.yml', nameIncludes: 'build' })) {
  failures.push('Missing GitHub Actions chunk for build job.');
}
if (!findChunk(codeMeta, { file: 'src/unknown.html', kind: 'ElementDeclaration', nameIncludes: 'html' })) {
  failures.push('Missing HTML element chunk for unknown.html.');
}
if (!findChunk(codeMeta, { file: 'src/styles.css', kind: 'StyleRule', nameIncludes: '.page-header' })) {
  failures.push('Missing CSS chunk for styles.css.');
}

if (!findChunk(proseMeta, { file: 'docs/guide.rst', nameIncludes: 'Guide' })) {
  failures.push('Missing RST chunk for Guide.');
}
if (!findChunk(proseMeta, { file: 'docs/manual.adoc', nameIncludes: 'Manual' })) {
  failures.push('Missing AsciiDoc chunk for Manual.');
}

if (failures.length) {
  failures.forEach((msg) => console.error(msg));
  process.exit(1);
}

console.log('format fidelity test passed');
