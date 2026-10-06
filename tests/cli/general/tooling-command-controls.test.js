#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { describeCommandRegistryEntry } from '../../../src/shared/command-registry-query.js';

const root = process.cwd();
const bin = path.join(root, 'bin', 'pairofcleats.js');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-tooling-cli-controls-'));
const repo = path.join(temp, 'repo');
await fs.mkdir(repo);
await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({
  indexing: { scm: { provider: 'none' }, typeInference: false },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
}));
const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(temp, 'cache') });
const run = (args) => runNode([bin, ...args], args.join(' '), root, env, {
  stdio: 'pipe', allowFailure: true, timeoutMs: 10000
});

try {
  for (const flags of [['--non-strict'], ['--strict=false'], []]) {
    const result = run(['tooling', 'doctor', '--repo', repo, '--json', ...flags]);
    assert.equal(result.status, 0, `doctor ${flags.join(' ')}: ${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.equal(report.repoRoot, repo);
    assert.ok(Array.isArray(report.providers));
  }
  const conflicting = run(['tooling', 'doctor', '--strict', '--non-strict', '--repo', repo]);
  assert.equal(conflicting.status, 1);
  assert.match(conflicting.stderr, /Choose either --strict or --non-strict/);
  for (const flag of ['--help', '-h']) {
    const help = run(['tooling', 'navigate', flag]);
    assert.equal(help.status, 0, `navigate ${flag}: ${help.stderr}`);
    assert.match(help.stderr + help.stdout, /Usage: pairofcleats tooling navigate/);
  }
  const missingKind = run(['tooling', 'navigate', '--repo', repo]);
  assert.equal(missingKind.status, 1, 'missing required navigation kind must still fail');
  for (const id of ['context-pack', 'impact']) {
    const example = describeCommandRegistryEntry(id).helpExamples[0];
    const args = example.split(/\s+/).slice(1);
    args[args.indexOf('--repo') + 1] = repo;
    const result = run([...args, '--json']);
    assert.equal(result.status, 1, 'an unindexed fixture must still fail');
    const payload = JSON.parse(result.stdout);
    assert.match(payload.message, /Code index not found/, `${id} example must reach index admission`);
  }
  console.log('Tooling CLI strictness opt-out, explicit conflict and help controls passed.');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
