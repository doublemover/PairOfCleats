import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { observeProviderProfile, verifyProviderProfileReceipt } from '../../../src/index/tooling/provider-profile.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

// UNVALIDATED: bounded actual profile reads and original failure observations.
// No compiler, command probe, installer or child process is started.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['snapshot', 'file-budget', 'negative-pending', 'negative-unmarked', 'negative-settled',
  'verification-pending', 'executable-pending', 'frozen', 'diagnostic-order'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`profile-declaration-${selected}`);
const sha = text => createHash('sha256').update(text).digest('hex');
for (const [name, bytes] of Object.entries({ 'tool-a': 'original tool', 'tool-b': 'replacement tool',
  'source.fixture': 'original source', 'replacement.fixture': 'replacement source',
  'project-a.json': '{}', 'project-b.json': '{"changed":true}', 'dependency-a': 'original dependency', 'dependency-b': 'replacement dependency' })) {
  await fs.writeFile(path.join(dir, name), bytes);
}
const request = () => ({ repoRoot: dir, providerId: 'fixture', adapterVersion: '1', apiProfile: 'fixture-v1',
  configuredCommand: [path.join(dir, 'tool-a')], resolvedCommand: [path.join(dir, 'tool-a')],
  toolFiles: [{ path: 'tool-a' }], sourceInputs: [{ path: 'source.fixture', hash: sha('original source') }],
  capabilities: ['types'], dependencyClosure: 'complete',
  project: { files: [{ path: 'project-a.json' }], dependencies: [{ path: 'dependency-a' }, { path: 'absent-dependency', absent: true }],
    variant: 'original-variant', targets: ['source.fixture'], vfsMappings: [{ id: 'original' }] } });
const original = { realpath: fs.realpath, lstat: fs.lstat };
let settled = selected === 'negative-settled', failure, release, inspections = 0;
const pending = Object.freeze(Object.defineProperty(Object.assign(new Error('original unresolved file observation'), {
  ...(selected === 'negative-pending' ? { cacheOwnershipPending: true } : {}),
  cacheOwnershipReleased() { assert.equal(this, pending); return settled; }
}), 'code', { get() { inspections++; if (selected === 'diagnostic-order') throw new Error('diagnostics must not be inspected before settlement'); return 'ENOENT'; } }));
try {
  if (selected === 'snapshot') {
    const baseline = await observeProviderProfile(request()), input = request();
    let entered; const ready = new Promise(resolve => { entered = resolve; });
    let intercepted = false;
    fs.realpath = async (filename, ...args) => {
      if (!intercepted && filename === dir) { intercepted = true; entered(); await new Promise(resolve => { release = resolve; }); }
      return original.realpath(filename, ...args);
    };
    const observing = observeProviderProfile(input); await ready;
    input.toolFiles[0].path = 'tool-b'; input.sourceInputs[0] = { path: 'replacement.fixture', hash: sha('replacement source') };
    input.configuredCommand[0] = path.join(dir, 'tool-b'); input.resolvedCommand[0] = path.join(dir, 'tool-b');
    input.capabilities.push('diagnostics'); input.project.files[0].path = 'project-b.json';
    input.project.dependencies[0].path = 'dependency-b'; input.project.dependencies[1].path = 'now-another-negative';
    input.project.variant = 'replacement-variant'; input.project.targets.push('replacement.fixture'); input.project.vfsMappings[0].id = 'replacement';
    release(); const observed = await observing;
    assert.equal(observed.profileHash, baseline.profileHash); assert.deepEqual(observed, baseline);
  } else if (selected === 'file-budget') {
    let reads = 0;
    fs.realpath = async (...args) => { reads++; return original.realpath(...args); };
    await assert.rejects(observeProviderProfile({ ...request(), maxFiles: 4 }), { code: 'ERR_TOOLING_PROFILE_IDENTITY' });
    assert.equal(reads, 0, 'declared inventories must fit before any filesystem observation');
  } else if (selected === 'frozen') {
    const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
    const input = freeze(request()), before = JSON.stringify(input), observed = await observeProviderProfile(input);
    assert.equal(observed.durable, true); assert.equal(JSON.stringify(input), before); assert.ok(Object.isFrozen(observed));
  } else {
    const profile = selected === 'verification-pending' ? await observeProviderProfile(request()) : null;
    if (selected === 'executable-pending') fs.realpath = async (filename, ...args) => {
      if (filename === path.join(dir, 'tool-a')) throw pending;
      return original.realpath(filename, ...args);
    };
    else fs.lstat = async (filename, ...args) => {
      if (filename === path.join(dir, 'absent-dependency')) throw pending;
      return original.lstat(filename, ...args);
    };
    const operation = profile ? verifyProviderProfileReceipt(profile) : observeProviderProfile(request());
    if (selected === 'negative-settled') {
      const observed = await operation; assert.equal(observed.durable, true);
      assert.equal(observed.project.dependencies.find(entry => entry.path.endsWith('absent-dependency')).state, 'absent');
    } else {
      await assert.rejects(operation, error => { failure = error; return errorGraphIncludes(error, pending); });
      assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(inspections, 0, 'pending ownership precedes even code inspection');
      settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
    }
  }
} finally {
  settled = true; release?.(); fs.realpath = original.realpath; fs.lstat = original.lstat;
  assert.ok(path.resolve(dir).startsWith(path.resolve(path.dirname(dir)) + path.sep));
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`Provider profile declaration lifetime: ${selected}`);
