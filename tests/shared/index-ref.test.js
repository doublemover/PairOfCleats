#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseIndexRef, resolveIndexRef } from '../../src/index/index-ref.js';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
import { sha1 } from '../../src/shared/hash.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { applyTestEnv } from '../helpers/test-env.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'phase14-index-ref');
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');
const userConfig = { cache: { root: cacheRoot } };

const savedEnv = { ...process.env };
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(savedEnv)) {
    process.env[key] = value;
  }
};

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

try {
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(repoRoot, { recursive: true });
  applyTestEnv({ testing: '1', cacheRoot });

  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const buildCodeRoot = path.join(buildsRoot, 'build-code');
  const buildProseRoot = path.join(buildsRoot, 'build-prose');
  await writeJson(path.join(buildCodeRoot, 'build_state.json'), {
    schemaVersion: 1,
    buildId: 'build-code',
    configHash: 'cfg-code',
    tool: { version: '1.0.0' }
  });
  await writeJson(path.join(buildProseRoot, 'build_state.json'), {
    schemaVersion: 1,
    buildId: 'build-prose',
    configHash: 'cfg-prose',
    tool: { version: '1.0.1' }
  });
  await writeJson(path.join(buildsRoot, 'current.json'), {
    buildRoot: 'builds/build-code',
    buildRoots: {
      code: 'builds/build-code',
      prose: 'builds/build-prose'
    }
  });

  const parsedLatest = parseIndexRef(' latest ');
  assert.equal(parsedLatest.kind, 'latest');
  assert.equal(parsedLatest.canonical, 'latest');

  const parsedBuild = parseIndexRef('Build:build-code');
  assert.equal(parsedBuild.kind, 'build');
  assert.equal(parsedBuild.canonical, 'build:build-code');

  const parsedSnap = parseIndexRef('SNAP:snap-20260124-abc');
  assert.equal(parsedSnap.kind, 'snapshot');
  assert.equal(parsedSnap.snapshotId, 'snap-20260124-abc');

  const parsedTag = parseIndexRef('Tag:release/v1.2.3');
  assert.equal(parsedTag.kind, 'tag');
  assert.equal(parsedTag.canonical, 'tag:release/v1.2.3');

  const parsedPath = parseIndexRef('PATH:./relative/index');
  assert.equal(parsedPath.kind, 'path');
  assert.equal(parsedPath.canonical, 'path:./relative/index');

  const invalidRefs = [' ', 'build:', 'snap:bad', 'tag:', 'unknown:value'];
  for (const ref of invalidRefs) {
    assert.throws(
      () => parseIndexRef(ref),
      (err) => err?.code === 'INVALID_REQUEST',
      `expected INVALID_REQUEST for ${ref}`
    );
  }

  const latestResolved = resolveIndexRef({
    ref: 'latest',
    repoRoot,
    userConfig,
    requestedModes: ['code', 'prose']
  });
  assert.equal(latestResolved.indexBaseRootByMode.code, buildCodeRoot);
  assert.equal(latestResolved.indexBaseRootByMode.prose, buildProseRoot);
  assert.equal(latestResolved.identity.buildIdByMode.code, 'build-code');
  assert.equal(latestResolved.identity.buildIdByMode.prose, 'build-prose');
  assert.equal(latestResolved.identityHash, sha1(stableStringify(latestResolved.identity)));

  const snapshotsRoot = path.join(repoCacheRoot, 'snapshots');
  await writeJson(path.join(snapshotsRoot, 'manifest.json'), {
    version: 1,
    updatedAt: '2026-02-12T00:00:00.000Z',
    snapshots: {
      'snap-old': { snapshotId: 'snap-old', createdAt: '2026-02-10T00:00:00.000Z', hasFrozen: false },
      'snap-new': { snapshotId: 'snap-new', createdAt: '2026-02-11T00:00:00.000Z', hasFrozen: false }
    },
    tags: {
      release: ['snap-new', 'snap-old']
    }
  });
  await writeJson(path.join(snapshotsRoot, 'snap-old', 'snapshot.json'), {
    version: 1,
    snapshotId: 'snap-old',
    kind: 'pointer',
    pointer: {
      buildRootsByMode: { code: 'builds/build-prose' },
      buildIdByMode: { code: 'build-prose' }
    }
  });
  await writeJson(path.join(snapshotsRoot, 'snap-new', 'snapshot.json'), {
    version: 1,
    snapshotId: 'snap-new',
    kind: 'pointer',
    pointer: {
      buildRootsByMode: { code: 'builds/build-code' },
      buildIdByMode: { code: 'build-code' }
    }
  });

  const tagResolved = resolveIndexRef({
    ref: 'tag:release',
    repoRoot,
    userConfig,
    requestedModes: ['code']
  });
  assert.equal(tagResolved.identity.type, 'tag');
  assert.equal(tagResolved.identity.tag, 'release');
  assert.equal(tagResolved.identity.snapshotId, 'snap-new');
  assert.equal(tagResolved.indexBaseRootByMode.code, buildCodeRoot);

  const pathResolved = resolveIndexRef({
    ref: `path:${buildCodeRoot}`,
    repoRoot,
    userConfig,
    requestedModes: ['code']
  });
  assert.equal(pathResolved.identity.type, 'path');
  assert.equal(pathResolved.identity.pathHash, sha1(path.resolve(buildCodeRoot)));
  assert.ok(!stableStringify(pathResolved.identity).includes(path.resolve(buildCodeRoot)));
  assert.ok(pathResolved.warnings.some((warning) => warning.includes('Path ref used')));

  const escapeRoot = path.join(tempRoot, 'outside-build');
  await fs.mkdir(escapeRoot, { recursive: true });
  await writeJson(path.join(escapeRoot, 'build_state.json'), {
    schemaVersion: 1,
    buildId: 'build-escape',
    configHash: 'cfg-escape',
    tool: { version: '1.0.0' }
  });
  const escapeLinkRoot = path.join(buildsRoot, 'escape-link');
  let escapeLinkCreated = false;
  try {
    await fs.symlink(escapeRoot, escapeLinkRoot, process.platform === 'win32' ? 'junction' : 'dir');
    escapeLinkCreated = true;
  } catch {}
  if (escapeLinkCreated) {
    await writeJson(path.join(buildsRoot, 'current.json'), {
      buildRoot: 'builds/escape-link',
      buildRoots: { code: 'builds/escape-link' }
    });
    assert.throws(
      () => resolveIndexRef({
        ref: 'latest',
        repoRoot,
        userConfig,
        requestedModes: ['code']
      }),
      /escapes repo cache root/,
      'expected latest resolver to reject symlinked build roots that escape repo cache'
    );
    for (const allowMissingModes of [false, true]) {
      assert.throws(() => resolveIndexRef({
        ref: 'build:escape-link', repoRoot, userConfig,
        requestedModes: ['code'], allowMissingModes
      }), /escapes repo cache root/, 'explicit build refs must enforce the same cache boundary as latest');
    }

    const internalLink = path.join(buildsRoot, 'internal-link');
    await fs.symlink(buildCodeRoot, internalLink, process.platform === 'win32' ? 'junction' : 'dir');
    const internal = resolveIndexRef({
      ref: 'build:internal-link', repoRoot, userConfig, requestedModes: ['code']
    });
    assert.equal(internal.indexBaseRootByMode.code, internalLink, 'aliases remaining inside the cache stay supported');

    const frozenSnapshot = 'snap-frozen-escape';
    const snapshotDir = path.join(snapshotsRoot, frozenSnapshot);
    await writeJson(path.join(snapshotDir, 'snapshot.json'), {
      version: 1, snapshotId: frozenSnapshot,
      pointer: { buildRootsByMode: { code: 'builds/build-code' } }
    });
    await fs.symlink(escapeRoot, path.join(snapshotDir, 'frozen'), process.platform === 'win32' ? 'junction' : 'dir');
    const manifestPath = path.join(snapshotsRoot, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.snapshots[frozenSnapshot] = { snapshotId: frozenSnapshot, hasFrozen: true };
    await writeJson(manifestPath, manifest);
    for (const allowMissingModes of [false, true]) {
      assert.throws(() => resolveIndexRef({
        ref: `snap:${frozenSnapshot}`, repoRoot, userConfig,
        requestedModes: ['code'], allowMissingModes
      }), /escapes repo cache root/, 'frozen roots must not escape through a directory link');
    }
    const pointerOnly = resolveIndexRef({
      ref: `snap:${frozenSnapshot}`, repoRoot, userConfig,
      requestedModes: ['code'], preferFrozen: false
    });
    assert.equal(pointerOnly.indexBaseRootByMode.code, buildCodeRoot,
      'explicit pointer resolution must not require an unused frozen root');

    const externalSnapshotDir = path.join(tempRoot, 'external-snapshot');
    await writeJson(path.join(externalSnapshotDir, 'snapshot.json'), {
      pointer: { buildRootsByMode: { code: 'builds/build-code' } }
    });
    await fs.symlink(externalSnapshotDir, path.join(snapshotsRoot, 'snap-metadata-escape'),
      process.platform === 'win32' ? 'junction' : 'dir');
    manifest.snapshots['snap-metadata-escape'] = { snapshotId: 'snap-metadata-escape' };
    await writeJson(manifestPath, manifest);
    assert.throws(() => resolveIndexRef({
      ref: 'snap:snap-metadata-escape', repoRoot, userConfig, requestedModes: ['code']
    }), /escapes repo cache root/, 'snapshot metadata must be cache-contained before reading it');

    const externalPath = resolveIndexRef({
      ref: `path:${escapeRoot}`, repoRoot, userConfig, requestedModes: ['code']
    });
    assert.equal(externalPath.indexBaseRootByMode.code, escapeRoot,
      'explicit path refs retain their documented nonportable behavior');
  }

  const manifestPath = path.join(snapshotsRoot, 'manifest.json');
  const malformedManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  malformedManifest.tags.invalid = ['../outside-snapshot'];
  malformedManifest.snapshots['../outside-snapshot'] = { snapshotId: '../outside-snapshot' };
  await writeJson(manifestPath, malformedManifest);
  assert.throws(() => resolveIndexRef({
    ref: 'tag:invalid', repoRoot, userConfig, requestedModes: ['code']
  }), /Invalid snapshot id/, 'tag-selected snapshot IDs must be validated before constructing paths');

  for (const parsed of [
    { kind: 'build', buildId: '../escape', canonical: 'build:../escape' },
    { kind: 'snapshot', snapshotId: '../escape', canonical: 'snap:../escape' }
  ]) {
    assert.throws(() => resolveIndexRef({ parsed, repoRoot, userConfig, requestedModes: ['code'] }),
      (error) => error?.code === 'INVALID_REQUEST' && /Invalid .* id/.test(error.message),
      'pre-parsed references must retain ID safety checks');
  }

  console.log('index-ref tests passed');
} finally {
  restoreEnv();
}
