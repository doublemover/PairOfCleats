#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadUserConfig } from '../../../tools/dict-utils.js';

const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-profile-'));
const configPath = path.join(tempRoot, '.pairofcleats.json');

try {
  await fsPromises.writeFile(
    configPath,
    JSON.stringify({ profile: 'lite' }, null, 2),
    'utf8'
  );
  try {
    loadUserConfig(tempRoot);
    console.error('Expected profile config to be rejected.');
    process.exit(1);
  } catch (err) {
    const message = String(err?.message || '');
    if (!message.includes('profile')) {
      console.error('Expected profile config error to mention profile.');
      process.exit(1);
    }
  }
} finally {
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

console.log('profile-config rejection test passed');
