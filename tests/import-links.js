#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'import-links');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(path.join(repoRoot, 'src', 'a.js'), "import x from 'lib';\n");
await fsPromises.writeFile(path.join(repoRoot, 'src', 'b.js'), "const x = require('lib');\n");
await fsPromises.writeFile(path.join(repoRoot, 'src', 'c.js'), "import y from 'other';\n");

process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('import-links test failed: build_index failed');
  process.exit(buildResult.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const relationsPath = path.join(codeDir, 'file_relations.json');
if (!fs.existsSync(relationsPath)) {
  console.error('import-links test failed: file_relations.json missing');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(relationsPath, 'utf8'));
const map = new Map(raw.map((entry) => [entry.file, entry.relations]));
const relA = map.get('src/a.js');
const relB = map.get('src/b.js');

if (!relA || !Array.isArray(relA.importLinks)) {
  console.error('import-links test failed: missing importLinks for a.js');
  process.exit(1);
}
if (!relB || !Array.isArray(relB.importLinks)) {
  console.error('import-links test failed: missing importLinks for b.js');
  process.exit(1);
}

const expectedA = ['src/b.js'];
const expectedB = ['src/a.js'];
const sortLinks = (links) => (Array.isArray(links) ? links.slice().sort() : []);
if (JSON.stringify(sortLinks(relA.importLinks)) !== JSON.stringify(expectedA)) {
  console.error(`import-links test failed: a.js links ${JSON.stringify(relA.importLinks)} !== ${JSON.stringify(expectedA)}`);
  process.exit(1);
}
if (JSON.stringify(sortLinks(relB.importLinks)) !== JSON.stringify(expectedB)) {
  console.error(`import-links test failed: b.js links ${JSON.stringify(relB.importLinks)} !== ${JSON.stringify(expectedB)}`);
  process.exit(1);
}
if (relA.importLinks.includes('src/a.js')) {
  console.error('import-links test failed: a.js should not link to itself');
  process.exit(1);
}
if (relA.importLinks.includes('src/c.js')) {
  console.error('import-links test failed: a.js should not link to c.js');
  process.exit(1);
}

console.log('Import links test passed');
