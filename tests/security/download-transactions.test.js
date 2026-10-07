import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import tar from 'tar-stream';
import { zipSync } from 'fflate';
import { applyTestEnv } from '../helpers/test-env.js';

const root = process.cwd();
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-download-txn-'));
const repo = path.join(tmp, 'repo');
await fs.mkdir(repo);
await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({ security: { archives: { maxEntries: 3 } } }));
const pack = tar.pack();
const chunks = [];
pack.on('data', (chunk) => chunks.push(chunk));
const tarReady = new Promise((resolve) => pack.on('end', resolve));
for (let i = 0; i < 8; i += 1) pack.entry({ name: `directory-${i}/`, type: 'directory' });
pack.finalize();
await tarReady;
const archive = Buffer.concat(chunks);
const deepName = `${'segment/'.repeat(65)}fixture`;
const deepPack = tar.pack();
const deepChunks = [];
deepPack.on('data', (chunk) => deepChunks.push(chunk));
const deepReady = new Promise((resolve) => deepPack.on('end', resolve));
deepPack.entry({ name: deepName, type: 'directory' });
deepPack.finalize();
await deepReady;
const deepTar = Buffer.concat(deepChunks);
const deepZip = Buffer.from(zipSync({ [deepName]: Buffer.from('inert fixture') }));
const native = Buffer.from('inert native fixture bytes, never loaded');
let requests = 0;
const server = http.createServer((req, res) => {
  requests += 1;
  const bodies = { '/directories.tar': archive, '/deep.tar': deepTar, '/deep.zip': deepZip };
  res.end(bodies[req.url] || native);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const run = (label, url, sha256 = null) => new Promise((resolve, reject) => {
  const args = [path.join(root, 'tools/download/extensions.js'), '--repo', repo,
    '--dir', path.join(tmp, label), '--url', `fixture=${url}`, '--force'];
  if (sha256) args.push('--sha256', `fixture=${sha256}`);
  const child = spawn(process.execPath, args, { cwd: root, env: {
    ...applyTestEnv({ syncProcess: false, testConfig: null }),
    PAIROFCLEATS_ALLOW_LOCAL_DOWNLOADS: '1', PAIROFCLEATS_EMBEDDINGS: 'off'
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (value) => { output += value; });
  child.stderr.on('data', (value) => { output += value; });
  child.on('error', reject);
  child.on('close', (code) => resolve({ code, output }));
});
try {
  const unsigned = await run('unsigned', `${base}/native`);
  assert.equal(unsigned.code, 1);
  assert.match(unsigned.output, /SHA256/);
  assert.equal(requests, 0, 'unsigned native bytes must be rejected before connecting');
  const limited = await run('limited', `${base}/directories.tar`, digest(archive));
  assert.equal(limited.code, 1);
  assert.match(limited.output, /entry limit/);
  assert.deepEqual(await fs.readdir(path.join(tmp, 'limited', '.tmp')), [], 'failed extraction must leave no transaction tree/archive');
  for (const [kind, bytes] of [['tar', deepTar], ['zip', deepZip]]) {
    const deep = await run(`deep-${kind}`, `${base}/deep.${kind}`, digest(bytes));
    assert.equal(deep.code, 1);
    assert.match(deep.output, /path length\/depth/);
    assert.deepEqual(await fs.readdir(path.join(tmp, `deep-${kind}`, '.tmp')), [], 'depth rejection must retain promise-based cleanup');
  }
  const installed = await run('verified', `${base}/native`, digest(native));
  assert.equal(installed.code, 0, installed.output);
  const manifest = JSON.parse(await fs.readFile(path.join(tmp, 'verified', 'extensions.json')));
  const record = manifest[`sqlite-vec:${process.platform}-${process.arch}`];
  assert.equal(record.verified, true);
  assert.equal(record.outputSha256, digest(native));
  assert.equal(record.sha256, digest(native));
  assert.deepEqual(await fs.readdir(path.join(tmp, 'verified', '.tmp')), []);
  console.log('unsigned refusal, directory entry limits and atomic download cleanup passed');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmp, { recursive: true, force: true });
}
