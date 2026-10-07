#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';

applyTestEnv();

const cmake = LANGUAGE_REGISTRY.find((entry) => entry.id === 'cmake');
assert.ok(cmake, 'expected cmake language registry entry');

const cmakeSource = [
  'include(core/module.cmake)',
  'add_subdirectory(src/tools)',
  'find_package(OpenSSL REQUIRED)'
].join('\n');

const collected = cmake.collectImports(cmakeSource) || [];
const relations = cmake.buildRelations({ text: cmakeSource }) || {};

assert.ok(Array.isArray(relations.imports), 'expected simple-language relations to expose imports');
assert.deepEqual(
  relations.imports.slice().sort(),
  Array.from(new Set(collected)).sort(),
  'expected simple-language relation imports to match collector output'
);

const starlark = LANGUAGE_REGISTRY.find((entry) => entry.id === 'starlark');
assert.ok(starlark, 'expected starlark language registry entry');
const starlarkSource = 'load("//tools:defs.bzl", "macro")\n';
const starlarkRelations = starlark.buildRelations({ text: starlarkSource }) || {};
assert.equal(starlarkRelations.imports.includes('//tools:defs.bzl'), true);

// The shared positive fixture must contain its local import targets. Missing
// targets here otherwise become actionable SLO failures after repeated builds.
const fixtureRoot = path.join(process.cwd(), 'tests', 'fixtures', 'languages');
const fixtureConfig = JSON.parse(await fs.readFile(path.join(fixtureRoot, '.pairofcleats.json'), 'utf8'));
const { ignoreMatcher } = await buildIgnoreMatcher({ root: fixtureRoot, userConfig: fixtureConfig });
const fixtureFiles = await fs.readdir(fixtureRoot, { recursive: true, withFileTypes: true });
const fixtureEntries = fixtureFiles.filter((entry) => entry.isFile()).map((entry) => {
  const abs = path.join(entry.parentPath, entry.name);
  return { abs, rel: path.relative(fixtureRoot, abs).replace(/\\/g, '/') };
}).filter((entry) => !ignoreMatcher.ignores(entry.rel));
const fixtureCases = [
  { language: 'starlark', importer: 'src/BUILD', specifier: '//tools:defs.bzl', target: 'tools/defs.bzl' },
  { language: 'shell', importer: 'src/shell_advanced.sh', specifier: './scripts/common.sh', target: 'src/scripts/common.sh' }
];
const fixtureImports = {};
for (const { language, importer, specifier } of fixtureCases) {
  const adapter = LANGUAGE_REGISTRY.find((entry) => entry.id === language);
  assert.ok(adapter, `expected ${language} language registry entry`);
  const text = await fs.readFile(path.join(fixtureRoot, importer), 'utf8');
  fixtureImports[importer] = adapter.collectImports(text);
  assert.deepEqual(fixtureImports[importer], [specifier], `expected ${importer} to retain its local import`);
}
for (const { importer, target } of fixtureCases) {
  assert.ok(fixtureEntries.some((entry) => entry.rel === target), `expected ${importer} target to exist`);
}
const fixtureRelations = new Map(
  Object.entries(fixtureImports).map(([importer, imports]) => [importer, { imports }])
);
const fixtureResolution = resolveImportLinks({
  root: fixtureRoot,
  entries: fixtureEntries,
  importsByFile: fixtureImports,
  fileRelations: fixtureRelations,
  enableGraph: true
});
assert.deepEqual(
  fixtureRelations.get('src/shell_advanced.sh')?.importLinks,
  ['src/scripts/common.sh'],
  'expected the shell fixture import to resolve'
);
assert.equal(fixtureResolution.stats.resolved, 1);
assert.equal(fixtureResolution.stats.unresolvedActionable, 0, 'expected no missing local fixture imports');
// Existing product gap: classifyImporter does not treat extensionless BUILD as
// path-like. The Bazel adapter sees the existing target but reports a suppressed
// resolver gap. Keep that gap visible; this fixture repair does not fix it.
assert.deepEqual(
  fixtureResolution.unresolvedSamples.map(({ importer, reasonCode, disposition }) => ({
    importer, reasonCode, disposition
  })),
  [{ importer: 'src/BUILD', reasonCode: 'IMP_U_RESOLVER_GAP', disposition: 'suppress_gate' }]
);
const bazelTrace = fixtureResolution.unresolvedSamples[0].resolverTrace.find(
  (entry) => entry.adapter === 'bazel-label' && entry.details?.targetExists === true
);
assert.equal(bazelTrace?.details?.packageExists, true, 'expected the Bazel package and target to exist');

console.log('simple-language relations contract test passed');
