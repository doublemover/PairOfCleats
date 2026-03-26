#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

const removedPaths = [
  'src/retrieval/cli/run-search.js',
  'src/shared/dispatch/manifest.js',
  'tools/shared/search-request.js'
];

const allowedReferenceFiles = new Set([
  'tests/shared/h33-hard-cutover-boundaries.test.js',
  'tests/tooling/shared-module-migration.test.js'
]);

for (const relPath of removedPaths) {
  try {
    await fs.access(path.join(root, relPath));
    assert.fail(`expected removed hard-cutover path to stay deleted: ${relPath}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const scanRoots = ['src', 'tools', 'bin', 'extensions', 'sublime', 'tests', 'docs'];
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.json', '.md']);

const listFilesRecursive = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules'
        || entry.name === '.git'
        || entry.name === '.testLogs'
        || entry.name === '.cache'
        || fullPath === path.join(root, 'docs', 'archived')
        || fullPath === path.join(root, 'docs', 'tooling')
      ) {
        continue;
      }
      files.push(...await listFilesRecursive(fullPath));
      continue;
    }
    if (sourceExtensions.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
};

for (const relativeRoot of scanRoots) {
  const absoluteRoot = path.join(root, relativeRoot);
  let files = [];
  try {
    files = await listFilesRecursive(absoluteRoot);
  } catch {
    continue;
  }
  for (const filePath of files) {
    const contents = await fs.readFile(filePath, 'utf8');
    const relPath = path.relative(root, filePath).replace(/\\/g, '/');
    if (allowedReferenceFiles.has(relPath)) continue;
    for (const removedPath of removedPaths) {
      assert.equal(
        contents.includes(removedPath),
        false,
        `expected live code to stay off removed hard-cutover path ${removedPath} (${relPath})`
      );
    }
  }
}

console.log('H33 hard cutover boundary test passed');
