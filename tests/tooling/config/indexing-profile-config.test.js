#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadUserConfig } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-index-profile-'));
const configPath = path.join(tempRoot, '.pairofcleats.json');

try {
  const invalidProfiles = ['vector-only', false, 0, {}];
  for (const profileValue of invalidProfiles) {
    await fsPromises.writeFile(
      configPath,
      JSON.stringify({ indexing: { profile: profileValue } }, null, 2),
      'utf8'
    );
    let failed = false;
    try {
      loadUserConfig(tempRoot);
    } catch (err) {
      failed = true;
      const message = String(err?.message || '');
      if (!message.includes('profile')) {
        console.error('Expected indexing.profile config error to mention profile.');
        process.exit(1);
      }
    }
    if (!failed) {
      console.error(`Expected invalid indexing.profile value to be rejected: ${JSON.stringify(profileValue)}.`);
      process.exit(1);
    }
  }
} finally {
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

console.log('indexing-profile config rejection test passed');
