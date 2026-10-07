#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { runNode } from '../../helpers/run-node.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { withStagedIngestOutput, writeLine } from '../../../tools/ingest/shared.js';
import { runLineStreamingCommand } from '../../../tools/ingest/shared-runner.js';

ensureTestingEnv(process.env);
const root = process.cwd();
const temp = resolveTestCachePath(root, 'ingest-output-preservation');
await fs.rm(temp, { recursive: true, force: true });
await fs.mkdir(temp, { recursive: true });
const cli = path.join(root, 'bin/pairofcleats.js');
const repo = path.join(root, 'tests/fixtures/sample');
const original = 'previous successful output\n';
const originalMeta = '{"previous":"successful summary"}\n';
const fixtures = { ctags: 'tags.jsonl', gtags: 'gtags.txt', lsif: 'dump.lsif', scip: 'index.json' };

const invoke = (kind, args, expected) => {
  const result = runNode([cli, 'ingest', kind, '--repo', repo, '--json', ...args],
    `${kind} output preservation`, root, process.env,
    { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, expected, result.stderr);
  assert.equal(result.stderr.includes("Unhandled 'error' event"), false);
  return result;
};

for (const [kind, fixture] of Object.entries(fixtures)) {
  const output = path.join(temp, `${kind}.jsonl`);
  const meta = `${output}.meta.json`;
  await fs.writeFile(output, original);
  await fs.writeFile(meta, originalMeta);
  const failed = invoke(kind, ['--input', path.join(temp, 'missing'), '--out', output], 1);
  assert.equal(failed.stdout.trim(), '', 'a failed ingest must not emit a success report');
  assert.equal(await fs.readFile(output, 'utf8'), original);
  assert.equal(await fs.readFile(meta, 'utf8'), originalMeta);
  if (kind !== 'lsif') {
    const flag = kind === 'gtags' ? '--global' : `--${kind}`;
    invoke(kind, ['--run', flag, path.join(temp, 'missing-command'), '--out', output], 1);
    assert.equal(await fs.readFile(output, 'utf8'), original);
    assert.equal(await fs.readFile(meta, 'utf8'), originalMeta);
  }
  const fresh = path.join(temp, `${kind}-fresh.jsonl`);
  invoke(kind, ['--input', path.join(temp, 'missing'), '--out', fresh], 1);
  await assert.rejects(fs.stat(fresh), { code: 'ENOENT' });
  await assert.rejects(fs.stat(`${fresh}.meta.json`), { code: 'ENOENT' });

  // Aliasing input/output is safe because publication waits for input completion.
  await fs.copyFile(path.join(root, 'tests/fixtures', kind, fixture), output);
  const success = invoke(kind, ['--input', output, '--out', output], 0);
  const rows = (await fs.readFile(output, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(rows.length > 0 && rows.every(row => row.file), `${kind} must retain real ingested rows`);
  assert.deepEqual(JSON.parse(success.stdout), JSON.parse(await fs.readFile(meta, 'utf8')));
  assert.notEqual(await fs.readFile(meta, 'utf8'), originalMeta);
}

const output = path.join(temp, 'streamed.jsonl');
await fs.writeFile(output, original);
await assert.rejects(withStagedIngestOutput(output, async stream => {
  await runLineStreamingCommand({ command: process.execPath,
    args: ['-e', 'console.log("partial row"); process.exitCode=7;'],
    onStdoutLine: line => writeLine(stream, `${line}\n`)
  });
}), error => error.code === 'ERR_INGEST_COMMAND_EXIT' && error.exitCode === 7);
assert.equal(await fs.readFile(output, 'utf8'), original, 'failed producers must not publish partial rows');

const diskFailure = new Error('simulated output failure');
await assert.rejects(withStagedIngestOutput(output, async stream => {
  stream.destroy(diskFailure);
}), error => error === diskFailure);
assert.equal(await fs.readFile(output, 'utf8'), original);

const directoryTarget = path.join(temp, 'directory-target');
await fs.mkdir(directoryTarget);
await assert.rejects(withStagedIngestOutput(directoryTarget, stream => writeLine(stream, 'row\n')));
assert.ok((await fs.stat(directoryTarget)).isDirectory());

if (process.platform !== 'win32') {
  const restrictedOutput = path.join(temp, 'restricted.jsonl');
  await fs.writeFile(restrictedOutput, original, { mode: 0o600 });
  await withStagedIngestOutput(restrictedOutput, stream => writeLine(stream, 'replacement\n'));
  assert.equal((await fs.stat(restrictedOutput)).mode & 0o777, 0o600,
    'replacing a private output must not broaden its permissions');
  if (process.getuid?.() !== 0) {
    const readOnlyOutput = path.join(temp, 'readonly.jsonl');
    await fs.writeFile(readOnlyOutput, original, { mode: 0o400 });
    await assert.rejects(withStagedIngestOutput(readOnlyOutput, () => {
      assert.fail('readonly output must fail before consuming input');
    }), error => error.code === 'EACCES' || error.code === 'EPERM');
    assert.equal(await fs.readFile(readOnlyOutput, 'utf8'), original);
  }
  const moduleUrl = pathToFileURL(path.join(root, 'tools/ingest/shared.js')).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import {withStagedIngestOutput,writeLine} from ${JSON.stringify(moduleUrl)};
     await withStagedIngestOutput(${JSON.stringify(output)}, async stream => {
       await writeLine(stream, 'incomplete row\\n'); console.log('ready');
       await new Promise(() => { setInterval(() => {}, 1000); });
     });`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  let killTimer;
  try {
    await Promise.race([new Promise(resolve => child.stdout.once('data', resolve)),
      new Promise((_, reject) => { killTimer = setTimeout(() => reject(new Error('cancel fixture not ready')), 5000); })]);
    child.kill('SIGTERM');
    const result = await closed;
    assert.equal(result.code, 143);
    assert.equal(await fs.readFile(output, 'utf8'), original);
  } finally { clearTimeout(killTimer); child.kill('SIGKILL'); }
}
assert.ok((await fs.readdir(temp)).every(name => !name.includes('.tmp-')), 'owned staging files must be cleaned');
console.log('Ingest failures preserve old output and summaries; successful in-place input and cancellation are safe.');
