#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRepoCacheRoot } from '../../../src/shared/dict-utils.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';
import { captureSelectedModeRoots } from '../../../src/shared/indexing/selected-mode-roots.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { parseModes } from '../../../tools/index/validate.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-mode-capture-'));
try {
  const userConfig = { cache: { root: path.join(root, 'cache') } };
  const cache = getRepoCacheRoot(root, userConfig);
  await fs.mkdir(path.join(cache, 'builds'), { recursive: true });
  const pointer = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'B', buildRoot: 'builds/B',
    buildRootsByMode: { code: 'builds/B', prose: 'builds/A' } };
  await fs.writeFile(path.join(cache, 'builds', 'current.json'), JSON.stringify(pointer));
  const selected = captureSelectedModeRoots({ root, userConfig });
  assert.deepEqual(selected.modes, ['code', 'prose']);
  assert.equal(selected.roots.code, toRealPathSync(path.join(cache, 'builds', 'B')));
  assert.equal(selected.roots.prose, toRealPathSync(path.join(cache, 'builds', 'A')));
  const explicit = path.join(root, 'old'); await fs.mkdir(explicit);
  await fs.writeFile(path.join(explicit, 'build_state.json'), JSON.stringify({ modes: ['records'] }));
  assert.deepEqual(parseModes(null, root, userConfig, explicit), ['records'], 'declared missing mode must still be validated');
  assert.deepEqual(parseModes('code', root, userConfig, explicit), ['code']);
  assert.equal(parseModes('all', root, userConfig, explicit).length, 4);
} finally { await fs.rm(root, { recursive: true, force: true }); }
