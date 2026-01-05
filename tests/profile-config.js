#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadUserConfig } from '../tools/dict-utils.js';

const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-profile-'));
const configPath = path.join(tempRoot, '.pairofcleats.json');

try {
  await fsPromises.writeFile(
    configPath,
    JSON.stringify({ profile: 'lite' }, null, 2),
    'utf8'
  );

  const loaded = loadUserConfig(tempRoot);
  assert.equal(loaded.profile, 'lite');
  assert.equal(loaded.indexing?.gitBlame, false);

  const previousProfile = process.env.PAIROFCLEATS_PROFILE;
  process.env.PAIROFCLEATS_PROFILE = 'full';
  const loadedEnv = loadUserConfig(tempRoot);
  assert.equal(loadedEnv.profile, 'full');
  assert.equal(loadedEnv.indexing?.gitBlame, true);
  if (previousProfile) {
    process.env.PAIROFCLEATS_PROFILE = previousProfile;
  } else {
    delete process.env.PAIROFCLEATS_PROFILE;
  }
} finally {
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

console.log('profile-config test passed');
