#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sleep } from '../../../src/shared/sleep.js';
import {
  __getToolingCommandProbeCacheStatsForTests,
  __resetToolingCommandProbeCacheForTests,
  resolveToolingCommandProfile
} from '../../../src/index/tooling/command-resolver.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'command-profile-probe-cache-fingerprint-invalidation');
const toolingDir = path.join(tempRoot, 'tooling');
const binDir = path.join(tempRoot, 'bin');
const fixtureCmd = path.join(
  binDir,
  process.platform === 'win32' ? 'fingerprint-tool.cmd' : 'fingerprint-tool'
);

const writeFixtureCommand = (version) => {
  fs.mkdirSync(binDir, { recursive: true });
  if (process.platform === 'win32') {
    fs.writeFileSync(fixtureCmd, `@echo off\r\necho fingerprint tool ${version}\r\n`, 'utf8');
    return;
  }
  fs.writeFileSync(fixtureCmd, `#!/usr/bin/env sh\nprintf 'fingerprint tool ${version}\\n'\n`, 'utf8');
  fs.chmodSync(fixtureCmd, 0o755);
};

try {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  writeFixtureCommand('1.0');

  __resetToolingCommandProbeCacheForTests();
  const first = resolveToolingCommandProfile({
    providerId: 'fingerprint-probe',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: toolingDir, cache: { dir: toolingDir } }
  });
  assert.equal(first.probe.ok, true, 'expected initial probe success');
  assert.equal(first.probe.cached, false, 'expected initial probe cache miss');

  await sleep(30);
  writeFixtureCommand('2.0');

  __resetToolingCommandProbeCacheForTests();
  const second = resolveToolingCommandProfile({
    providerId: 'fingerprint-probe',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: toolingDir, cache: { dir: toolingDir } }
  });
  assert.equal(second.probe.ok, true, 'expected probe success after command rewrite');
  assert.equal(second.probe.cached, false, 'expected fingerprint change to bypass persistent cache');

  const stats = __getToolingCommandProbeCacheStatsForTests();
  assert.equal(stats.persistentHits, 0, 'expected no persistent hit after fingerprint change');
  assert.equal(stats.persistentWrites >= 1, true, 'expected persistent cache refresh after fingerprint change');

  console.log('tooling doctor command profile probe cache fingerprint invalidation test passed');
} finally {
  __resetToolingCommandProbeCacheForTests();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
