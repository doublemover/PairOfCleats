#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { collectLanguageImportEntries, buildLanguageContext } from '../../../src/index/language-registry.js';
import { getImportExtraction } from '../../../src/shared/import-extraction.js';
import { addCollectorImport } from '../../../src/index/language-registry/import-collectors/utils.js';
import { scanImports } from '../../../src/index/build/imports.js';
import { readCachedImports, writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { sha1 } from '../../../src/shared/hash.js';
import { createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const cases = [
  { file: 'page.html', source: '<!doctype html>\r\n<script src="./bundle.js,"></script><script src="./bundle.js"></script>'
    + '<link href="./part&#59;&#41;"><link href=" ./spaced.css "><script src="./bundle.js&#44;"></script>'
    + '<link href="./a&amp;b.css"><link href="&quot;quoted&quot;"><script src="namespace:thing"></script>'
    + '<!-- <script src="./comment.js"></script> --><img src="./image.png">'
    + '<script>const fake = \'<link href="./fake.css">\';</script>',
  expected: ['"quoted"', ' ./spaced.css ', './a&b.css', './bundle.js', './bundle.js,', './part;)', 'namespace:thing'],
  reusable: true },
  { file: 'input.r', source: 'source("./part;)")\nsource(" ./spaced.R ")\nsource("./part")\n'
    + 'library(package="pkg,",quietly=TRUE)\nrequire("pkg",quietly=FALSE)\n'
    + 'source("./quote\\\"name.R")\nprint("library(fake)")\n# source("comment.R")\n'
    + 'library(dynamic,character.only=TRUE)\nother::library("foreign")\nobject$source("member.R")',
  expected: [' ./spaced.R ', './part', './part;)', './quote"name.R', 'pkg', 'pkg,'], reusable: false }
];
const root = await createImportResolutionTempRoot('parsed-attribute-and-r-import-replay');
try {
  for (const test of cases) {
    const ext = path.extname(test.file), abs = path.join(root, test.file);
    const expected = test.expected.toSorted();
    const options = { collectorNow: () => 0, treeSitter: { enabled: false } };
    const input = { text: test.source, ext, relPath: test.file, mode: 'code', options };
    const entries = collectLanguageImportEntries(input);
    assert.deepEqual(entries.map(entry => entry.specifier), expected, `${ext} outer registry preserves decoded identities`);
    assert.ok(entries.every(entry => entry.provenance === 'parsed-literal'));
    const { lang, context } = await buildLanguageContext(input);
    const relations = lang.buildRelations({ ...input, context });
    assert.deepEqual([...relations.imports].sort(), expected, `${ext} prepared registered relations`);
    if (ext === '.html') {
      assert.equal(getImportExtraction(entries).state, 'complete');
      assert.equal(relations.importExtraction.scope, 'parse5-recovered-dom-script-src-link-href');
      const occurrence = entries.occurrences.find(row => row.rawAttribute === 'href="./part&#59;&#41;"');
      assert.ok(occurrence, 'raw attribute source remains separate from decoded identity');
      assert.equal(occurrence.specifier, './part;)');
      assert.equal(test.source.slice(occurrence.source.start, occurrence.source.end), occurrence.rawAttribute);
      assert.equal(occurrence.source.encoding, 'utf16le-js-string');
      assert.equal(entries.occurrences.filter(row => row.specifier === './bundle.js,').length, 2,
        'duplicate decoded values retain distinct source occurrences');
    } else assert.equal(getImportExtraction(entries).reusePolicy, 'refresh-required',
      'a lexical R collector does not gain full parser qualification from literal provenance');

    await fs.writeFile(abs, test.source);
    const stat = await fs.stat(abs), files = [{ abs, rel: test.file, stat }];
    const runScan = incrementalState => scanImports({ files, root, mode: 'code', languageOptions: options,
      importConcurrency: 1, incrementalState });
    const scan = await runScan();
    assert.deepEqual(scan.importsByFile[test.file], expected, `${ext} cold production scan`);
    const bundleDir = path.join(root, `bundles-${ext.slice(1)}`); await fs.mkdir(bundleDir);
    const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
    const writeBundle = async extraction => {
      manifest.files[test.file] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest,
        relKey: test.file, fileStat: stat, fileHash: sha1(test.source), fileChunks: [], bundleFormat: 'json',
        fileRelations: { imports: scan.importsByFile[test.file], importScanFingerprint: scan.importScanFingerprint,
          ...(extraction ? { importScanExtraction: extraction } : {}) } });
    };
    const readBundle = () => readCachedImports({ enabled: true, absPath: abs, relKey: test.file,
      fileStat: stat, manifest, bundleDir, bundleFormat: 'json', expectedImportScanFingerprint: scan.importScanFingerprint });
    await writeBundle(scan.importExtractionByFile[test.file]);
    assert.deepEqual(await readBundle(), test.reusable ? expected : null, `${ext} persisted qualification policy`);
    const warm = await runScan({ enabled: true, manifest, bundleDir, bundleFormat: 'json' });
    assert.deepEqual(warm.importsByFile[test.file], expected, `${ext} admitted warm replay or required refresh`);
    await writeBundle(null);
    assert.equal(await readBundle(), null, `${ext} old unqualified caches cannot manufacture a complete scan`);
    assert.deepEqual((await runScan({ enabled: true, manifest, bundleDir, bundleFormat: 'json' })).importsByFile[test.file], expected);
  }
  const invalid = collectLanguageImportEntries({ ext: '.html', relPath: 'invalid.html', mode: 'code',
    text: '<script src="good.js"></script><script src="bad&#10;value"></script><link href="' + 'x'.repeat(4097) + '">' });
  assert.deepEqual(invalid.map(row => row.specifier), ['good.js'], 'parsed literals retain control and length admission');
  assert.equal(getImportExtraction(invalid).reusePolicy, 'refresh-required', 'invalid values degrade rather than qualify omission');
  const scanner = new Set(); addCollectorImport(scanner, 'thing);');
  assert.deepEqual([...scanner], ['thing'], 'heuristic scanner syntax cleanup remains');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('parsed HTML attribute and R import registry/replay test passed');
