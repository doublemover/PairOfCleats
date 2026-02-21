#!/usr/bin/env node
import { ensureTestingEnv } from '../../helpers/test-env.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

ensureTestingEnv(process.env);

const root = process.cwd();
const binPath = path.join(root, 'bin', 'pairofcleats.js');
const tempRoot = path.join(root, '.testCache', 'service-indexer-json-flag');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const configPath = path.join(tempRoot, 'service-config.json');
await fsPromises.writeFile(configPath, JSON.stringify({
  queueDir: path.join(tempRoot, 'queue'),
  repos: []
}, null, 2), 'utf8');

if (!fs.existsSync(binPath)) {
  console.error(`Missing CLI entrypoint: ${binPath}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [binPath, 'service', 'indexer', 'status', '--json', '--config', configPath],
  { encoding: 'utf8' }
);

if (result.status !== 0) {
  const stderr = String(result.stderr || '').trim();
  if (/INVALID_REQUEST/i.test(stderr)) {
    console.error('service indexer --json flag test failed: top-level CLI rejected --json');
  } else {
    console.error('service indexer --json flag test failed: command exited non-zero');
  }
  if (stderr) console.error(stderr);
  process.exit(result.status ?? 1);
}

const stdout = String(result.stdout || '').trim();
if (!stdout) {
  console.error('service indexer --json flag test failed: expected JSON output');
  process.exit(1);
}

let payload = null;
try {
  payload = JSON.parse(stdout);
} catch (error) {
  console.error(`service indexer --json flag test failed: invalid JSON output (${error?.message || error})`);
  process.exit(1);
}

if (payload?.ok !== true || typeof payload?.queue?.total !== 'number') {
  console.error('service indexer --json flag test failed: unexpected payload');
  process.exit(1);
}

console.log('service indexer --json flag test passed');
