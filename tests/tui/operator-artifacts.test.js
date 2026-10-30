import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { bindArtifactScope, createTuiArtifactRegistry } from '../../tools/tui/operator/artifact-registry.js';
import { createTuiArtifactActions } from '../../tools/tui/operator/artifacts.js';
import { assertTuiArtifactRequest } from '../../src/contracts/validators/tui-artifact.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';
import { normalizeEnvPathKeys } from '../../src/shared/env-path.js';
import { resolveTrustedTuiCommand } from '../../tools/tui/operator/command.js';

const root = process.cwd(), { dir } = await prepareIsolatedTestCacheDir('tui-artifact-actions');
const repo = path.join(dir, 'selected repository'), bin = path.join(repo, 'commands');
await fs.mkdir(bin, { recursive: true });
await fs.copyFile(path.join(root, 'tests/fixtures/tui/operator-artifact-command.js'), path.join(bin, 'command.mjs'));
const clipboard = process.platform === 'win32' ? 'powershell' : process.platform === 'darwin' ? 'pbcopy' : 'wl-copy';
for (const [name, kind] of [['code', 'editor'], [clipboard, 'clipboard']]) {
  const file = path.join(bin, name + (process.platform === 'win32' ? '.cmd' : ''));
  await fs.writeFile(file, process.platform === 'win32'
    ? `@"${process.execPath}" "${path.join(bin, 'command.mjs')}" ${kind} %*\r\n`
    : `#!/bin/sh\nexec '${process.execPath}' '${path.join(bin, 'command.mjs')}' ${kind} "$@"\n`);
  await fs.chmod(file, 0o700);
}
const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, 'cache'), extraEnv: {
  PAIROFCLEATS_TRUSTED_CONFIG: null,
  PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo])
} });
const normalizedPath = normalizeEnvPathKeys(env);
env[normalizedPath.key] = bin + path.delimiter + normalizedPath.value;
for (const name of ['code', clipboard]) {
  assert.equal((await resolveTrustedTuiCommand({ names: [name], repoRoot: repo, toolRoot: root, env,
    prefix: 'FIXTURE_COMMAND' })).path, path.join(bin, name + (process.platform === 'win32' ? '.cmd' : '')));
}
const registry = createTuiArtifactRegistry(), actions = createTuiArtifactActions({ registry, toolRoot: root, env });
const bytes = Buffer.from([0, 1, 128, 255]), source = path.join(repo, 'binary report.bin');
await fs.writeFile(source, bytes);
const generation = registry.beginJob('source');
const capture = async target => {
  const inventory = await registry.capture({ sourceJobId: 'source', generation, artifacts: [
    bindArtifactScope({ path: target, label: 'Report' }, { root: repo, repoRoot: repo })] });
  return { sourceJobId: 'source', inventoryId: inventory.inventoryId, artifactId: inventory.artifacts[0].artifactId };
};
const calls = async () => (await fs.readFile(path.join(bin, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
try {
  const selection = await capture(source);
  const opened = await actions.execute('open', { ...selection, confirmed: true });
  assert.equal(opened.opened, true);
  assert.deepEqual((await calls())[0].args, ['--reuse-window', source]);
  assert.equal((await actions.execute('copy', selection)).copied, true);
  assert.equal((await calls())[1].input, source, 'the path goes through stdin, never shell interpolation');
  const untrusted = createTuiArtifactActions({ registry, toolRoot: root,
    env: { ...env, PAIROFCLEATS_TRUSTED_REPOS: '[]' } });
  for (const method of ['open', 'copy']) await assert.rejects(untrusted.execute(method,
    { ...selection, ...(method === 'open' ? { confirmed: true } : {}) }),
  { code: method === 'open' ? 'ERR_TUI_EDITOR_UNTRUSTED' : 'ERR_TUI_CLIPBOARD_UNTRUSTED' });
  await untrusted.dispose(); assert.equal((await calls()).length, 2);
  const destination = path.join(repo, 'exported.bin');
  const exported = await actions.execute('export', { ...selection, confirmed: true, destination: 'exported.bin' });
  assert.equal(exported.exported, true); assert.equal(exported.bytes, bytes.length);
  assert.deepEqual(await fs.readFile(destination), bytes);
  await assert.rejects(actions.execute('export', { ...selection, confirmed: true, destination }),
    { code: 'ERR_TUI_ARTIFACT_DESTINATION_EXISTS' });
  assert.deepEqual(await fs.readFile(destination), bytes);
  await assert.rejects(actions.execute('export', { ...selection, confirmed: true, destination: '../escape.bin' }),
    { code: 'ERR_UNSAFE_FILE_PATH' });
  const link = fs.link;
  fs.link = async (from, to) => {
    await fs.writeFile(from, Buffer.from([7, 7, 7, 7]));
    return link(from, to);
  };
  try {
    await assert.rejects(actions.execute('export', { ...selection, confirmed: true, destination: 'raced.bin' }),
      error => error.causeCode === 'ERR_FILE_INTEGRITY', 'staging mutation cannot be reported as a verified export');
  } finally { fs.link = link; }
  assert.deepEqual(await fs.readFile(path.join(repo, 'raced.bin')), Buffer.from([7, 7, 7, 7]),
    'mutation invalidates rollback authority; changed bytes remain preserved evidence');
  const openFile = fs.open;
  let verificationFaults = 0;
  fs.open = async (target, flags, ...args) => {
    const handle = await openFile.call(fs, target, flags, ...args);
    if (path.toNamespacedPath(path.resolve(String(target))) === path.toNamespacedPath(path.join(repo, 'failed-verification.bin'))) {
      verificationFaults++;
      handle.read = async () => { throw Object.assign(new Error('fixture export verification failed'), { code: 'EIO' }); };
    }
    return handle;
  };
  try {
    await assert.rejects(actions.execute('export', { ...selection, confirmed: true, destination: 'failed-verification.bin' }),
      { code: 'ERR_ATOMIC_WRITE' });
  } finally { fs.open = openFile; }
  assert.equal(verificationFaults, 1, 'the real published-file verification reader observed the injected failure');
  await assert.rejects(fs.stat(path.join(repo, 'failed-verification.bin')), { code: 'ENOENT' },
    'failed verification removes the unchanged, exactly owned new file after its reader closes');
  await fs.writeFile(source, Buffer.from([0, 1, 128, 254]));
  await assert.rejects(actions.execute('copy', selection), { code: 'ERR_FILE_INTEGRITY' });
  assert.equal((await calls()).length, 2);
  await fs.writeFile(source, bytes);
  const directory = await capture(repo);
  await assert.rejects(actions.execute('export', { ...directory, confirmed: true, destination: 'folder-copy' }),
    { code: 'ERR_TUI_ARTIFACT_TYPE' });
  await fs.unlink(source);
  await assert.rejects(actions.execute('open', { ...selection, confirmed: true }), { code: 'ERR_TUI_ARTIFACT_UNAVAILABLE' });

  for (const [method, params] of [['open', selection], ['copy', { ...selection, path: source }],
    ['export', { ...selection, confirmed: true, destination: 'a\nb' }]]) {
    assert.throws(() => assertTuiArtifactRequest(method, params), { code: 'ERR_TUI_ARTIFACT_REQUEST' });
  }
  for (const method of ['toString', 'constructor', '__proto__', 'unknown']) {
    assert.throws(() => assertTuiArtifactRequest(method, selection), { code: 'ERR_TUI_ARTIFACT_REQUEST' });
    await assert.rejects(actions.execute(method, selection), { code: 'ERR_TUI_ARTIFACT_REQUEST' });
  }
  await fs.writeFile(source, bytes);
  const current = await capture(source), controller = new AbortController();
  await fs.writeFile(path.join(bin, 'block'), 'explicit fixture hang');
  let pid, started;
  const spawned = new Promise(resolve => { started = resolve; });
  const running = actions.execute('open', { ...current, confirmed: true }, {
    signal: controller.signal, onSpawn: child => { pid = child.pid; started(); }
  });
  const rejected = assert.rejects(running, error => error.code === 'ABORT_ERR' || error.name === 'AbortError');
  await spawned;
  await assert.rejects(actions.execute('copy', current), { code: 'ERR_TUI_ARTIFACT_BUSY' });
  controller.abort(); await rejected;
  assert.ok(pid); assert.equal(isProcessAlive(pid), false, 'cancelled launcher is reaped');
} finally { await actions.dispose(); await registry.dispose(); }
console.log('artifact actions passed');
