#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { getIndexDir, loadUserConfig } from '../../../../tools/shared/dict-utils.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'formats');
const cacheRoot = path.join(root, '.testCache', 'format-fidelity');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const env = applyTestEnv({
  testing: '1',
  cacheRoot,
  embeddings: 'stub'
});

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
const loadFileMap = (dir) => {
  const metaPath = path.join(dir, 'file_meta.json');
  if (!fs.existsSync(metaPath)) return new Map();
  const entries = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  return new Map(
    (Array.isArray(entries) ? entries : []).map((entry) => [entry.id, entry.file])
  );
};
const codeFileById = loadFileMap(codeDir);
const proseFileById = loadFileMap(proseDir);

function findChunk(meta, match, fileById) {
  return meta.find((chunk) => {
    const file = chunk?.file || fileById.get(chunk?.fileId) || null;
    if (!chunk || !file) return false;
    if (match.file && file !== match.file) return false;
    if (match.kind && chunk.kind !== match.kind) return false;
    if (match.nameIncludes && !String(chunk.name || '').includes(match.nameIncludes)) return false;
    if (match.sigIncludes && !String(chunk?.docmeta?.signature || '').includes(match.sigIncludes)) return false;
    return true;
  });
}

const failures = [];

if (!findChunk(codeMeta, { file: 'src/config.json', nameIncludes: 'database' }, codeFileById)) {
  failures.push('Missing JSON chunk for database.');
}
if (!findChunk(codeMeta, { file: 'src/config.toml', nameIncludes: 'host' }, codeFileById)) {
  failures.push('Missing TOML chunk for host.');
}
if (!findChunk(codeMeta, { file: 'src/config.ini', nameIncludes: 'server' }, codeFileById)) {
  failures.push('Missing INI chunk for server.');
}
if (!findChunk(codeMeta, { file: 'src/config.xml', nameIncludes: 'database' }, codeFileById)) {
  failures.push('Missing XML chunk for database.');
}
if (!findChunk(codeMeta, { file: 'src/Dockerfile', nameIncludes: 'FROM' }, codeFileById)) {
  failures.push('Missing Dockerfile chunk for FROM.');
}
if (!findChunk(codeMeta, { file: 'src/Makefile', nameIncludes: 'build' }, codeFileById)) {
  failures.push('Missing Makefile chunk for build target.');
}
if (!findChunk(codeMeta, { file: 'src/config.yaml', nameIncludes: 'database' }, codeFileById)) {
  failures.push('Missing YAML chunk for database.');
}
if (!findChunk(codeMeta, { file: '.github/workflows/ci.yml', nameIncludes: 'build' }, codeFileById)) {
  failures.push('Missing GitHub Actions chunk for build job.');
}
if (!findChunk(codeMeta, { file: 'src/unknown.html', kind: 'ElementDeclaration', nameIncludes: 'html' }, codeFileById)) {
  failures.push('Missing HTML element chunk for unknown.html.');
}
if (!findChunk(codeMeta, { file: 'src/unknown.html', kind: 'ScriptElement', sigIncludes: 'application/json' }, codeFileById)) {
  failures.push('Missing embedded JSON chunk for unknown.html.');
}
if (!findChunk(codeMeta, { file: 'src/unknown.html', kind: 'ElementDeclaration', sigIncludes: 'language-toml' }, codeFileById)) {
  failures.push('Missing embedded TOML chunk for unknown.html.');
}
if (!findChunk(codeMeta, { file: 'src/unknown.html', kind: 'ElementDeclaration', sigIncludes: 'language-ini' }, codeFileById)) {
  failures.push('Missing embedded INI chunk for unknown.html.');
}
if (!findChunk(codeMeta, { file: 'src/unknown.html', kind: 'ElementDeclaration', sigIncludes: 'language-markdown' }, codeFileById)) {
  failures.push('Missing embedded Markdown chunk for unknown.html.');
}
if (!findChunk(codeMeta, { file: 'src/styles.css', kind: 'RuleSet', nameIncludes: '.page-header' }, codeFileById)) {
  failures.push('Missing CSS chunk for styles.css.');
}

if (!findChunk(proseMeta, { file: 'docs/guide.rst', nameIncludes: 'Guide' }, proseFileById)) {
  failures.push('Missing RST chunk for Guide.');
}
if (!findChunk(proseMeta, { file: 'docs/manual.adoc', nameIncludes: 'Manual' }, proseFileById)) {
  failures.push('Missing AsciiDoc chunk for Manual.');
}

if (failures.length) {
  failures.forEach((msg) => console.error(msg));
  process.exit(1);
}

console.log('format fidelity test passed');

