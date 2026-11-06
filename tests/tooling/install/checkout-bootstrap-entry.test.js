import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runCheckoutBootstrap } from '../../../tools/setup/checkout-bootstrap.js';
import { parseCheckoutBootstrapArguments, parseNativeRebuildArguments } from '../../../tools/setup/checkout-bootstrap-arguments.js';
import { BOOTSTRAP_INPUTS } from '../../../src/shared/bootstrap-readiness.js';
import { makeTempDir } from '../../helpers/temp.js';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { copyBootstrapMetadataSources } from '../../helpers/bootstrap-metadata-sources.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/checkout-bootstrap-entry/')[1];
assert.ok(['strict-arguments', 'dependency-free-information', 'ordered-stages', 'prepared-and-resolution', 'failure-and-cancellation', 'captured-context'].includes(mode));
const calls = [], messages = [];
const fixtureRoot = await makeTempDir('checkout-bootstrap-entry-');
try {
  const base = { root: fixtureRoot, env: {}, captureInputs: () => [['fixture-input', 'source-digest']],
    inspect: async () => ({ ready: false, reason: 'fixture not prepared' }), progress: message => messages.push(message),
    command: async (command, args, options) => { calls.push({ command, args, options }); return { ok: true, status: 0, signal: null }; } };
  if (mode === 'strict-arguments') {
    for (const policy of ['locked', 'resolve']) {
      assert.equal(parseCheckoutBootstrapArguments([policy]).mode, 'prepare');
      for (const flag of ['--help', '--plan', '--status', '--verify', '--repair']) assert.equal(parseCheckoutBootstrapArguments([policy, flag]).mode, flag.slice(2));
      for (const flags of [['--wat'], ['--verify', '--repair'], ['--help', '--repair'], ['--help', '--wat'], ['--plan', '--plan'], ['--json'], ['--yes'], ['--apply']]) {
        await assert.rejects(runCheckoutBootstrap([policy, ...flags], { ...base, inspect() { assert.fail('Arguments must precede inspection'); },
          captureInputs() { assert.fail('Arguments must precede input reads'); } }), { code: 'ERR_CHECKOUT_BOOTSTRAP_ARGUMENTS' });
      }
    }
    for (const flags of [['--wat'], ['--verify', '--repair'], ['--help', '--verify'], ['--help', '--wat'], ['--verify', '--verify']]) {
      assert.throws(() => parseNativeRebuildArguments(flags), { code: 'ERR_CHECKOUT_BOOTSTRAP_ARGUMENTS' });
    }
    assert.deepEqual(parseNativeRebuildArguments(['--verify']), { help: false, verifyOnly: true, repairOnly: false });
    assert.equal(calls.length, 0);
  } else if (mode === 'dependency-free-information') {
    const root = await makeTempDir('checkout-bootstrap-information-');
    try {
      const sources = new Set([...BOOTSTRAP_INPUTS, 'tools/setup/rebuild-native-exit.js', 'src/shared/error-data.js']);
      for (const relative of sources) {
        const target = path.join(root, relative); await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(path.resolve(relative), target);
      }
      copyBootstrapMetadataSources(process.cwd(), root, ['src/shared/bootstrap-readiness.js']);
      const inventory = async () => {
        const result = [];
        const visit = async relative => {
          for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
            const child = path.join(relative, entry.name);
            if (entry.isDirectory()) await visit(child);
            else result.push([child, createHash('sha256').update(await fs.readFile(path.join(root, child))).digest('hex')]);
          }
        };
        await visit(''); return result.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      };
      const before = await inventory(), manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
      for (const name of ['bootstrap', 'bootstrap:ci']) {
        const [, entry, policy] = manifest.scripts[name].split(' ');
        for (const flags of [['--help'], ['--plan', '--json'], ['--status', '--json'], ['--mistyped'], ['--verify', '--repair']]) {
          const child = runNode([path.join(root, entry), policy, ...flags], 'dependency-free checkout entry', root,
            { ...process.env, PATH: '', Path: '' }, { allowFailure: true, stdio: 'pipe', timeoutMs: 5000 });
          assert.equal(child.status, flags[0] === '--status' ? 1 : flags[0] === '--mistyped' || flags[1] === '--repair' ? 2 : 0, child.stderr);
          assert.doesNotMatch(child.stderr, /ERR_MODULE_NOT_FOUND|\[bootstrap\] started/);
          if (flags.includes('--json')) {
            const report = JSON.parse(child.stdout); assert.equal(await fs.realpath(report.root), await fs.realpath(root));
            assert.equal(report.prerequisites.startsWith('not-probed'), true); assert.equal(report.targetProvisioning, 'none');
          }
          assert.deepEqual(await inventory(), before, 'information and invalid invocations mutate no checkout file');
        }
      }
      await assert.rejects(fs.stat(path.join(root, 'node_modules')), { code: 'ENOENT' });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  } else if (mode === 'ordered-stages') {
    const result = await runCheckoutBootstrap(['locked'], base);
    assert.deepEqual(result.plan.stages.map(row => row.id), ['prerequisites', 'dependencies', 'patches', 'native-preparation']);
    assert.equal(calls[0].args[0], path.join(base.root, 'tools/setup/preflight.js'));
    assert.deepEqual(calls[1].args, ['ci', '--include=dev', '--ignore-scripts']);
    assert.equal(calls[2].args[0], path.join(base.root, 'tools/setup/apply-patches.js'));
    assert.equal(calls[3].args[0], path.join(base.root, 'tools/setup/rebuild-native.js'));
    assert.ok(calls.every(row => row.options.cwd === base.root && row.options.windowsHide === true));
    assert.equal(result.plan.targetProvisioning, 'none'); assert.equal(messages.length, 8);
  } else if (mode === 'prepared-and-resolution') {
    const prepared = { ...base, inspect: async () => ({ ready: true }) };
    const noOp = await runCheckoutBootstrap(['locked'], prepared);
    assert.deepEqual(noOp.plan.stages.map(row => row.id), ['native-verification']); assert.equal(calls.length, 1);
    assert.equal(calls[0].args.at(-1), '--verify'); calls.length = 0;
    const resolve = await runCheckoutBootstrap(['resolve'], prepared);
    assert.equal(resolve.plan.stages.length, 4); assert.equal(calls[1].args[0], 'install'); calls.length = 0;
    const repair = await runCheckoutBootstrap(['locked', '--repair'], base);
    assert.deepEqual(repair.plan.stages.map(row => row.id), ['patches', 'native-preparation']); assert.equal(calls.at(-1).args.at(-1), '--repair');
  } else if (mode === 'failure-and-cancellation') {
    for (let failedAt = 0; failedAt < 4; failedAt++) {
      let count = 0;
      await assert.rejects(runCheckoutBootstrap(['locked'], { ...base, command: async () => ({ ok: count++ !== failedAt, status: 7, signal: null }) }),
        error => error.code === 'ERR_CHECKOUT_BOOTSTRAP_STAGE' && error.result.status === 7 && error.results.length === failedAt + 1);
      assert.equal(count, failedAt + 1);
    }
    for (const original of [false, null, new Error('original owner failure')]) {
      let count = 0, caught = false;
      try { await runCheckoutBootstrap(['locked'], { ...base, command: async () => { count++; throw original; } }); }
      catch (error) { caught = true; assert.equal(error, original); }
      assert.equal(caught, true); assert.equal(count, 1);
    }
    const controller = new AbortController(); let count = 0;
    await assert.rejects(runCheckoutBootstrap(['locked'], { ...base, signal: controller.signal,
      command: async () => { count++; controller.abort(); return { ok: true, status: 0, signal: null }; } }), { name: 'AbortError' });
    assert.equal(count, 1);
  } else {
    const env = { npm_execpath: path.resolve('.tmp/inert-npm-cli.js'), SELECTED_FIXTURE: 'original' };
    const result = await runCheckoutBootstrap(['locked'], { ...base, env, command: async (command, args, options) => {
      env.SELECTED_FIXTURE = 'changed'; assert.equal(options.env.SELECTED_FIXTURE, 'original');
      calls.push({ command, args }); return { ok: true, status: 0, signal: null };
    } });
    assert.equal(calls[1].command, process.execPath); assert.equal(calls[1].args[0], env.npm_execpath);
    assert.equal(result.plan.runtime.npmExecutable, env.npm_execpath); assert.equal(Object.isFrozen(result.plan), true);
    assert.equal(result.plan.stages.every(stage => Object.isFrozen(stage.args)), true);
    let source = 'admitted-source', ran = 0;
    await assert.rejects(runCheckoutBootstrap(['locked'], { ...base, captureInputs: () => [['setup.js', source]],
      command: async () => { ran++; source = 'changed-source'; return { ok: true, status: 0, signal: null }; }
    }), { code: 'ERR_CHECKOUT_BOOTSTRAP_INPUT_CHANGED' });
    assert.equal(ran, 1, 'changed setup inputs stop before a successor stage');
    let lock = 'original-lock'; ran = 0;
    const resolved = await runCheckoutBootstrap(['resolve'], { ...base, captureInputs: () => [['setup.js', 'same-source'], ['package-lock.json', lock]],
      command: async () => { ran++; if (ran === 2) lock = 'intended-resolved-lock'; return { ok: true, status: 0, signal: null }; }
    });
    assert.equal(resolved.exitCode, 0); assert.equal(ran, 4, 'explicit resolution admits its intended lockfile change');
  }
  console.log('Strict checkout entry preserves read-only information, canonical preparation stages and original failure boundaries');
} finally { await fs.rm(fixtureRoot, { recursive: true, force: true }); }
