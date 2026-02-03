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
const tempRoot = path.join(root, '.testCache', 'download-dicts');

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
  const filePath = sourceFile;
  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  res.statusCode = 200;
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const url = `http://127.0.0.1:${port}/words.txt`;

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env || process.env
    });
    attachSilentLogging(child, 'download-dicts');
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
}

const result = await run(
  process.execPath,
  [
    path.join(root, 'tools', 'download', 'dicts.js'),
    '--url',
    `test=${url}`,
    '--sha256',
    `test=${sourceHash}`,
    '--lang',
    'test',
    '--dir',
    tempRoot,
    '--force'
  ],
  { cwd: root }
);

server.close();

if (result.code !== 0) {
  console.error('download-dicts test failed: script error.');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.code ?? 1);
}

const dictPath = path.join(tempRoot, 'test.txt');
if (!fs.existsSync(dictPath)) {
  console.error(`download-dicts test failed: missing ${dictPath}`);
  process.exit(1);
}
const contents = await fsPromises.readFile(dictPath, 'utf8');
if (!contents.includes('alpha')) {
  console.error('download-dicts test failed: content mismatch.');
  process.exit(1);
}

const manifestPath = path.join(tempRoot, 'dictionaries.json');
if (!fs.existsSync(manifestPath)) {
  console.error('download-dicts test failed: manifest missing.');
  process.exit(1);
}
const manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
if (!manifest.test || manifest.test.url !== url || manifest.test.file !== 'test.txt') {
  console.error('download-dicts test failed: manifest entry mismatch.');
  process.exit(1);
}
if (manifest.test.sha256 !== sourceHash || manifest.test.verified !== true) {
  console.error('download-dicts test failed: hash verification missing.');
  process.exit(1);
}

console.log('download-dicts test passed');

