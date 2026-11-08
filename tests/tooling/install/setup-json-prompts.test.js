import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('setup-json-prompts');
await fs.writeFile(path.join(dir, '.pairofcleats.json'), '{}');
const prompt = 'Validate .pairofcleats.json now? [Y/n] ';
const run = (json, interactive) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.resolve('tools/setup/setup.js'), '--root', dir,
    '--skip-install', '--skip-dicts', '--skip-models', '--skip-extensions', '--skip-tooling',
    '--skip-index', '--skip-sqlite', '--skip-artifacts', ...(json ? ['--json'] : []),
    ...(interactive ? [] : ['--non-interactive'])], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, 'cache'),
      extraEnv: { PAIROFCLEATS_HOME: path.join(dir, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null } })
  });
  let stdout = '', stderr = '', answered = false;
  const timer = setTimeout(() => { child.kill(); reject(new Error('Setup prompt fixture exceeded 8 seconds')); }, 8000);
  const collect = (stream, chunk) => {
    if (stream === 'stdout') stdout += chunk;
    else stderr += chunk;
    if (interactive && !answered && (stdout.includes(prompt) || stderr.includes(prompt))) {
      answered = true;
      child.stdin.write('n\n');
    }
  };
  child.stdout.on('data', chunk => collect('stdout', chunk.toString()));
  child.stderr.on('data', chunk => collect('stderr', chunk.toString()));
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, answered }); });
});
try {
  const interactiveJson = await run(true, true);
  assert.equal(interactiveJson.code, 0, interactiveJson.stderr);
  assert.equal(interactiveJson.answered, true, 'JSON mode still asks and consumes a real answer');
  const summary = JSON.parse(interactiveJson.stdout);
  assert.equal(summary.nonInteractive, false);
  assert.equal(summary.steps.config.skipped, true, 'negative answer is honored');
  assert.ok(interactiveJson.stderr.includes(prompt), 'JSON prompts remain visible on stderr');
  const ordinary = await run(false, true);
  assert.equal(ordinary.code, 0, ordinary.stderr);
  assert.equal(ordinary.answered, true);
  assert.ok(ordinary.stdout.includes(prompt));
  const unattended = await run(true, false);
  assert.equal(unattended.code, 0, unattended.stderr);
  assert.equal(JSON.parse(unattended.stdout).nonInteractive, true);
  assert.equal(unattended.answered, false);
  assert.ok(!unattended.stderr.includes(prompt));
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Interactive setup preserves prompts and answers while emitting one JSON stdout value');
