#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { collectLanguageImportEntries, buildLanguageContext } from '../../../src/index/language-registry.js';
import { buildCssRelations, prepareCssChunkContext, resolveCssPreparedChunks } from '../../../src/lang/css.js';
import { getNativeTreeSitterParser } from '../../../src/lang/tree-sitter/native-runtime.js';
import { scanImports } from '../../../src/index/build/imports.js';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { readCachedImports, writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { sha1 } from '../../../src/shared/hash.js';
import { createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const root = await createImportResolutionTempRoot('css-import-registry-replay');
const relKey = 'style.css', filePath = path.join(root, relKey);
const source = '/* @import "./ghost.css"; */\r\n@import url( "./real.css" );\n@import "thing,"; @import "thing";\n'
  + '.notice::before { content: "@import url(./fake.css) }"; }';
const expected = ['./real.css', 'thing', 'thing,'];
try {
  assert.ok(getNativeTreeSitterParser('css', {}), 'prepared native CSS route is required, not silently skipped');
  for (const enabled of [true, false]) {
    const options = { treeSitter: { enabled }, ext: '.css' };
    const { lang, context } = await buildLanguageContext({ ext: '.css', relPath: relKey, mode: 'code', text: source, options });
    const entries = collectLanguageImportEntries({ ext: '.css', relPath: relKey, text: source, mode: 'code',
      options: { ...options, cssSourceFacts: context.cssSourceFacts } });
    assert.deepEqual(entries.map(entry => entry.specifier), expected);
    assert.ok(entries.every(entry => entry.provenance === 'parsed-literal'));
    assert.equal(entries.coverage.state, 'complete');
    const relations = lang.buildRelations({ text: source, context, options });
    assert.deepEqual([...relations.imports].sort(), expected);
    assert.equal(relations.cssImportOccurrences, context.cssSourceFacts.imports, 'relation construction shares token facts');
    assert.equal(relations.cssImportCoverage, context.cssSourceFacts.coverage);
    assert.equal(resolveCssPreparedChunks(source, context, options), context.cssChunks);
    assert.ok(!relations.imports.includes('./ghost.css') && !relations.imports.includes('./fake.css'));
  }
  const empty = prepareCssChunkContext('@import "./real.css";', { treeSitter: { enabled: false } });
  assert.equal(empty.cssChunks, null);
  assert.equal(resolveCssPreparedChunks('@import "./real.css";', empty, { treeSitter: { enabled: false } }), null,
    'prepared null does not trigger another native parse');
  const changed = '.replacement { color: green; }';
  assert.equal(resolveCssPreparedChunks(changed, empty, { treeSitter: { enabled: false } })[0].name, '.replacement');
  assert.deepEqual(buildCssRelations(source).imports.sort(), expected);
  for (const [file, content] of [[relKey, source], ['real.css', 'a {}'], ['ghost.css', 'b {}'], ['fake.css', 'c {}']]) {
    await fs.writeFile(path.join(root, file), content);
  }
  const stat = await fs.stat(filePath);
  const runScan = languageOptions => scanImports({ files: [{ abs: filePath, rel: relKey, stat }], root, mode: 'code',
    languageOptions, importConcurrency: 1 });
  const scan = await runScan({ treeSitter: { enabled: false } });
  assert.deepEqual(scan.importsByFile[relKey], expected);
  assert.equal(scan.importCoverageByFile[relKey].state, 'complete');
  const fileRelations = new Map([[relKey, { imports: scan.importsByFile[relKey] }]]);
  const result = resolveImportLinks({ root, entries: [relKey, 'real.css', 'ghost.css', 'fake.css'].map(rel => ({ rel, abs: path.join(root, rel) })),
    importsByFile: scan.importsByFile, fileRelations, enableGraph: true });
  assert.deepEqual(fileRelations.get(relKey).importLinks, ['real.css']);
  assert.ok(!result.graph.edges.some(edge => ['ghost.css', 'fake.css'].includes(edge.resolvedPath)));

  const bundleDir = path.join(root, 'bundles'); await fs.mkdir(bundleDir);
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
  const writeBundle = async coverage => {
    manifest.files[relKey] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey, fileStat: stat,
      fileHash: sha1(source), fileChunks: [], bundleFormat: 'json',
      fileRelations: { imports: scan.importsByFile[relKey], cssImportCoverage: coverage, importScanFingerprint: scan.importScanFingerprint } });
  };
  const readBundle = () => readCachedImports({ enabled: true, absPath: filePath, relKey, fileStat: stat, manifest,
    bundleDir, bundleFormat: 'json', expectedImportScanFingerprint: scan.importScanFingerprint });
  await writeBundle(scan.importCoverageByFile[relKey]);
  assert.deepEqual(await readBundle(), expected, 'real bundle round trip preserves distinct literal identities');
  const partial = await runScan({ collectorScanBudget: { maxChars: 20 } });
  assert.equal(partial.importCoverageByFile[relKey].state, 'partial');
  await writeBundle(partial.importCoverageByFile[relKey]);
  assert.equal(await readBundle(), null, 'partial evidence cannot qualify as a complete warm scan');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('CSS import registry replay test passed');
