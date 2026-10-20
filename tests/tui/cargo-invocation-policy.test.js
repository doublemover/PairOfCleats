import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveCargoCommandInvocation } from '../../tools/tui/targets.js';
import { stageBuiltArtifact } from '../../tools/tui/build-support.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { runNode } from '../helpers/run-node.js';

const root = process.cwd();
const pin = (await fs.readFile(path.join(root, 'crates/pairofcleats-tui/rust-toolchain.toml'), 'utf8'))
  .match(/^channel = "([^"]+)"$/m)?.[1];
assert.match(pin, /^\d+\.\d+\.\d+$/);
assert.deepEqual(resolveCargoCommandInvocation({ RUSTUP_TOOLCHAIN: 'stable' }),
  { command: 'cargo', args: [`+${pin}`] }, 'Root-level invocations select the canonical compiler explicitly');

const { dir } = await prepareIsolatedTestCacheDir('tui-cargo-invocation-policy');
const invalidRoot = path.join(dir, 'invalid-source');
const invalidPin = path.join(invalidRoot, 'crates/pairofcleats-tui/rust-toolchain.toml');
await fs.mkdir(path.dirname(invalidPin), { recursive: true });
for (const value of ['stable', 'nightly', '1.88', '1.88.0;unexpected']) {
  await fs.writeFile(invalidPin, `[toolchain]\nchannel = "${value}"\n`);
  assert.throws(() => resolveCargoCommandInvocation({}, invalidRoot), /exact stable Rust toolchain/);
}
await fs.rm(invalidPin);
assert.throws(() => resolveCargoCommandInvocation({}, invalidRoot), { code: 'ENOENT' });
const command = path.join(dir, 'explicit-cargo-fixture.mjs');
const calls = path.join(dir, 'cargo-calls.jsonl');
const targetDir = path.join(dir, 'target');
const dist = path.join(dir, 'dist');
await fs.mkdir(dist);
await fs.writeFile(command, `
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.POC_FIXTURE_CARGO_CALLS, JSON.stringify(args) + '\\n');
if (!args.includes('--locked')) throw new Error('fixture requires locked dependency resolution');
if (args[0] === 'build') {
  const triple = args[args.indexOf('--target') + 1];
  const binary = path.join(process.env.CARGO_TARGET_DIR, triple, 'release', 'pairofcleats-tui.exe');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, 'explicit invocation fixture; not a qualified native executable');
}
`);
// Explicit process-level fixture command. This checks argv/staging contracts;
// native compiler and terminal qualification execute separately.
const env = applyTestEnv({ extraEnv: { PAIROFCLEATS_TUI_CARGO: command,
  CARGO_TARGET_DIR: targetDir, POC_FIXTURE_CARGO_CALLS: calls } });
assert.deepEqual(resolveCargoCommandInvocation(env), { command: process.execPath, args: [command] });
const staged = await stageBuiltArtifact({ rootDir: root,
  target: { triple: 'x86_64-pc-windows-msvc', artifactName: 'fixture-tui.exe' }, distDirectory: dist, env });
assert.equal(await fs.readFile(staged, 'utf8'), 'explicit invocation fixture; not a qualified native executable');
runNode([path.join(root, 'tools/tui/capture-fixtures.js'), '--fixture',
  path.join(root, 'tests/tui/fixtures/navigation-scroll.json'), '--out-dir', path.join(dir, 'capture')],
'explicit capture invocation fixture', root, env, { stdio: 'pipe', timeoutMs: 30000 });
const recorded = (await fs.readFile(calls, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line));
assert.equal(recorded.length, 2);
assert.equal(recorded[0][0], 'build');
assert.equal(recorded[1][0], 'run');
for (const args of recorded) {
  assert.equal(args.filter(arg => arg === '--locked').length, 1);
  assert.equal(args[args.indexOf('--manifest-path') + 1], path.join(root, 'crates/pairofcleats-tui/Cargo.toml'));
}
console.log('Default Cargo selects the canonical pin; explicit build/capture fixture commands both retain locked resolution.');
