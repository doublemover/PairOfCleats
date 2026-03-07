#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../../helpers/root.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = repoRoot();
const cacheRoot = resolveTestCachePath(root, 'config-validate');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const validPath = path.join(cacheRoot, 'valid.json');
const validAnyOfPath = path.join(cacheRoot, 'valid-anyof.json');
const invalidPath = path.join(cacheRoot, 'invalid.json');

await fsPromises.writeFile(
  validPath,
  JSON.stringify({ quality: 'balanced', cache: { root: 'C:/tmp/pairofcleats' } }, null, 2)
);
await fsPromises.writeFile(
  validAnyOfPath,
  JSON.stringify({
    quality: 'balanced',
    threads: 4,
    tooling: { enabledTools: ['pyright', 'clangd'] },
    indexing: { riskInterprocedural: { caps: { maxMs: null } } }
  }, null, 2)
);
await fsPromises.writeFile(
  invalidPath,
  JSON.stringify({ unknownKey: true }, null, 2)
);

const validatorPath = path.join(root, 'tools', 'config/validate.js');
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

const anyOfResult = spawnSync(process.execPath, [validatorPath, '--config', validAnyOfPath, '--json'], {
  encoding: 'utf8'
});
if (anyOfResult.status !== 0) {
  console.error('config validate failed for anyOf/union config');
  if (anyOfResult.stderr) console.error(anyOfResult.stderr.trim());
  process.exit(anyOfResult.status ?? 1);
}
let anyOfPayload;
try {
  anyOfPayload = JSON.parse(anyOfResult.stdout || '{}');
} catch (err) {
  console.error('config validate output was not valid JSON for anyOf/union config');
  process.exit(1);
}
if (!anyOfPayload.ok) {
  console.error('config validate did not report ok for anyOf/union config');
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

