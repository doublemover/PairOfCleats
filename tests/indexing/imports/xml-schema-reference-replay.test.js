#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { collectLanguageImportEntries, getLanguageForFile } from '../../../src/index/language-registry.js';
import { scanImports } from '../../../src/index/build/imports.js';
import { postScanImports } from '../../../src/index/build/indexer/steps/relations/import-scan.js';
import { readCachedImports, writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { sha1 } from '../../../src/shared/hash.js';

applyTestEnv();
const root = await createImportResolutionTempRoot('xml-schema-reference-replay');
const relKey = 'config.xml', absPath = path.join(root, relKey);
const source = '<root s:schemaLocation="urn:one ./schema.xsd urn:two ./other.xsd" '
  + 'xmlns:s="http://www.w3.org/2001/XMLSchema-instance"/>';
try {
  await fs.writeFile(absPath, source);
  await fs.writeFile(path.join(root, 'schema.xsd'), '<schema/>');
  await fs.writeFile(path.join(root, 'other.xsd'), '<schema/>');
  const entries = [relKey, 'schema.xsd', 'other.xsd'].map(rel => ({ rel, abs: path.join(root, rel) }));
  const registry = collectLanguageImportEntries({ text: source, ext: '.xml', relPath: relKey, mode: 'code' });
  assert.deepEqual(registry.map(entry => entry.specifier), ['./other.xsd', './schema.xsd']);
  assert.equal(registry.coverage.state, 'complete');
  assert.deepEqual(registry.occurrences.map(entry => entry.targetNamespace), ['urn:one', 'urn:two']);
  const adapter = getLanguageForFile('.xml', relKey);
  const relation = adapter.buildRelations({ text: source, options: {} });
  assert.equal(relation.xmlImportOccurrences[0].role, 'xsi-schema-location-pair');
  const stat = await fs.stat(absPath);
  const scan = options => scanImports({ files: [{ abs: absPath, rel: relKey, stat }], root, mode: 'code',
    languageOptions: options || {}, importConcurrency: 1 });
  const result = await scan();
  const state = { fileRelations: new Map([[relKey, relation]]), importResolutionGraph: null };
  const post = input => postScanImports({ mode: 'code', relationsEnabled: true,
    scanPlan: { importScanMode: 'pre', enableImportLinks: true, shouldScan: true, importGraphEnabled: true },
    state, timing: {}, runtime: { root, toolInfo: { version: 'test' }, indexingConfig: { importResolution: {} } },
    entries, importResult: input, incrementalState: null, fileTextByFile: null, hangProbeConfig: null, abortSignal: null });
  await post(result);
  const published = state.fileRelations.get(relKey);
  assert.deepEqual(published.importLinks, ['other.xsd', 'schema.xsd']);
  assert.equal(published.importScanCoverage.state, 'complete');
  assert.equal(published.importScanFingerprint, result.importScanFingerprint);
  const graph = JSON.parse(JSON.stringify(state.importResolutionGraph));
  assert.deepEqual(graph.edges.map(edge => edge.to).sort(), ['file:other.xsd', 'file:schema.xsd']);
  assert.ok(!graph.nodes.some(node => node.id.includes('urn:one') || node.id.includes('urn:two')));
  assert.ok(graph.nodes.some(node => node.id === 'file:schema.xsd'), 'named file graph consumer sees only the schema location');
  const bundleDir = path.join(root, 'bundle'); await fs.mkdir(bundleDir);
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
  const write = async () => {
    manifest.files[relKey] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey, fileStat: stat,
      fileHash: sha1(source), fileChunks: [], bundleFormat: 'json', fileRelations: state.fileRelations.get(relKey) });
  };
  const read = fingerprint => readCachedImports({ enabled: true, absPath, relKey, fileStat: stat, manifest, bundleDir,
    bundleFormat: 'json', expectedImportScanFingerprint: fingerprint });
  await write();
  assert.deepEqual(await read(result.importScanFingerprint), ['./other.xsd', './schema.xsd']);
  const partial = await scan({ collectorScanBudget: { maxTokens: 1, maxMs: 0 } });
  await post(partial);
  assert.equal(state.fileRelations.get(relKey).importScanCoverage.state, 'partial');
  assert.equal(state.fileRelations.get(relKey).importScanFingerprint, null, 'partial scan cannot publish a full replay witness');
  await write();
  assert.equal(await read(null), null, 'partial receipts reject reuse even without an expected fingerprint');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('XML schema reference graph and replay test passed');
