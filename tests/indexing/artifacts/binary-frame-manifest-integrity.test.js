import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { enqueueTokenPostingsArtifacts } from '../../../src/index/build/artifacts/token-postings.js';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from '../validate/helpers.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createManifestWorkProbe } from '../../helpers/manifest-work-probe.js';

const { dir: root } = await prepareIsolatedTestCacheDir('binary-frame-manifest-integrity');
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
const outDir = path.join(root, 'producer'); await fs.mkdir(outDir);
const registry = createArtifactPieceRegistry({ outDir, resolveArtifactTier: () => 'hot' }), jobs = [];
try {
  await enqueueTokenPostingsArtifacts({ outDir, postings: { tokenVocab: ['alpha'], tokenPostingsList: [[[0, 2]]], avgDocLen: 2 },
    state: { docLengths: [2] }, tokenPostingsFormat: 'json', tokenPostingsUseShards: false,
    tokenPostingsBinaryColumnar: true, enqueueWrite: (_label, work) => jobs.push(work), enqueueJsonObject: () => {}, ...registry });
  const layout = registry.listPieceEntries().map(piece => piece.layout.order);
  for (const work of jobs) await work();
  assert.deepEqual(registry.listPieceEntries().map(piece => piece.layout.order), layout);
  const probe = createManifestWorkProbe();
  try {
    const { writePiecesManifest } = await import('../../../src/index/build/artifacts/checksums.js');
    await writePiecesManifest({ outDir, mode: 'code', indexState: { buildId: 'binary-proof' }, pieceEntries: registry.listPieceEntries() });
  } finally { probe.close(); }
  const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'pieces', 'manifest.json'), 'utf8'));
  const binary = manifest.pieces.filter(piece => /token_postings_binary_columnar(?:_offsets|_lengths)?$/u.test(piece.name));
  const binaryPaths = new Set(binary.map(piece => path.resolve(outDir, piece.path)));
  const binaryReads = probe.metrics.checksums.filter(call => binaryPaths.has(path.resolve(call.filename)));
  console.log(JSON.stringify({ manifestConstruction: probe.metrics, binaryManifestReadCalls: binaryReads.length,
    binaryManifestReadBytes: binaryReads.reduce((sum, call) => sum + call.bytes, 0) }));
  assert.equal(binary.length, 3);
  assert.equal(binaryReads.length, 0, 'manifest construction must reuse completed binary members rather than rereading them');
  assert.ok(probe.metrics.checksums.some(call => call.filename.endsWith('token_postings.binary-columnar.meta.json')),
    'ordinary JSON metadata still uses the complete original checksum path');
  for (const piece of binary) {
    const bytes = await fs.readFile(path.join(outDir, piece.path));
    assert.equal(piece.bytes, bytes.length);
    assert.equal(piece.checksum, 'sha256:' + createHash('sha256').update(bytes).digest('hex'));
  }
  const fixture = await createBaseIndex({ rootDir: path.join(root, 'validation') });
  for (const piece of manifest.pieces) await fs.copyFile(path.join(outDir, piece.path), path.join(fixture.indexDir, piece.path));
  fixture.manifest.pieces.push(...manifest.pieces);
  await fs.writeFile(path.join(fixture.indexDir, 'pieces', 'manifest.json'), JSON.stringify(fixture.manifest));
  const validate = () => validateIndexArtifacts({ root: fixture.repoRoot, indexRoot: fixture.indexRoot,
    modes: ['code'], userConfig: defaultUserConfig, strict: true, sqliteEnabled: false, lmdbEnabled: false });
  const started = performance.now(), cpu = process.cpuUsage();
  const healthy = await validate();
  console.log(JSON.stringify({ independentValidation: { elapsedMs: performance.now() - started, cpu: process.cpuUsage(cpu), ok: healthy.ok } }));
  assert.equal(healthy.ok, true, healthy.issues.join('\n'));
  const file = path.join(fixture.indexDir, binary[0].path), bytes = await fs.readFile(file);
  bytes[0] ^= 1; await fs.writeFile(file, bytes);
  const corrupt = await validate();
  assert.equal(corrupt.ok, false);
  assert.ok(corrupt.issues.some(issue => /checksum mismatch.*token_postings\.binary-columnar\.bin/u.test(issue)),
    'independent publication integrity must reread and reject same-size corruption: ' + corrupt.issues.join('\n'));
} finally {
  const relative = path.relative(process.cwd(), root);
  assert.ok(relative.startsWith(`.tmp${path.sep}`) && !relative.startsWith('..'));
  await fs.rm(root, { recursive: true, force: true });
}
