#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanImports } from '../../../src/index/build/imports.js';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-scan-non-js-end-to-end');
await fs.rm(tempRoot, { recursive: true, force: true });

const write = async (relPath, content = '') => {
  const absPath = path.join(tempRoot, relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, 'utf8');
};

await write('cmake/main.cmake', 'include(modules/common.cmake)\n');
await write('cmake/modules/common.cmake', '# helper\n');
await write('nix/flake.nix', 'imports = [ ./modules ];\n');
await write('nix/modules/default.nix', '{ }:\n{ }\n');

const relFiles = [
  'cmake/main.cmake',
  'cmake/modules/common.cmake',
  'nix/flake.nix',
  'nix/modules/default.nix'
];

const files = [];
const entries = [];
for (const rel of relFiles) {
  const abs = path.join(tempRoot, rel);
  const stat = await fs.stat(abs);
  files.push({ abs, rel, stat });
  entries.push({ abs, rel });
}

const scanResult = await scanImports({
  files,
  root: tempRoot,
  mode: 'code',
  languageOptions: {},
  importConcurrency: 1
});

const importsByFile = scanResult.importsByFile || {};
assert.deepEqual(importsByFile['cmake/main.cmake'] || [], ['modules/common.cmake']);
assert.deepEqual(importsByFile['nix/flake.nix'] || [], ['./modules']);

const relations = new Map(
  Object.entries(importsByFile).map(([file, imports]) => [file, { imports: imports.slice() }])
);
const resolution = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: relations,
  enableGraph: true
});

assert.deepEqual(relations.get('cmake/main.cmake')?.importLinks || [], ['cmake/modules/common.cmake']);
assert.deepEqual(relations.get('nix/flake.nix')?.importLinks || [], ['nix/modules/default.nix']);
assert.equal((resolution?.graph?.warnings || []).length, 0, 'expected no unresolved warnings');

console.log('import scan non-js end-to-end test passed');

