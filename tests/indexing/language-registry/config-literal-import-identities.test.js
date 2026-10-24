#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLanguageImportEntries, getLanguageForFile } from '../../../src/index/language-registry.js';
import { collectJsonImports } from '../../../src/index/language-registry/import-collectors/json.js';
import { collectTomlImports } from '../../../src/index/language-registry/import-collectors/toml.js';
import { collectXmlImports } from '../../../src/index/language-registry/import-collectors/xml.js';
import { collectYamlImports } from '../../../src/index/language-registry/import-collectors/yaml.js';
import { addCollectorImport } from '../../../src/index/language-registry/import-collectors/utils.js';
import { scanImports } from '../../../src/index/build/imports.js';
import { readCachedImports, writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';
import { sha1 } from '../../../src/shared/hash.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const values = ['thing,', 'thing', 'thing;', 'thing)', '"thing"', ' thing ', 'namespace:thing'];
const expected = [...values].sort();
const array = values.map(value => JSON.stringify(value)).join(', ');
const cases = [
  { ext: '.json', source: JSON.stringify({ includes: values }), collect: collectJsonImports },
  { ext: '.jsonc', source: `{ // actual JSONC owner\n "includes": [${array},],\n}`, collect: collectJsonImports },
  { ext: '.yaml', source: `include:\n${values.map(value => `  - ${JSON.stringify(value)}`).join('\n')}\n`, collect: collectYamlImports },
  { ext: '.toml', source: `include = [${array}]\n`, collect: collectTomlImports },
  { ext: '.xml', source: `<root>${values.map(value => `<include href='${value}'/>`).join('')}</root>`, collect: collectXmlImports }
];
const root = await createImportResolutionTempRoot('config-literal-import-identities');
try {
  for (const test of cases) {
    const relKey = `config${test.ext}`, absPath = path.join(root, relKey);
    const options = { ext: test.ext, relPath: relKey };
    assert.deepEqual([...test.collect(test.source, options)].sort(), expected, `${test.ext} decoded collector identity`);
    const entries = collectLanguageImportEntries({ ext: test.ext, relPath: relKey, text: test.source, mode: 'code', options });
    assert.deepEqual(entries.map(entry => entry.specifier), expected, `${test.ext} registry identity`);
    assert.ok(entries.every(entry => entry.provenance === 'parsed-literal'));
    const adapter = getLanguageForFile(test.ext, relKey);
    assert.deepEqual(adapter.buildRelations({ ext: test.ext, relPath: relKey, text: test.source, options }).imports, expected,
      `${test.ext} ordinary relation identity`);
    await fs.writeFile(absPath, test.source);
    const stat = await fs.stat(absPath);
    const scan = await scanImports({ files: [{ rel: relKey, abs: absPath, stat }], root, mode: 'code', languageOptions: {}, importConcurrency: 1 });
    assert.deepEqual(scan.importsByFile[relKey], expected, `${test.ext} ordinary import-pass identity`);
    const bundleDir = path.join(root, `bundle-${test.ext.slice(1)}`); await fs.mkdir(bundleDir);
    const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
    manifest.files[relKey] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey, fileStat: stat,
      fileHash: sha1(test.source), fileChunks: [], bundleFormat: 'json',
      fileRelations: { imports: scan.importsByFile[relKey], importScanFingerprint: scan.importScanFingerprint } });
    assert.deepEqual(await readCachedImports({ enabled: true, absPath, relKey, fileStat: stat, manifest, bundleDir,
      bundleFormat: 'json', expectedImportScanFingerprint: scan.importScanFingerprint }), expected, `${test.ext} incremental identity`);
  }
  const invalid = collectLanguageImportEntries({ ext: '.json', relPath: 'invalid.json',
    text: JSON.stringify({ includes: ['good', 'bad\u0000value', 'x'.repeat(4097)] }) });
  assert.deepEqual(invalid.map(entry => entry.specifier), ['good'], 'literal provenance retains controls/length validation');
  const scanner = new Set(); addCollectorImport(scanner, 'thing);');
  assert.deepEqual([...scanner], ['thing'], 'unparsed scanner tokens retain syntax cleanup');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('config parsed literal import identities test passed');
