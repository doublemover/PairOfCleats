#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';

import { runNode } from '../../helpers/run-node.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const fixturesRoot = path.join(root, 'tests', 'fixtures', 'extensions');
const tempRoot = resolveTestCachePath(root, 'download-extensions');
const verifyEnv = applyTestEnv({ syncProcess: false,
  extraEnv: { PAIROFCLEATS_ALLOW_LOCAL_DOWNLOADS: '1' } });

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const cases = [
  { label: 'zip', archive: 'vec0.zip', expectedArchive: 'zip' },
  { label: 'tar', archive: 'vec0.tar', expectedArchive: 'tar' }
];
const maliciousCases = [
  { label: 'zip-slip', archive: 'vec0-slip.zip', escapeName: 'pwned-zip.txt',
    expectedError: /No extension binary found/ },
  { label: 'tar-slip', archive: 'vec0-slip.tar', escapeName: 'pwned-tar.txt',
    expectedError: /unsafe tar entry: \.\.\/pwned-tar\.txt/ }
];
const allowedArchives = new Set([
  ...cases.map((entry) => entry.archive),
  ...maliciousCases.map((entry) => entry.archive)
]);

function serveFile(fileName) {
  if (fileName !== path.basename(fileName) || fileName.includes('..')) return null;
  if (!allowedArchives.has(fileName)) return null;
  const filePath = path.join(fixturesRoot, fileName);
  if (!fs.existsSync(filePath)) return null;
  return fs.createReadStream(filePath);
}

const server = http.createServer((req, res) => {
  const fileName = decodeURIComponent((req.url || '').replace(/^\//, ''));
  const stream = serveFile(fileName);
  if (!stream) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  res.statusCode = 200;
  stream.pipe(res);
});

function runDownload(args) {
  return spawnSubprocess(process.execPath, args, {
    cwd: root, env: verifyEnv, stdio: 'pipe', maxOutputBytes: 64 * 1024,
    timeoutMs: 5000, rejectOnNonZeroExit: false, killTree: true, cleanupOnParentExit: true,
    onStdout: chunk => process.stdout.write(chunk),
    onStderr: chunk => process.stderr.write(chunk)
  });
}

async function hashFile(filePath) {
  const buffer = await fsPromises.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;

const failures = [];
const expectedBinaryHash = crypto.createHash('sha256').update('stub-extension\n').digest('hex');
for (const entry of cases) {
  const extensionDir = path.join(tempRoot, entry.label);
  const url = `http://127.0.0.1:${port}/${entry.archive}`;
  const archiveHash = await hashFile(path.join(fixturesRoot, entry.archive));
  const result = await runDownload([
    path.join(root, 'tools', 'download', 'extensions.js'),
    '--url',
    `vec0=${url}`,
    '--sha256',
    `vec0=${archiveHash}`,
    '--dir',
    extensionDir,
    '--provider',
    'sqlite-vec',
    '--platform',
    'win32',
    '--arch',
    'x64',
    '--force'
  ]);
  if (result.exitCode !== 0) {
    failures.push(`${entry.label} download failed`);
    continue;
  }

  const expectedPath = path.join(extensionDir, 'sqlite-vec', 'win32-x64', 'vec0.dll');
  if (!fs.existsSync(expectedPath)) {
    failures.push(`${entry.label} output missing: ${expectedPath}`);
    continue;
  }

  const contents = await fsPromises.readFile(expectedPath, 'utf8');
  if (contents !== 'stub-extension\n') {
    failures.push(`${entry.label} output mismatch`);
  }

  const manifestPath = path.join(extensionDir, 'extensions.json');
  if (!fs.existsSync(manifestPath)) {
    failures.push(`${entry.label} manifest missing`);
    continue;
  }
  const manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
  const key = 'sqlite-vec:win32-x64';
  const record = manifest[key];
  if (!record) {
    failures.push(`${entry.label} manifest entry missing (${key})`);
    continue;
  }
  if (record.archive !== entry.expectedArchive) {
    failures.push(`${entry.label} manifest archive mismatch (${record.archive})`);
  }
  if (!record.extractedFrom) {
    failures.push(`${entry.label} manifest extractedFrom missing`);
  }
  if (record.sha256 !== archiveHash || record.verified !== true) {
    failures.push(`${entry.label} manifest hash verification missing`);
  }

  const verify = runNode(
    [
      path.join(root, 'tools', 'sqlite', 'verify-extensions.js'),
      '--dir',
      extensionDir,
      '--provider',
      'sqlite-vec',
      '--platform',
      'win32',
      '--arch',
      'x64',
      '--sha256',
      expectedBinaryHash,
      '--no-load',
      '--json'
    ],
    `verify extensions ${entry.label}`,
    root,
    verifyEnv,
    { stdio: 'pipe' }
  );
  if (verify.status !== 0) {
    failures.push(`${entry.label} verify-extensions failed`);
    continue;
  }
  const verifyPayload = JSON.parse(verify.stdout || '{}');
  if (!verifyPayload.exists) {
    failures.push(`${entry.label} verify-extensions missing path`);
  }
  assert.equal(verifyPayload.verification?.ok, true);
  assert.equal(verifyPayload.verification?.sha256, expectedBinaryHash);
  assert.equal(verifyPayload.verification?.verificationLevel, 'artifact-existence-and-approved-integrity');
  assert.equal(verifyPayload.load.attempted, false, 'fixture bytes must never be loaded as native code');
}

for (const entry of maliciousCases) {
  const extensionDir = path.join(tempRoot, entry.label);
  const url = `http://127.0.0.1:${port}/${entry.archive}`;
  const archiveHash = await hashFile(path.join(fixturesRoot, entry.archive));
  const escapePath = path.join(tempRoot, entry.escapeName);
  await fsPromises.rm(escapePath, { force: true });
  const result = await runDownload([
    path.join(root, 'tools', 'download', 'extensions.js'),
    '--url',
    `vec0=${url}`,
    '--sha256',
    `vec0=${archiveHash}`,
    '--dir',
    extensionDir,
    '--provider',
    'sqlite-vec',
    '--platform',
    'win32',
    '--arch',
    'x64',
    '--force'
  ]);
  assert.equal(result.exitCode, 1, `${entry.label}: the malformed archive must fail`);
  assert.equal(result.signal, null, `${entry.label}: rejection must not be a killed process`);
  assert.match(result.stderr, entry.expectedError, `${entry.label}: assert the initiating archive rejection`);
  const expectedPath = path.join(extensionDir, 'sqlite-vec', 'win32-x64', 'vec0.dll');
  if (fs.existsSync(escapePath)) {
    failures.push(`${entry.label} wrote outside extraction root`);
    continue;
  }
  if (fs.existsSync(expectedPath)) {
    failures.push(`${entry.label} unexpectedly extracted binary`);
  }
}

server.close();

if (failures.length) {
  failures.forEach((msg) => console.error(msg));
  process.exit(1);
}

console.log('download-extensions archive test passed');
