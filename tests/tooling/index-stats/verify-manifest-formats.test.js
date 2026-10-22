import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { checksumFile, sha1File } from '../../../src/shared/hash.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('stats-manifest-formats');
const indexDir = path.join(dir, 'index-code');
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
await fs.mkdir(path.join(indexDir, 'dense_vectors.lancedb'));
await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[{"id":1}]');
await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{"tokens":["answer"]}');
await fs.writeFile(path.join(indexDir, 'empty.bin'), '');
await fs.writeFile(path.join(indexDir, 'index_state.json'), '{"compatibilityKey":"stats-formats"}');
await fs.writeFile(path.join(indexDir, 'filelists.json'), '{}');
const tokenChecksum = await checksumFile(path.join(indexDir, 'token_postings.json'));
const manifest = { version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [
  { name: 'index_state', format: 'json', path: 'index_state.json' },
  { name: 'filelists', format: 'json', path: 'filelists.json' },
  { name: 'chunk_meta', format: 'json', path: 'chunk_meta.json', bytes: null, count: 1,
    checksum: `sha1:${await sha1File(path.join(indexDir, 'chunk_meta.json'))}` },
  { name: 'token_postings', format: 'json', path: 'token_postings.json', count: 1,
    bytes: (await fs.stat(path.join(indexDir, 'token_postings.json'))).size,
    checksum: `${tokenChecksum.algo}:${tokenChecksum.value}` },
  { name: 'dense_vectors_lancedb', format: 'dir', path: 'dense_vectors.lancedb', bytes: null, checksum: null },
  { name: 'empty', format: 'bin', path: 'empty.bin', bytes: 0, checksum: `sha1:${await sha1File(path.join(indexDir, 'empty.bin'))}` }
] };
const manifestPath = path.join(indexDir, 'pieces/manifest.json');
await fs.writeFile(manifestPath, JSON.stringify(manifest));
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
let sequence = 0;
const run = async () => {
  const result = await spawnSubprocess(process.execPath, [path.resolve('tools/index/stats.js'), '--index-dir', indexDir, '--verify', '--json'],
    { env, timeoutMs: 5000, maxOutputBytes: 256 * 1024, stdio: ['ignore', 'pipe', 'pipe'], rejectOnNonZeroExit: false });
  await fs.writeFile(path.join(dir, `result-${++sequence}.json`), JSON.stringify(result, null, 2));
  return { result, report: JSON.parse(result.stdout) };
};
const good = await run();
assert.equal(good.result.exitCode, 0, JSON.stringify(good.report.verify));
assert.equal(good.report.verify.ok, true);
assert.deepEqual(good.report.verify.errors, []);
assert.deepEqual(good.report.verify.warnings, [], 'both declared hash algorithms must verify without false warnings');
await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[{"id":2}]');
const corrupted = await run();
assert.equal(corrupted.result.exitCode, 1, 'same-size checksum corruption must fail verification');
assert.equal(corrupted.report.verify.ok, false);
assert.equal(corrupted.report.verify.warnings.length, 0);
assert.equal(corrupted.report.verify.errors.length, 1);
assert.match(corrupted.report.verify.errors[0], /checksum mismatch for chunk_meta\.json/);
await fs.writeFile(path.join(indexDir, 'empty.bin'), 'unexpected');
const nonempty = await run();
assert.equal(nonempty.result.exitCode, 1);
assert.ok(nonempty.report.verify.errors.some(error => error.includes('bytes mismatch for empty.bin (expected 0')),
  'an explicitly declared zero is still verified');
await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[{"id":1}]');
await fs.writeFile(path.join(indexDir, 'empty.bin'), '');
const originalChecksum = manifest.pieces.find(piece => piece.name === 'chunk_meta').checksum;
for (const checksum of ['unknown:1234', 'sha1:bad', 'not-a-checksum']) {
  manifest.pieces.find(piece => piece.name === 'chunk_meta').checksum = checksum;
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const invalid = await run();
  assert.equal(invalid.result.exitCode, 1);
  assert.equal(invalid.report.verify.ok, false);
  assert.ok(invalid.report.verify.errors.some(error => /malformed or unsupported checksum/.test(error)));
}
manifest.pieces.find(piece => piece.name === 'chunk_meta').checksum = originalChecksum;
manifest.pieces.find(piece => piece.name === 'dense_vectors_lancedb').checksum = `sha1:${'0'.repeat(40)}`;
await fs.writeFile(manifestPath, JSON.stringify(manifest));
const unreadableHash = await run();
assert.equal(unreadableHash.result.exitCode, 1);
assert.equal(unreadableHash.report.verify.ok, false);
assert.ok(unreadableHash.report.verify.errors.some(error => /failed to compute checksum for dense_vectors\.lancedb/.test(error)));
console.log('Stats verification preserves unknown sizes and SHA-1/XXH64 while failing checksum corruption and hash-read errors.');
