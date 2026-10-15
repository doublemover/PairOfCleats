import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { writeIncrementalBundle, pruneIncrementalManifest } from '../../../src/index/build/incremental.js';
import { persistIncrementalManifest, decodeIncrementalManifest } from '../../../src/index/build/incremental/manifest-codec.js';
import { readIncrementalBundleSnapshot } from '../../../src/index/build/incremental/bundle-snapshot.js';
import { pruneSemanticCache } from '../../../src/index/build/incremental/semantic-cache-gc.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ordinary-snapshot-gc-'));
try {
  const bundleDir = path.join(root, 'files'), manifestPath = path.join(root, 'manifest.json');
  const write = async version => writeIncrementalBundle({ enabled: true, bundleDir,
    relKey: 'source.js', fileStat: { size: 10, mtimeMs: 1000 + version },
    fileHash: String(version).repeat(40), fileChunks: [{ file: 'source.js', text: 'version-' + version }],
    fileRelations: { imports: [] }, dependencySignatures: { parse: 'parser' }, bundleFormat: 'json' });
  const active = await write(0);
  await persistIncrementalManifest(manifestPath, { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    semanticEnabled: false, files: { 'source.js': active } });
  const abandoned = [await write(1), await write(2)];
  const retained = 'resume-' + 'f'.repeat(64) + '.json';
  await fs.writeFile(path.join(bundleDir, retained), 'retained');
  await fs.mkdir(path.join(bundleDir, 'completions'));
  await fs.writeFile(path.join(bundleDir, 'completions', 'keep.json'), 'retained');
  await fs.mkdir(path.join(bundleDir, 'semantic'));
  await fs.writeFile(path.join(bundleDir, 'semantic', 'keep'), 'retained');
  const manifest = decodeIncrementalManifest(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
  const malformed = { ...manifest, files: { 'source.js': { ...active, bundles: [active.bundles[0], 42] } } };
  assert.equal((await pruneSemanticCache({ bundleDir, manifest: malformed })).deferred, 'incomplete_inventory');
  await fs.access(path.join(bundleDir, active.bundles[0]));
  for (const entry of abandoned) await fs.access(path.join(bundleDir, entry.bundles[0]));
  const invalidManifestPath = path.join(root, 'invalid-directory');
  await fs.mkdir(invalidManifestPath);
  await pruneIncrementalManifest({ enabled: true, manifest, bundleDir,
    manifestPath: invalidManifestPath, seenFiles: new Set(['source.js']) });
  for (const entry of abandoned) await fs.access(path.join(bundleDir, entry.bundles[0]));
  await pruneIncrementalManifest({ enabled: true, manifest, bundleDir, manifestPath,
    seenFiles: new Set(['source.js']) });
  assert.ok(await readIncrementalBundleSnapshot({ repoRoot: root, bundleDir, relKey: 'source.js', entry: active }));
  for (const entry of abandoned) for (const suffix of ['', '.checksum.json']) {
    await assert.rejects(fs.access(path.join(bundleDir, entry.bundles[0] + suffix)), { code: 'ENOENT' });
  }
  for (const relative of [retained, 'completions/keep.json', 'semantic/keep']) await fs.access(path.join(bundleDir, relative));
  await pruneIncrementalManifest({ enabled: true, manifest, bundleDir, manifestPath,
    seenFiles: new Set(['source.js']) });
  assert.ok(await readIncrementalBundleSnapshot({ repoRoot: root, bundleDir, relKey: 'source.js', entry: active }));
  console.log('Nonsemantic restart cleanup retires orphan snapshots only after durable manifest publication.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
