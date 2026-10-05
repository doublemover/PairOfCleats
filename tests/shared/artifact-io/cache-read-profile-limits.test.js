#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { readJsonLinesArraySync } from '../../../src/shared/artifact-io/json/read-jsonl-array.js';
import { readJsonFileCached } from '../../../src/shared/artifact-io/loaders/shared.js';
import { loadPiecesManifest } from '../../../src/shared/artifact-io/manifest-read.js';
import { resolveManifestArtifactSources } from '../../../src/shared/artifact-io/manifest-sources.js';

const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-artifact-read-profiles-'));
const tooLarge = (error) => error?.code === 'ERR_JSON_TOO_LARGE';
const warmLimitCase = ({ filePath, expected, read, large, small }) => {
  assert.throws(() => read(filePath, { maxBytes: small }), tooLarge, 'cold admission rejects the smaller limit');
  const cached = read(filePath, { maxBytes: large });
  assert.deepEqual(cached, expected);
  const originalRead = fs.readFileSync;
  let rereads = 0;
  try {
    fs.readFileSync = function (target, ...options) {
      if (target === filePath) rereads += 1;
      return originalRead.call(this, target, ...options);
    };
    assert.equal(read(filePath, { maxBytes: large }), cached, 'compatible caller profile still reuses its value');
    assert.throws(() => read(filePath, { maxBytes: small }), tooLarge, 'warm admission retains the same smaller-limit error');
    assert.equal(read(filePath, { maxBytes: large }), cached, 'failed smaller admission cannot contaminate the larger profile');
    assert.equal(rereads, 0, 'compatible profiles avoid rereads and too-small files fail before a read');
  } finally {
    fs.readFileSync = originalRead;
  }
};
try {
  const rows = [{ id: 1, text: 'small controlled row' }, { id: 2, text: 'second row' }];
  const text = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  const plainPath = path.join(root, 'rows.jsonl');
  await fsPromises.writeFile(plainPath, text);
  warmLimitCase({ filePath: plainPath, expected: rows, read: readJsonLinesArraySync, large: 1024, small: 16 });
  const strictRows = readJsonLinesArraySync(plainPath, { maxBytes: 1024, validationMode: 'strict' });
  const trustedRows = readJsonLinesArraySync(plainPath, { maxBytes: 1024, validationMode: 'trusted' });
  assert.notEqual(strictRows, trustedRows, 'validation profiles do not share their retained arrays');
  assert.equal(readJsonLinesArraySync(plainPath, { maxBytes: 1024, validationMode: 'strict' }), strictRows);
  assert.throws(() => readJsonLinesArraySync(plainPath,
    { maxBytes: 1024, requiredKeys: ['missing'], validationMode: 'strict' }),
  (error) => error?.code === 'ERR_JSONL_INVALID', 'required-key reads retain their original validation and cache bypass');
  assert.throws(() => readJsonLinesArraySync(plainPath, { maxBytes: '16' }), tooLarge,
    'noncanonical limits preserve the existing cold-reader coercion without caching');
  assert.deepEqual(readJsonLinesArraySync(plainPath, { maxBytes: Infinity }), rows);
  assert.throws(() => readJsonLinesArraySync(plainPath, { maxBytes: null }), tooLarge,
    'unbounded/noncanonical reads do not poison finite/null caller limits');

  const compressedRows = [{ id: 1, text: 'x'.repeat(4096) }];
  const compressedText = JSON.stringify(compressedRows[0]) + '\n';
  const compressedPath = path.join(root, 'rows.jsonl.gz');
  const compressed = gzipSync(compressedText);
  assert.ok(compressed.length < 512 && Buffer.byteLength(compressedText) > 512);
  await fsPromises.writeFile(compressedPath, compressed);
  assert.throws(() => readJsonLinesArraySync(compressedPath, { maxBytes: 512 }), tooLarge);
  const compressedCached = readJsonLinesArraySync(compressedPath, { maxBytes: 8192 });
  assert.deepEqual(compressedCached, compressedRows);
  assert.throws(() => readJsonLinesArraySync(compressedPath, { maxBytes: 512 }), tooLarge,
    'changed profiles reapply the decompressed-byte limit');
  assert.equal(readJsonLinesArraySync(compressedPath, { maxBytes: 8192 }), compressedCached);

  const metadataPath = path.join(root, 'metadata.json');
  const metadata = { name: 'controlled metadata', rows };
  await fsPromises.writeFile(metadataPath, JSON.stringify(metadata));
  warmLimitCase({ filePath: metadataPath, expected: metadata, read: readJsonFileCached, large: 1024, small: 16 });

  const pieces = path.join(root, 'pieces');
  await fsPromises.mkdir(pieces);
  const manifestPath = path.join(pieces, 'manifest.json');
  const rawManifest = { fields: { compatibilityKey: 'profile-fixture', pieces: [], padding: 'x'.repeat(65536) } };
  await fsPromises.writeFile(manifestPath, JSON.stringify(rawManifest));
  assert.throws(() => loadPiecesManifest(root, { maxBytes: 16 }), tooLarge,
    'cold manifest honors its existing64KiB minimum-normalized limit');
  const raw = readJsonFileCached(manifestPath, { maxBytes: 131072 });
  const normalized = loadPiecesManifest(root, { maxBytes: 131072 });
  assert.deepEqual(raw, rawManifest);
  assert.deepEqual(normalized, rawManifest.fields, 'normalized manifest cannot reuse a raw-envelope cache view');
  assert.equal(normalized.fields, undefined);
  assert.throws(() => loadPiecesManifest(root, { maxBytes: 16 }), tooLarge);
  assert.equal(loadPiecesManifest(root, { maxBytes: 131072 }), normalized);
  assert.equal(readJsonFileCached(manifestPath, { maxBytes: 131072 }), raw, 'normalized view cannot contaminate raw JSON');

  const artifactMeta = { format: 'jsonl', parts: ['file_meta.jsonl'], padding: 'x'.repeat(200) };
  await fsPromises.writeFile(path.join(root, 'file_meta.meta.json'), JSON.stringify(artifactMeta));
  await fsPromises.writeFile(path.join(root, 'file_meta.jsonl'), text);
  const selection = { pieces: [{ name: 'file_meta', path: 'file_meta.jsonl' },
    { name: 'file_meta_meta', path: 'file_meta.meta.json' }] };
  const resolveSources = (maxBytes) => resolveManifestArtifactSources({ dir: root,
    manifest: selection, name: 'file_meta', strict: true, maxBytes });
  assert.throws(() => resolveSources(16), tooLarge);
  assert.ok(resolveSources(1024));
  assert.throws(() => resolveSources(16), tooLarge, 'manifest metadata source preserves warm read profiles too');

  const recoveryPath = path.join(root, 'recovery.json');
  await fsPromises.writeFile(recoveryPath, '{invalid');
  await fsPromises.writeFile(`${recoveryPath}.bak`, JSON.stringify({ version: 1 }));
  assert.deepEqual(readJsonFileCached(recoveryPath, { maxBytes: 1024, recoveryFallback: true }), { version: 1 });
  await fsPromises.writeFile(`${recoveryPath}.bak`, JSON.stringify({ version: 2 }));
  assert.deepEqual(readJsonFileCached(recoveryPath, { maxBytes: 1024, recoveryFallback: true }), { version: 2 },
    'a recovered sibling is not pinned under an unchanged invalid primary identity');
  assert.throws(() => readJsonFileCached(recoveryPath, { maxBytes: 1024 }), SyntaxError,
    'recovery reads cannot contaminate the default primary-failure policy');
  console.log('Artifact read profiles passed: cold/warm caps, decoded gzip limits, compatible reuse, manifest/raw isolation and recovery-source freshness');
} finally {
  await fsPromises.rm(root, { recursive: true, force: true });
}
