#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../../../src/shared/hash.js';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { loadImportResolutionCache, saveImportResolutionCache } from '../../../src/index/build/import-resolution-cache.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-resolution-build-context-cache-key');
const srcRoot = path.join(tempRoot, 'src');
const incrementalDir = path.join(tempRoot, '.incremental');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });
await fs.mkdir(incrementalDir, { recursive: true });

const fileHashes = new Map();
const writeFile = async (rel, content) => {
  const abs = path.join(tempRoot, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
  fileHashes.set(rel.replace(/\\/g, '/'), sha1(content));
};

await writeFile('src/main.ts', "import './code-output/client.codegen.ts';\n");
await writeFile('package.json', '{"name":"import-resolution-build-context-cache-key"}\n');

const entries = [
  { abs: path.join(srcRoot, 'main.ts'), rel: 'src/main.ts' }
];
const importsByFile = {
  'src/main.ts': ['./code-output/client.codegen.ts']
};

const incrementalState = {
  enabled: true,
  incrementalDir,
  manifest: {
    files: Object.fromEntries(Array.from(fileHashes.entries()).map(([rel, hash]) => [rel, { hash }]))
  }
};

const runWithPlugins = async (resolverPlugins) => {
  const { cache, cachePath } = await loadImportResolutionCache({ incrementalState });
  const logLines = [];
  const relations = new Map([
    ['src/main.ts', { imports: importsByFile['src/main.ts'].slice() }]
  ]);
  const result = resolveImportLinks({
    root: tempRoot,
    entries,
    importsByFile,
    fileRelations: relations,
    enableGraph: false,
    cache,
    fileHashes,
    log: (line) => {
      if (typeof line === 'string' && line.trim()) logLines.push(line.trim());
    },
    resolverPlugins
  });
  await saveImportResolutionCache({ cache, cachePath });
  return { ...result, logLines };
};

const generatedPluginConfig = {
  buildContext: {
    generatedArtifactsConfig: {
      suffixes: ['.codegen.ts']
    }
  }
};

const first = await runWithPlugins(generatedPluginConfig);
assert.equal(first?.cacheStats?.filesReused || 0, 0);
assert.equal(first?.unresolvedSamples?.[0]?.reasonCode, 'IMP_U_GENERATED_EXPECTED_MISSING');

const second = await runWithPlugins(generatedPluginConfig);
assert.equal((second?.cacheStats?.filesReused || 0) > 0, true, 'expected cache reuse with unchanged build-context config');
assert.equal(second?.unresolvedSamples?.[0]?.reasonCode, 'IMP_U_GENERATED_EXPECTED_MISSING');

const third = await runWithPlugins(null);
assert.equal((third?.cacheStats?.filesReused || 0), 0, 'expected no file-cache reuse after build-context config change');
assert.equal(
  third?.logLines?.some((line) => line.includes('cache invalidated: cache key changed')) || false,
  true,
  'expected cache-key invalidation log when build-context config changes'
);
assert.equal(third?.unresolvedSamples?.[0]?.reasonCode, 'IMP_U_MISSING_FILE_RELATIVE');

console.log('import resolution build-context cache-key tests passed');
