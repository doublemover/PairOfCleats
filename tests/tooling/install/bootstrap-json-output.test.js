// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { runBootstrap } from '../../../tools/setup/bootstrap.js';
import { runSetupCommand } from '../../../tools/setup/owned-command.js';
import { createStdoutGuard } from '../../../src/shared/cli/stdout-guard.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';

const scratch = await makeTempDir('bootstrap-json-target-');
const target = path.join(scratch, 'nested project');
try {
  await fs.mkdir(path.join(target, 'ci-artifacts'), { recursive: true });
  await fs.writeFile(path.join(target, '.pairofcleats.json'), '{}');
  await fs.writeFile(path.join(target, 'ci-artifacts', 'manifest.json'), '{}');
  const selectedRoot = toRealPathSync(target);
  await withTemporaryEnv({ PAIROFCLEATS_TESTING: '1', PAIROFCLEATS_CACHE_ROOT: path.join(scratch, 'cache'),
    PAIROFCLEATS_HOME: path.join(scratch, 'home'), PAIROFCLEATS_TEST_CONFIG: '', PAIROFCLEATS_TRUSTED_CONFIG: '',
    PAIROFCLEATS_TRUSTED_REPOS: '' }, async () => {
    const calls = [], progress = [], logs = [];
    const result = await runBootstrap({ repo: target, json: true, 'skip-dicts': true, 'skip-tooling': true,
      'with-sqlite': true, 'validate-config': true }, { log: text => logs.push(text), writeProgress: text => progress.push(text),
      command: async (_command, args, options) => {
        calls.push(args);
        assert.equal(options.cwd, selectedRoot);
        assert.equal(options.captureStdout, false);
        assert.equal(options.captureStderr, false);
        options.onStdout('fixture child progress');
        options.onStderr('fixture child diagnostic');
        // A normal restore failure permits the already-authorized fresh build.
        return { ok: !args[0].endsWith('restore-artifacts.js'), status: args[0].endsWith('restore-artifacts.js') ? 1 : 0 };
      } });
    assert.equal(result.exitCode, 0, JSON.stringify(result.summary.errors));
    assert.equal(result.summary.steps.install.installed, false);
    assert.equal(result.summary.steps.index.built, true);
    assert.equal(result.summary.steps.sqlite.built, true);
    assert.equal(calls.length, 3, 'normal core build owns SQLite without a duplicate Stage4 child');
    assert.ok(calls.find(args => args[0].endsWith('build_index.js')).includes('--sqlite'));
    assert.equal(calls.some(args => args.includes('--stage')), false);
    for (const args of calls.filter(args => !args[0].endsWith('validate.js'))) {
      assert.equal(args[args.indexOf('--repo') + 1], selectedRoot, 'every target child keeps the explicit selected folder');
    }
    assert.equal(progress.length, 6);
    assert.ok(logs.some(text => text.includes('[bootstrap]')));
    const writes = [];
    createStdoutGuard({ enabled: true, stream: { write: text => writes.push(text) } }).writeJson(result.summary);
    assert.equal(writes.length, 1);
    assert.equal(JSON.parse(writes[0]).root, selectedRoot);
    assert.ok(!writes[0].includes('fixture child progress'));

    // Retain the real CLI stdout/stderr smoke. Target package scripts are not
    // bootstrap work, so no fake npm package or target node_modules is used.
    const cli = runNode([path.join(process.cwd(), 'tools', 'setup', 'bootstrap.js'), '--repo', target,
      '--skip-dicts', '--skip-tooling', '--skip-index', '--skip-artifacts', '--json'],
    'bootstrap JSON CLI smoke', target, { ...process.env }, { stdio: 'pipe', spawnOptions: { maxBuffer: 256 * 1024 } });
    const cliSummary = JSON.parse(cli.stdout);
    assert.equal(cliSummary.root, selectedRoot);
    assert.equal(cliSummary.steps.install.installed, false);
    assert.ok(cli.stderr.includes('[bootstrap]'));
    assert.ok(!cli.stdout.includes('Bootstrap complete.'));

    // Exercise the actual async streaming adapter separately with bounded
    // parent retention. A small Node child writes more than the capture cap;
    // count bytes and retain only the suffix needed to prove the tail arrived.
    const marker = 'BOOTSTRAP_STREAM_TAIL';
    const payloadBytes = 1_200_000;
    let streamedBytes = 0;
    let suffix = '';
    const streamed = await runSetupCommand(process.execPath,
      ['-e', `process.stdout.write('X'.repeat(${payloadBytes}));process.stdout.write('${marker}');`],
      { cwd: target, stdio: ['ignore', 'pipe', 'pipe'], timeoutMs: 5000,
        captureStdout: false, captureStderr: false,
        onStdout: chunk => { streamedBytes += Buffer.byteLength(chunk); suffix = (suffix + chunk).slice(-marker.length); } });
    assert.equal(streamed.ok, true);
    assert.equal(streamed.stdout, '');
    assert.equal(streamedBytes, payloadBytes + marker.length);
    assert.equal(suffix, marker, 'streaming preserves the actual child tail beyond one MiB without retaining its full output');
  });
} finally { await rmDirRecursive(scratch); }
console.log('Bootstrap keeps one JSON summary and explicitly binds every restore/build child to its target.');
