import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';

import { getCombinedOutput } from '../../../helpers/stdio.js';
import { getRepoCacheRoot } from '../../../../tools/shared/dict-utils.js';
import { setupIncrementalRepo } from '../../../helpers/sqlite-incremental.js';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';
import {
  readBundleFile
} from '../../../../src/shared/bundle-io.js';
import { writeIncrementalBundleSnapshot } from '../../../../src/index/build/incremental/bundle-snapshot.js';
import { decodeIncrementalManifest, encodeIncrementalManifest } from '../../../../src/index/build/incremental/manifest-codec.js';

function createBundleFallbackTestConfig() {
  return {
    indexing: {
      scm: { provider: 'none' },
      treeSitter: { enabled: false }
    },
    tooling: {
      autoEnableOnDetect: false
    }
  };
}

function runIncrementalStage({ root, repoRoot, env, run, stage }) {
  run(
    [
      path.join(root, 'build_index.js'),
      '--incremental',
      '--stub-embeddings',
      '--scm-provider',
      'none',
      '--stage',
      stage,
      '--no-sqlite',
      '--mode',
      'code',
      '--repo',
      repoRoot
    ],
    `${stage} build`,
    { cwd: repoRoot, env, stdio: 'inherit' }
  );
}

export function writeLargeMultiChunkSource(repoRoot) {
  const largeSourcePath = path.join(repoRoot, 'src', 'multi-chunk.js');
  fs.mkdirSync(path.dirname(largeSourcePath), { recursive: true });
  fs.writeFileSync(
    largeSourcePath,
    Array.from({ length: 64 }, (_, index) => `export function value${index}() { return ${index}; }`).join('\n'),
    'utf8'
  );
}

export async function setupBundlePartialFallbackFixture({ name, beforeBuild } = {}) {
  const { root, repoRoot, env, userConfig, run } = await setupIncrementalRepo({
    name,
    testConfig: createBundleFallbackTestConfig()
  });

  await beforeBuild?.({ repoRoot });

  runIncrementalStage({ root, repoRoot, env, run, stage: 'stage2' });
  runIncrementalStage({ root, repoRoot, env, run, stage: 'stage3' });

  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const manifestPath = path.join(repoCacheRoot, 'incremental', 'format-' + ARTIFACT_SURFACE_VERSION, 'code', 'manifest.json');
  assert.equal(fs.existsSync(manifestPath), true, 'expected incremental manifest after stage3 build');

  const manifest = readManifest(manifestPath);
  assert.equal(manifest.bundleEmbeddings, true, 'expected stage3 manifest to advertise bundle embeddings');
  assert.equal(manifest.bundleEmbeddingCoverageComplete, true, 'expected stage3 manifest coverage to start complete');

  return { repoRoot, repoCacheRoot, manifestPath, manifest };
}

export function readManifest(manifestPath) {
  return decodeIncrementalManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), { indexPath: manifestPath });
}

export function writeManifest(manifestPath, manifest) {
  fs.writeFileSync(manifestPath, encodeIncrementalManifest(manifest, { indexPath: manifestPath }));
}

export function findFirstBundleEntry(manifest, predicate = () => true) {
  const [targetFile, targetEntry] = Object.entries(manifest.files || {}).find(([file, entry]) => (
    predicate({ file, entry })
    && Array.isArray(entry?.bundles)
    && entry.bundles.length
  ))
    || [];
  assert.ok(targetFile && targetEntry, 'expected a manifest file entry with bundle shards');
  return { targetFile, targetEntry };
}

export async function readFirstBundleShard(repoCacheRoot, targetEntry) {
  const bundleName = targetEntry.bundles[0];
  const bundlePath = path.join(repoCacheRoot, 'incremental', 'format-' + ARTIFACT_SURFACE_VERSION, 'code', 'files', bundleName);
  const readResult = await readBundleFile(bundlePath, { format: targetEntry.bundleFormat || null });
  assert.equal(readResult.ok, true, `expected readable bundle before mutation: ${readResult.reason || 'unknown error'}`);
  return { bundleName, bundlePath, readResult };
}

export async function writeBundleChunks({ bundlePath, targetEntry, readResult, chunks }) {
  const filesDir = path.dirname(bundlePath);
  const manifestPath = path.join(filesDir, '..', 'manifest.json');
  const manifest = readManifest(manifestPath);
  const file = readResult.bundle.file;
  assert.ok(manifest.files[file], 'the mutation belongs to the selected manifest');
  const bundles = [];
  for (const name of targetEntry.bundles) {
    const result = await readBundleFile(path.join(filesDir, name), { format: targetEntry.bundleFormat || null });
    assert.equal(result.ok, true);
    bundles.push(name === path.basename(bundlePath) ? { ...readResult.bundle, chunks } : result.bundle);
  }
  const snapshot = await writeIncrementalBundleSnapshot({ bundleDir: filesDir,
    relKey: file, entry: targetEntry, bundles, format: targetEntry.bundleFormat || 'json'
  });
  manifest.files[file] = { ...manifest.files[file], ...snapshot };
  // Publish the new selected content identity last. Keep stale chunk/embedding
  // counts deliberately: those are the specific fallback boundaries under test.
  writeManifest(manifestPath, manifest);
}

export async function runIncrementalSqliteAndGetOutput(repoRoot) {
  const sqliteLogs = [];
  await runSqliteBuild(repoRoot, {
    mode: 'code',
    incremental: true,
    logger: {
      log: (message) => sqliteLogs.push(message),
      warn: (message) => sqliteLogs.push(message),
      error: (message) => sqliteLogs.push(message)
    }
  });

  return getCombinedOutput({ stdout: sqliteLogs.join('\n'), stderr: '' });
}
