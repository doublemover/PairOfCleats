#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createImportBuildContext } from '../../../src/index/build/import-resolution.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-build-context-typescript-emit');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src', 'generated'), { recursive: true });
await fs.writeFile(
  path.join(tempRoot, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      rootDir: './src',
      outDir: './dist',
      declarationDir: './types'
    }
  }, null, 2),
  'utf8'
);
await fs.writeFile(path.join(tempRoot, 'src', 'main.ts'), "import '../dist/generated/api.js';\n", 'utf8');
await fs.writeFile(path.join(tempRoot, 'src', 'generated', 'api.ts'), 'export const api = true;\n', 'utf8');

const entries = [
  { rel: 'tsconfig.json' },
  { rel: 'src/main.ts' },
  { rel: 'src/generated/api.ts' }
];

const buildContext = createImportBuildContext({
  entries,
  rootAbs: tempRoot
});

const jsEmitMissing = buildContext.classifyUnresolved({
  importerRel: 'src/main.ts',
  spec: '../dist/generated/api.js',
  rawSpec: '../dist/generated/api.js'
});
assert.equal(jsEmitMissing?.reasonCode, 'IMP_U_GENERATED_EXPECTED_MISSING');
assert.equal(jsEmitMissing?.pluginId, 'typescript-emit');
assert.equal(jsEmitMissing?.generatedMatch?.matchType, 'typescript_emit');
assert.equal(jsEmitMissing?.generatedMatch?.sourcePath, 'src/generated/api.ts');

const dtsEmitMissing = buildContext.classifyUnresolved({
  importerRel: 'src/main.ts',
  spec: '../types/generated/api.d.ts',
  rawSpec: '../types/generated/api.d.ts'
});
assert.equal(dtsEmitMissing?.reasonCode, 'IMP_U_GENERATED_EXPECTED_MISSING');
assert.equal(dtsEmitMissing?.pluginId, 'typescript-emit');
assert.equal(dtsEmitMissing?.generatedMatch?.sourcePath, 'src/generated/api.ts');

const nonEmit = buildContext.classifyUnresolved({
  importerRel: 'src/main.ts',
  spec: '../dist/runtime/other.js',
  rawSpec: '../dist/runtime/other.js'
});
assert.equal(nonEmit, null);

console.log('import build-context typescript emit tests passed');
