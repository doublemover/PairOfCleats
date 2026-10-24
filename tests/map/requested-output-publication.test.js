import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publishMapOutput } from '../../tools/reports/map-output-publication.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-map-publication-'));
try {
  const target = path.join(root, 'existing 日本語.html');
  await fs.writeFile(target, 'previous-valid-output');
  const failed = await publishMapOutput({ kind: 'report', target, content: 'replacement',
    write: async () => { throw Object.assign(new Error('injected rename refusal'), { code: 'EACCES' }); } });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'EACCES');
  assert.equal(await fs.readFile(target, 'utf8'), 'previous-valid-output');
  const directory = await publishMapOutput({ kind: 'model', target: root, content: '{}' });
  assert.equal(directory.ok, false);
  const success = await publishMapOutput({ kind: 'report', target, content: 'replacement' });
  assert.equal(success.ok, true);
  assert.equal(success.bytes, 11);
  assert.match(success.sha256, /^[a-f0-9]{64}$/);
  assert.equal(await fs.readFile(target, 'utf8'), 'replacement');
  assert.deepEqual((await fs.readdir(root)).sort(), ['existing 日本語.html']);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Requested map outputs retain per-deliverable truth and preserve prior artifacts on failure.');
