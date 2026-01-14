#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const cacheRoot = path.join(root, 'tests', '.cache', 'config-validate');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const validPath = path.join(cacheRoot, 'valid.json');
const invalidPath = path.join(cacheRoot, 'invalid.json');

await fsPromises.writeFile(
  validPath,
  JSON.stringify({ search: { annDefault: true }, sqlite: { use: true }, runtime: { uvThreadpoolSize: 8 } }, null, 2)
);
await fsPromises.writeFile(
  invalidPath,
  JSON.stringify({ unknownKey: true }, null, 2)
);

const validatorPath = path.join(root, 'tools', 'validate-config.js');
if (!fs.existsSync(validatorPath)) {
  console.error(`Missing validator script: ${validatorPath}`);
  process.exit(1);
}

const okResult = spawnSync(process.execPath, [validatorPath, '--config', validPath, '--json'], {
  encoding: 'utf8'
});
if (okResult.status !== 0) {
  console.error('config validate failed for valid config');
  if (okResult.stderr) console.error(okResult.stderr.trim());
  process.exit(okResult.status ?? 1);
}

let okPayload;
try {
  okPayload = JSON.parse(okResult.stdout || '{}');
} catch (err) {
  console.error('config validate output was not valid JSON');
  process.exit(1);
}
if (!okPayload.ok) {
  console.error('config validate did not report ok for valid config');
  process.exit(1);
}

const badResult = spawnSync(process.execPath, [validatorPath, '--config', invalidPath, '--json'], {
  encoding: 'utf8'
});
if (badResult.status === 0) {
  console.error('config validate should have failed for invalid config');
  process.exit(1);
}

let badPayload;
try {
  badPayload = JSON.parse(badResult.stdout || '{}');
} catch {
  badPayload = null;
}
if (!badPayload || badPayload.ok || !Array.isArray(badPayload.errors) || badPayload.errors.length === 0) {
  console.error('config validate did not report errors for invalid config');
  process.exit(1);
}

console.log('config validate test passed');
