import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { checksumFile } from '../../../src/shared/hash.js';
import { loadIndex } from '../../../src/retrieval/cli-index.js';
import { attachDenseVectorLoader } from '../../../src/retrieval/cli/ann-backends.js';
import { prepareArtifactIoTestDir, writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

const root = await prepareArtifactIoTestDir('strict-dense-artifact-admission');
const options = { strict: true, mode: 'code', denseVectorMode: 'auto',
  includeHnsw: false, includeMinhash: false, includeFilterIndex: false,
  includeTokenIndex: false, includeFileRelations: false, includeRepoMap: false };
const piece = (name, filename, format = 'json') => ({ name, path: filename, format });
const configure = async (name, fault = null) => {
  const dir = path.join(root, name); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'chunk_meta.json'), '[]');
  await fs.writeFile(path.join(dir, 'merged.json'), JSON.stringify({ dims: 2, count: 1, vectors: [[9, 8]], model: 'fixture' }));
  const pieces = [piece('chunk_meta', 'chunk_meta.json'), piece('dense_vectors', 'merged.json')];
  if (fault !== 'absent-preferred') {
    pieces.push(piece('dense_vectors_code_binary_meta', 'code-meta.json'));
    pieces.push(piece('dense_vectors_code', 'code.bin', 'binary'));
    const meta = { fields: { schemaVersion: '1.0.0', artifact: 'dense_vectors_code_uint8',
      format: 'uint8-row-major', path: 'code.bin', dims: 2, count: 1, model: 'fixture' } };
    if (fault !== 'missing-meta') await fs.writeFile(path.join(dir, 'code-meta.json'),
      fault === 'malformed-json' ? '{broken' : JSON.stringify(fault === 'invalid-shape' ? { fields: { dims: 0 } } : meta));
    if (fault !== 'missing-payload') await fs.writeFile(path.join(dir, 'code.bin'),
      fault === 'truncated-payload' ? Uint8Array.of(1) : Uint8Array.of(1, 2));
    if (fault === 'checksum-meta') pieces[2].checksum = 'sha256:' + '0'.repeat(64);
    if (fault === 'unsupported-checksum') pieces[2].checksum = 'sha512:' + '0'.repeat(128);
    if (fault === 'short-checksum') pieces[2].checksum = 'sha256:00';
    if (fault && fault.startsWith('valid-')) {
      const algorithm = fault.slice(6);
      if (algorithm === 'compressed') {
        const encoded = gzipSync(await fs.readFile(path.join(dir, 'code-meta.json')));
        await fs.writeFile(path.join(dir, 'code-meta.json.gz'), encoded);
        pieces[2].path = 'code-meta.json.gz';
        pieces[2].checksum = 'sha256:' + createHash('sha256').update(encoded).digest('hex');
      } else if (algorithm === 'xxh64') pieces[2].checksum = 'xxh64:' +
        (await checksumFile(path.join(dir, 'code-meta.json'))).value;
      else pieces[2].checksum = algorithm + ':' + createHash(algorithm)
        .update(await fs.readFile(path.join(dir, 'code-meta.json'))).digest('hex');
    }
  }
  await writePiecesManifest(dir, pieces);
  return dir;
};
const lazy = (dir, strict = true) => {
  const idx = {};
  attachDenseVectorLoader({ idx, dir, mode: 'code', needsAnnArtifacts: true,
    lazyDenseVectorsEnabled: true, resolvedDenseVectorMode: 'auto', strict });
  return idx;
};
try {
  for (const fault of ['missing-meta', 'malformed-json', 'invalid-shape', 'missing-payload',
    'truncated-payload', 'checksum-meta', 'unsupported-checksum', 'short-checksum']) {
    const dir = await configure(fault, fault);
    for (const [kind, run] of [['direct', () => loadIndex(dir, options)],
      ['lazy', () => lazy(dir).loadDenseVectors()]]) {
      await assert.rejects(run, error => {
        assert.ok(error instanceof Error, kind + ':' + fault + ' retains a real declared-artifact failure');
        assert.ok(!/compatibilityKey|chunk_meta/.test(error.message), 'failure belongs to dense input, not fixture setup');
        return true;
      }, kind + ':' + fault + ' must not turn a corrupt declared candidate into merged fallback');
    }
  }
  const absentDir = await configure('absent-preferred', 'absent-preferred');
  const direct = await loadIndex(absentDir, options), deferred = lazy(absentDir);
  assert.deepEqual(direct.denseVec.vectors, [[9, 8]]);
  assert.deepEqual((await deferred.loadDenseVectors()).vectors, [[9, 8]]);
  assert.equal(direct.denseVecCode, null, 'absent optional preferred candidate remains absent');
  for (const fault of [null, 'valid-sha1', 'valid-sha256', 'valid-xxh64', 'valid-compressed']) {
    const healthyDir = await configure('healthy-' + fault, fault);
    const healthy = await loadIndex(healthyDir, options), healthyLazy = lazy(healthyDir);
    assert.deepEqual(Array.from(healthy.denseVecCode.buffer), [1, 2]);
    assert.deepEqual(Array.from((await healthyLazy.loadDenseVectors()).buffer), [1, 2]);
    if (fault === 'valid-sha256') {
      const filename = path.join(healthyDir, 'code-meta.json'), stat = await fs.stat(filename);
      const bytes = await fs.readFile(filename, 'utf8');
      await fs.writeFile(filename, bytes.replace('fixture', 'changed'));
      await fs.utimes(filename, stat.atime, stat.mtime);
      await assert.rejects(loadIndex(healthyDir, options), { code: 'ERR_ARTIFACT_CORRUPT' });
      await assert.rejects(lazy(healthyDir).loadDenseVectors(), { code: 'ERR_ARTIFACT_CORRUPT' });
    }
  }
  assert.deepEqual((await loadIndex(absentDir, { ...options, strict: false })).denseVec.vectors, [[9, 8]]);
  const missingMetaDir = await configure('non-strict-declared-binary', 'missing-meta');
  await assert.rejects(loadIndex(missingMetaDir, { ...options, strict: false }),
    { code: 'ERR_MANIFEST_FORMAT_UNSUPPORTED' }, 'permissive optional fallback does not reinterpret declared binary as JSON');
} finally {
  assert.ok(path.resolve(root).startsWith(path.resolve(process.cwd()) + path.sep));
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Strict direct/lazy dense loading distinguishes absent optional candidates from declared corrupt metadata and bytes.');
