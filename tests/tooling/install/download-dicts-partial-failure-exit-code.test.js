#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { attachSilentLogging } from '../../helpers/test-env.js';

const root = process.cwd();
const fixturesRoot = path.join(root, 'tests', 'fixtures', 'dicts');
const tempRoot = path.join(root, '.testCache', 'download-dicts-partial-failure');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const sourceFile = path.join(fixturesRoot, 'words.txt');
if (!fs.existsSync(sourceFile)) {
  console.error(`Missing fixture: ${sourceFile}`);
  process.exit(1);
}
const sourceHash = crypto.createHash('sha256')
  .update(await fsPromises.readFile(sourceFile))
  .digest('hex');

const server = http.createServer((req, res) => {
  if (req.url === '/words.txt') {
    res.statusCode = 200;
    fs.createReadStream(sourceFile).pipe(res);
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const baseUrl = `http://127.0.0.1:${port}`;

const run = (cmd, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: options.env || process.env
  });
  attachSilentLogging(child, 'download-dicts-partial-failure');
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.on('error', reject);
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

const result = await run(
  process.execPath,
  [
    path.join(root, 'tools', 'download', 'dicts.js'),
    '--url',
    `ok=${baseUrl}/words.txt`,
    '--sha256',
    `ok=${sourceHash}`,
    '--url',
    `bad=${baseUrl}/missing.txt`,
    '--lang',
    'test',
    '--dir',
    tempRoot,
    '--force'
  ],
  { cwd: root }
);

server.close();

if (result.code === 0) {
  console.error('download-dicts partial failure test failed: expected non-zero exit code.');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(1);
}

const okPath = path.join(tempRoot, 'ok.txt');
if (!fs.existsSync(okPath)) {
  console.error(`download-dicts partial failure test failed: missing ${okPath}`);
  process.exit(1);
}
const okContents = await fsPromises.readFile(okPath, 'utf8');
if (!okContents.includes('alpha')) {
  console.error('download-dicts partial failure test failed: downloaded content mismatch.');
  process.exit(1);
}

const manifestPath = path.join(tempRoot, 'dictionaries.json');
if (!fs.existsSync(manifestPath)) {
  console.error('download-dicts partial failure test failed: manifest missing.');
  process.exit(1);
}
const manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
if (!manifest.ok || manifest.bad) {
  console.error('download-dicts partial failure test failed: unexpected manifest entries.');
  process.exit(1);
}

console.log('download-dicts partial failure exit-code test passed');
