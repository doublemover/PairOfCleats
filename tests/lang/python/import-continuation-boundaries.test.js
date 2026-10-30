import assert from 'node:assert/strict';
import { collectPythonImportEntries, collectPythonImports } from '../../../src/lang/python/imports.js';
import { collectLanguageImportEntries } from '../../../src/index/language-registry/registry.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanImports } from '../../../src/index/build/imports.js';
import { readCachedImports, writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { importExtractionRuntimeVersions, createImportExtraction } from '../../../src/shared/import-extraction.js';
import { stableStringifyForSignature } from '../../../src/shared/stable-json.js';
import { sha1 } from '../../../src/shared/hash.js';
import { createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();

const lines = ['value = (', '    1,', ')', 'from alpha import (', '    One,', '',
  '    # inside the continued import', '    Two as Second,', ')', 'import beta',
  'from ..gamma import (', '    Three,', ')', 'import delta; import epsilon as E',
  'from .zeta import \\', '    Four'];
const expected = ['..gamma', '.zeta', 'alpha', 'beta', 'delta', 'epsilon'];
for (const newline of ['\n', '\r\n']) for (const terminalNewline of ['', newline]) {
  const text = lines.join(newline) + terminalNewline;
  const { imports, usages } = collectPythonImports(text);
  assert.deepEqual([...imports].sort(), expected);
  assert.deepEqual(usages.sort(), ['E', 'Four', 'One', 'Second', 'Three', 'Two']);
  assert.deepEqual(collectPythonImportEntries(text).map(entry => entry.specifier).sort(), expected);
  assert.deepEqual(collectLanguageImportEntries({ ext: '.py', relPath: 'src/imports.py', mode: 'code', text })
    .map(entry => entry.specifier).sort(), expected);
}
const root = await createImportResolutionTempRoot('python-logical-import-replay');
try {
  const absPath = path.join(root, 'fixture.py'), relKey = 'fixture.py';
  const bundleDir = path.join(root, 'bundles'); await fs.mkdir(bundleDir);
  for (const newline of ['\n', '\r\n']) for (const terminal of ['', newline]) {
    const text = lines.join(newline) + terminal; await fs.writeFile(absPath, text);
    const stat = await fs.stat(absPath), files = [{ abs: absPath, rel: relKey, stat }];
    const input = { files, root, mode: 'code', languageOptions: {}, importConcurrency: 1 };
    const fresh = await scanImports(input);
    assert.deepEqual(fresh.importsByFile[relKey], expected, 'normal prescan uses the textual collector with exact logical-line boundaries');
    const fingerprint = producer => sha1(stableStringifyForSignature({ producer,
      extractionRuntime: importExtractionRuntimeVersions(), node: process.versions.node, mode: 'code', languageOptions: {} }));
    assert.equal(fresh.importScanFingerprint, fingerprint(SEMANTIC_ANALYSIS_VERSIONS.importResolution));
    const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
    const write = async fileRelations => {
      manifest.files[relKey] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey,
        fileStat: stat, fileHash: sha1(text), fileChunks: [], bundleFormat: 'json', fileRelations });
    };
    const read = () => readCachedImports({ repoRoot: root, enabled: true, absPath, relKey, fileStat: stat,
      manifest, bundleDir, bundleFormat: 'json', expectedImportScanFingerprint: fresh.importScanFingerprint });
    const incomplete = ['alpha'];
    await write({ imports: incomplete, importScanFingerprint: fingerprint(String(Number(SEMANTIC_ANALYSIS_VERSIONS.importResolution) - 1)),
      importScanExtraction: createImportExtraction({ entries: incomplete, text, producerId: 'old-python-fixture',
        parser: { id: 'fixture-qualified-parser', version: '1', available: true }, parserCoverage: 'complete', scope: 'fixture-historical-imports' }) });
    assert.equal(await read(), null, 'old producer fingerprints cannot qualify historical incomplete extraction');
    await write({ imports: incomplete, importScanFingerprint: fresh.importScanFingerprint });
    assert.equal(await read(), null, 'bare old arrays cannot claim current extraction coverage');
    const replay = await scanImports({ ...input, incrementalState: { enabled: true, manifest, bundleDir, bundleFormat: 'json' } });
    assert.deepEqual(replay.importsByFile[relKey], expected, 'refused replay returns to the real textual collector');
    assert.notEqual(replay.importExtractionByFile[relKey].state, 'complete', 'the legacy textual subset is not upgraded to a complete parser');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Python multiline import boundaries passed');
