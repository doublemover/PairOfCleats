#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  resolveManifestPath,
  resolveManifestPieceByPath
} from '../../../src/shared/artifact-io/manifest.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const indexRoot = await makeTempDir('poc-manifest-dotdot-');
try {
  await fs.mkdir(path.join(indexRoot, '..chunk'));
  const dotDotPrefixedRel = '..chunk/meta.jsonl';
  const resolved = resolveManifestPath(indexRoot, dotDotPrefixedRel, true);

  assert.equal(path.relative(indexRoot, resolved), path.join('..chunk', 'meta.jsonl'));
  assert.throws(() => resolveManifestPath(indexRoot, '../escape/meta.jsonl', true));

  const manifest = {
    pieces: [
      { name: 'chunk_meta', path: '..chunk/meta.jsonl' }
    ]
  };

  const targetPath = path.join(indexRoot, '..chunk', 'meta.jsonl');
  const entry = resolveManifestPieceByPath({
    manifest,
    dir: indexRoot,
    targetPath,
    expectedName: 'chunk_meta'
  });
  assert.equal(entry?.path, '..chunk/meta.jsonl');

  const outsideTargetPath = path.resolve(indexRoot, '..', 'outside', 'meta.jsonl');
  assert.equal(
    resolveManifestPieceByPath({
      manifest,
      dir: indexRoot,
      targetPath: outsideTargetPath,
      expectedName: 'chunk_meta'
    }),
    null
  );
} finally {
  await rmDirRecursive(indexRoot);
}

console.log('manifest dotdot-prefix path handling test passed');
