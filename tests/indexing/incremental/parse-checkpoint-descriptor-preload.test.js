#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { removeBundleWriteArtifacts } from '../../../src/shared/bundle-io.js';
import { sha1 } from '../../../src/shared/hash.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { BUNDLE_PARSE_CHECKPOINT_SUFFIX } from '../../../src/shared/bundle-io-constants.js';
import { writeIncrementalBundleSnapshot } from '../../../src/index/build/incremental/bundle-snapshot.js';
import { preloadParseCheckpoints } from '../../../src/index/build/incremental/stage-reuse.js';
import { loadCachedBundleForFile } from '../../../src/index/build/file-processor/incremental.js';
applyTestEnv({ testing: '1' });
const parent = path.resolve('.tmp/tasks/parse-checkpoint-descriptor'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'preload-'));
try {
  const abs = path.join(root, 'source.js'), bundleDir = path.join(root, 'bundles');
  const text = 'function alpha(){ return 1; }'; await fs.writeFile(abs, text);
  const stat = await fs.stat(abs), hash = sha1(Buffer.from(text));
  const dependencies = { parse: 'parse-v1', lexical: 'lexical-v1' };
  const checkpoint = { chunks: [{ start: 0, end: text.length }], diagnostics: {}, textLength: text.length };
  const bundle = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, file: 'source.js', hash,
    size: stat.size, mtimeMs: stat.mtimeMs, dependencySignatures: dependencies, parseCheckpoint: checkpoint,
    chunks: [{ start: 0, end: text.length, tokens: ['x'.repeat(50000)] }] };
  const snapshot = await writeIncrementalBundleSnapshot({ repoRoot: root, bundleDir,
    relKey: 'source.js', bundles: [bundle] });
  const selected = { ...snapshot, hash, size: stat.size, mtimeMs: stat.mtimeMs, dependencySignatures: dependencies };
  const state = { enabled: true, bundleDir, bundleFormat: 'json', readHashCache: new Map(),
    manifest: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, dependencySignatures: dependencies, files: { 'source.js': selected } } };
  // A missing lexical shard cannot have been decoded by the checkpoint preloader.
  // Geometry is a separately source/parse-qualified product; later file handling
  // receives it without pretending that lexical/semantic lanes were replayed.
  await fs.unlink(path.join(bundleDir, snapshot.bundles[0]));
  const entries = [...Array.from({ length: 1000 }, (_, i) => ({ abs: abs + i, rel: 'unknown-' + i })), { abs, rel: 'source.js', stat }];
  assert.equal((await preloadParseCheckpoints({ entries, incrementalState: state, repoRoot: root })).has(abs), true);
  assert.equal(state.parseCheckpointPreloadMetrics.descriptorReads, 1);
  assert.ok(state.parseCheckpointPreloadMetrics.descriptorBytes < 4096);
  assert.equal(state.parseCheckpointPreloadMetrics.sourceVerificationBytes, Buffer.byteLength(text));
  const fallback = await loadCachedBundleForFile({ repoRoot: root, runIo: fn => fn(), incrementalState: state,
    absPath: abs, relKey: 'source.js', fileStat: stat });
  assert.equal(fallback.cachedBundle, null); assert.deepEqual(fallback.parseCheckpointFallback.checkpoint, checkpoint);
  assert.equal((await preloadParseCheckpoints({ entries, incrementalState: state, repoRoot: root, maxBytes: 1 })).size, 0);
  const changed = text.replace('1', '2'); await fs.writeFile(abs, changed); await fs.utimes(abs, stat.atime, stat.mtime);
  assert.equal((await preloadParseCheckpoints({ entries, incrementalState: state, repoRoot: root })).size, 0, 'same-stat content changes invalidate geometry');
  await fs.writeFile(abs, text);
  await fs.writeFile(path.join(bundleDir, snapshot.bundles[0] + BUNDLE_PARSE_CHECKPOINT_SUFFIX), '{}');
  assert.equal((await preloadParseCheckpoints({ entries, incrementalState: state, repoRoot: root })).size, 0, 'corrupt descriptors stay a planning miss');
  await removeBundleWriteArtifacts(path.join(bundleDir, snapshot.bundles[0]));
  await assert.rejects(fs.stat(path.join(bundleDir, snapshot.bundles[0] + BUNDLE_PARSE_CHECKPOINT_SUFFIX)), { code: 'ENOENT' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(preloadParseCheckpoints({ entries, incrementalState: state, repoRoot: root, signal: controller.signal }), { code: 'ABORT_ERR' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
