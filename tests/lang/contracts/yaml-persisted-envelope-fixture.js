import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { isCanonicalChunkUid } from '../../../src/shared/identity.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { writeIncrementalBundle, readCachedBundle } from '../../../src/index/build/incremental.js';
import { createProcessChunksFixtureContext, processFixtureChunks } from '../../indexing/file-processor/process-chunks-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

/** Actual token-flow identity/payload assembly and immutable bundle admission.
 * Expected document starts/markers belong to the authored source, not a parser.
 */
export const assertYamlEnvelopeBundle = async ({ text, chunks, documentStarts, markers }) => {
  const { dir } = await prepareIsolatedTestCacheDir('yaml-document-envelope-bundle');
  const fileHash = createHash('sha1').update(text).digest('hex'), fileSize = Buffer.byteLength(text);
  let failed = false, primary;
  try {
    const { context } = createProcessChunksFixtureContext({ text, ext: '.yaml', languageId: 'yaml', rel: 'stream.yaml',
      riskAnalysisEnabled: false, typeInferenceEnabled: false, overrides: { sc: chunks, fileHash, fileHashAlgo: 'sha1' } });
    const indexed = await processFixtureChunks(context);
    const sourceIdentity = rows => rows.map(row => [row.name, row.kind, row.start, row.end]);
    assert.deepEqual(sourceIdentity(indexed.chunks), sourceIdentity(chunks));
    const uids = indexed.chunks.map(row => row.chunkUid);
    assert.equal(new Set(uids).size, chunks.length);
    for (const row of indexed.chunks) {
      assert.ok(isCanonicalChunkUid(row.chunkUid)); assert.equal(row.metaV2.chunkUid, row.chunkUid);
      assert.equal(row.fileHash, fileHash); assert.equal(row.fileHashAlgo, 'sha1'); assert.equal(row.fileSize, fileSize);
      assert.equal(row.metaV2.fileHash, fileHash); assert.equal(row.metaV2.fileHashAlgo, 'sha1');
    }
    const abs = path.join(dir, 'stream.yaml'), bundleDir = path.join(dir, 'bundles');
    await fs.writeFile(abs, text); await fs.mkdir(bundleDir);
    const stat = await fs.stat(abs), manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
    manifest.files['stream.yaml'] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey: 'stream.yaml',
      fileStat: stat, fileHash, fileChunks: indexed.chunks, vfsManifestRows: indexed.vfsManifestRows, bundleFormat: 'json', fileRelations: {} });
    assert.ok(manifest.files['stream.yaml']?.bundleInventory?.length, 'original immutable publication succeeds');
    const { cachedBundle } = await readCachedBundle({ repoRoot: dir, enabled: true, absPath: abs, relKey: 'stream.yaml',
      fileStat: stat, manifest, bundleDir, bundleFormat: 'json' });
    assert.ok(cachedBundle); assert.equal(cachedBundle.hash, fileHash); assert.equal(cachedBundle.size, fileSize);
    assert.deepEqual(cachedBundle.chunks, JSON.parse(JSON.stringify(indexed.chunks)));
    assert.deepEqual(cachedBundle.chunks.map(row => row.chunkUid), uids);
    assert.equal(cachedBundle.chunks.map(row => text.slice(row.start, row.end)).join(''), text);
    for (const { token, documentIndex, name } of markers) {
      const matches = cachedBundle.chunks.filter(row => row.tokens.includes(token));
      assert.equal(matches.length, 1, token + ' retains one searchable document owner');
      const row = matches[0], start = documentStarts[documentIndex], end = documentStarts[documentIndex + 1] ?? text.length;
      assert.ok(row.start >= start && row.end <= end); assert.equal(row.name, name);
      assert.ok(text.slice(row.start, row.end).includes(token));
    }
    const saved = await fs.readFile(abs);
    assert.equal(saved.toString('utf8'), text); assert.equal(createHash('sha1').update(saved).digest('hex'), fileHash);
    return indexed;
  } catch (error) { failed = true; primary = error; throw error; }
  finally {
    try { await fs.rm(dir, { recursive: true, force: true }); }
    catch (cleanup) {
      if (failed) throw addStorageFailureContext(primary, { phase: 'yaml-envelope-fixture-cleanup' }, cleanup, { secondaryPresent: true });
      throw cleanup;
    }
  }
};
