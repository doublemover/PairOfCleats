#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  prepareImportResolutionFsMeta,
  resolveImportLinks
} from '../../../src/index/build/import-resolution.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-import-fsmeta-'));
const srcDir = path.join(tempRoot, 'src');
await fs.mkdir(srcDir, { recursive: true });
await fs.writeFile(path.join(srcDir, 'entry.js'), 'import "./dep.js";\nimport "external-lib";\n');
await fs.writeFile(path.join(srcDir, 'dep.js'), 'export const dep = 1;\n');

const entries = [
  { abs: path.join(srcDir, 'entry.js'), rel: 'src/entry.js' },
  { abs: path.join(srcDir, 'dep.js'), rel: 'src/dep.js' }
];
const importsByFile = {
  'src/entry.js': ['./dep.js', 'external-lib']
};
const normalizeGraph = (graph) => {
  if (!graph || typeof graph !== 'object') return graph;
  return { ...graph, generatedAt: null };
};
const makeRelations = () => new Map([
  ['src/entry.js', { imports: ['./dep.js', 'external-lib'] }]
]);

const baselineRelations = makeRelations();
const baseline = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: baselineRelations,
  enableGraph: true
});

const fsMeta = await prepareImportResolutionFsMeta({
  root: tempRoot,
  entries,
  importsByFile
});
assert.ok(fsMeta?.candidateCount > 0, 'expected preloaded fs metadata candidates');

const originalStat = fs.stat;
let activePrefetch = 0;
let peakPrefetch = 0;
fs.stat = async () => {
  activePrefetch += 1;
  peakPrefetch = Math.max(peakPrefetch, activePrefetch);
  await new Promise((resolve) => setTimeout(resolve, 2));
  activePrefetch -= 1;
  const missingError = new Error('missing');
  missingError.code = 'ENOENT';
  throw missingError;
};
try {
  const stressImportsByFile = Object.fromEntries(
    Array.from({ length: 160 }, (_, index) => [`pkg-${index}/nested/file-${index}.ts`, ['./dep.js']])
  );
  const stressMeta = await prepareImportResolutionFsMeta({
    root: tempRoot,
    importsByFile: stressImportsByFile
  });
  assert.ok(stressMeta?.candidateCount > 0, 'expected stress prefetch to scan candidates');
} finally {
  fs.stat = originalStat;
}
assert.ok(
  peakPrefetch <= 32,
  `expected bounded fs prefetch concurrency (<=32), received ${peakPrefetch}`
);

const asyncMemoRelations = makeRelations();
const asyncMemo = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: asyncMemoRelations,
  enableGraph: true,
  fsMeta
});

assert.deepEqual(asyncMemo.stats, baseline.stats, 'async fs metadata path should match sync stats');
assert.deepEqual(
  normalizeGraph(asyncMemo.graph),
  normalizeGraph(baseline.graph),
  'async fs metadata path should match sync graph output'
);
assert.deepEqual(
  Array.from(asyncMemoRelations.entries()),
  Array.from(baselineRelations.entries()),
  'async fs metadata path should preserve file relation outcomes'
);

const aliasDir = path.join(srcDir, 'alias');
await fs.mkdir(aliasDir, { recursive: true });
await fs.writeFile(path.join(aliasDir, 'main.ts'), "import '@alias/dep';\n");
await fs.writeFile(path.join(aliasDir, 'dep.ts'), 'export const dep = 1;\n');
await fs.writeFile(path.join(tempRoot, 'tsconfig.json'), JSON.stringify({
  compilerOptions: {
    baseUrl: '.',
    paths: {
      '@alias/*': ['src/alias/*']
    }
  }
}, null, 2));

const aliasEntries = [
  { abs: path.join(aliasDir, 'main.ts'), rel: 'src/alias/main.ts' },
  { abs: path.join(aliasDir, 'dep.ts'), rel: 'src/alias/dep.ts' }
];
const aliasImportsByFile = {
  'src/alias/main.ts': ['@alias/dep']
};
const buildAliasRelations = () => new Map([
  ['src/alias/main.ts', { imports: ['@alias/dep'] }]
]);
const baselineAliasRelations = buildAliasRelations();
resolveImportLinks({
  root: tempRoot,
  entries: aliasEntries,
  importsByFile: aliasImportsByFile,
  fileRelations: baselineAliasRelations,
  enableGraph: false
});
const tsconfigPath = path.resolve(path.join(tempRoot, 'tsconfig.json'));
const transientFsMeta = {
  existsByPath: {
    [tsconfigPath]: false
  },
  statByPath: {
    [tsconfigPath]: null
  },
  transientByPath: {
    [tsconfigPath]: true
  },
  candidateCount: 1
};
const transientAliasRelations = buildAliasRelations();
resolveImportLinks({
  root: tempRoot,
  entries: aliasEntries,
  importsByFile: aliasImportsByFile,
  fileRelations: transientAliasRelations,
  enableGraph: false,
  fsMeta: transientFsMeta
});
assert.deepEqual(
  transientAliasRelations.get('src/alias/main.ts')?.importLinks || [],
  baselineAliasRelations.get('src/alias/main.ts')?.importLinks || [],
  'transient prefetch failures should fall back to live fs checks'
);

console.log('async fs memo parity test passed');
