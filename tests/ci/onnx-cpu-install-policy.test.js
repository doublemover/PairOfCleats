#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const root = process.cwd();
const require = createRequire(import.meta.url);
const workflowDir = path.join(root, '.github/workflows');
let installJobs = 0;
for (const name of await fs.readdir(workflowDir)) {
  if (!/\.ya?ml$/.test(name)) continue;
  const workflow = parse(await fs.readFile(path.join(workflowDir, name), 'utf8'));
  for (const [id, job] of Object.entries(workflow.jobs || {})) {
    for (const step of job.steps || []) {
      if (!/npm (?:run bootstrap:ci|ci|install)|rebuild-native\.js/.test(step.run || '')) continue;
      const env = { ...workflow.env, ...job.env, ...step.env };
      assert.equal(env.ONNXRUNTIME_NODE_INSTALL, 'skip', `${name}:${id} must skip unneeded GPU downloads`);
      const runners = job['runs-on'] === '${{ matrix.os }}'
        ? job.strategy.matrix.os || job.strategy.matrix.include.map(entry => entry.os)
        : [job['runs-on']];
      assert.ok(runners.every(runner => ['ubuntu-latest', 'windows-latest', 'macos-latest'].includes(runner)),
        `${name}:${id} needs an explicit GPU installation policy if the runner changes`);
      installJobs += 1;
    }
  }
}
assert.equal(installJobs, 15, 'cover main CI, CI-long, nightly and all release bootstrap jobs');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
assert.ok(manifest.dependencies['onnxruntime-node']);
assert.match(manifest.scripts['bootstrap:ci'], /tools\/setup\/rebuild-native\.js/);
const rebuild = await fs.readFile(path.join(root, 'tools/setup/rebuild-native.js'), 'utf8');
assert.match(rebuild, /const REQUIRED_NATIVE_PACKAGES = \[[\s\S]*?'onnxruntime-node'/,
  'CPU ONNX remains a required native dependency');

// Run the actual locked vendor installer with networking forbidden. The supported
// skip setting must exit before any supplemental CUDA/TensorRT download begins.
const packageRoot = path.dirname(require.resolve('onnxruntime-node/package.json'));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-onnx-cpu-install-'));
try {
  const forbidNetwork = path.join(temp, 'forbid-network.cjs');
  await fs.writeFile(forbidNetwork, "require('node:net').Socket.prototype.connect = function () { throw new Error('Unexpected ONNX installer network access'); };\n");
  const env = { ...process.env, ONNXRUNTIME_NODE_INSTALL: 'skip' };
  const install = spawnSync(process.execPath, ['--require', forbidNetwork, path.join(packageRoot, 'script/install.js')],
    { cwd: temp, env, encoding: 'utf8', timeout: 5000 });
  assert.equal(install.error, undefined, install.error?.message);
  assert.equal(install.status, 0, install.stderr);
  assert.doesNotMatch(`${install.stdout}${install.stderr}`, /Downloading|Unexpected ONNX installer network access/);

  // A tiny model proves the bundled native CPU runtime still executes inference.
  // This is an ONNX Identity graph, IR v8/opset v13, one float input/output.
  const bytes = value => Buffer.from(value);
  const field = (number, value) => Buffer.concat([bytes([(number << 3) | 2, value.length]), value]);
  const text = (number, value) => field(number, bytes(value));
  const scalar = (number, value) => bytes([number << 3, value]);
  const tensorType = field(1, Buffer.concat([scalar(1, 1), field(2, field(1, scalar(1, 1)))]));
  const info = name => Buffer.concat([text(1, name), field(2, tensorType)]);
  const node = Buffer.concat([text(1, 'x'), text(2, 'y'), text(4, 'Identity')]);
  const graph = Buffer.concat([field(1, node), text(2, 'poc_cpu'), field(11, info('x')), field(12, info('y'))]);
  const model = Buffer.concat([scalar(1, 8), text(2, 'poc'), field(7, graph), field(8, scalar(2, 13))]);
  const ort = await import('onnxruntime-node');
  const session = await ort.InferenceSession.create(model, {
    executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1
  });
  try {
    const result = await session.run({ x: new ort.Tensor('float32', Float32Array.of(7), [1]) });
    assert.deepEqual(Array.from(result.y.data), [7]);
  } finally { await session.release(); }
  console.log(`ONNX CPU installation policy covers ${installJobs} jobs; vendor skip makes no network request and native CPU inference succeeds.`);
} finally { await fs.rm(temp, { recursive: true, force: true }); }
