import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { attachSilentLogging } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixturesRoot = path.join(root, 'tests', 'fixtures', 'dicts');

export async function setupDownloadDictsTest(cacheName) {
  const tempRoot = resolveTestCachePath(root, cacheName);
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

  return { tempRoot, sourceFile, sourceHash };
}

export async function startWordsServer(sourceFile) {
  const server = http.createServer((req, res) => {
    if (req.url !== '/words.txt' || !fs.existsSync(sourceFile)) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.statusCode = 200;
    fs.createReadStream(sourceFile).pipe(res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    url: `${baseUrl}/words.txt`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    })
  };
}

export function runDownloadDicts(args, { logName }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'tools', 'download', 'dicts.js'), ...args], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });
    attachSilentLogging(child, logName);
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

export async function assertFileIncludes(filePath, expected, { missingMessage, mismatchMessage }) {
  if (!fs.existsSync(filePath)) {
    console.error(missingMessage);
    process.exit(1);
  }
  const contents = await fsPromises.readFile(filePath, 'utf8');
  if (!contents.includes(expected)) {
    console.error(mismatchMessage);
    process.exit(1);
  }
}

export async function readRequiredJson(filePath, missingMessage) {
  if (!fs.existsSync(filePath)) {
    console.error(missingMessage);
    process.exit(1);
  }
  return JSON.parse(await fsPromises.readFile(filePath, 'utf8'));
}
