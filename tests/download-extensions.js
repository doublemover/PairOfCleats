#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = process.cwd();
const fixturesRoot = path.join(root, 'tests', 'fixtures', 'extensions');
const tempRoot = path.join(root, 'tests', '.cache', 'download-extensions');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

function serveFile(fileName) {
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
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;

const cases = [
  { label: 'zip', archive: 'vec0.zip', expectedArchive: 'zip' },
  { label: 'tar', archive: 'vec0.tar', expectedArchive: 'tar' }
];

const failures = [];
for (const entry of cases) {
  const extensionDir = path.join(tempRoot, entry.label);
  const url = `http://127.0.0.1:${port}/${entry.archive}`;
  const status = await runDownload([
    path.join(root, 'tools', 'download-extensions.js'),
    '--url',
    `vec0=${url}`,
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
  if (status !== 0) {
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
  const key = 'vec0:win32-x64';
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

  const verify = spawnSync(
    process.execPath,
    [
      path.join(root, 'tools', 'verify-extensions.js'),
      '--dir',
      extensionDir,
      '--provider',
      'sqlite-vec',
      '--platform',
      'win32',
      '--arch',
      'x64',
      '--no-load',
      '--json'
    ],
    { cwd: root, encoding: 'utf8' }
  );
  if (verify.status !== 0) {
    failures.push(`${entry.label} verify-extensions failed`);
    continue;
  }
  const verifyPayload = JSON.parse(verify.stdout || '{}');
  if (!verifyPayload.exists) {
    failures.push(`${entry.label} verify-extensions missing path`);
  }
}

server.close();

if (failures.length) {
  failures.forEach((msg) => console.error(msg));
  process.exit(1);
}

console.log('download-extensions archive test passed');
