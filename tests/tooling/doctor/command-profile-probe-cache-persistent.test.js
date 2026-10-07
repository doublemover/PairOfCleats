#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  __getToolingCommandProbeCacheStatsForTests,
  __resetToolingCommandProbeCacheForTests,
  resolveToolingCommandProfile
} from '../../../src/index/tooling/command-resolver.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'command-profile-probe-cache-persistent');
const toolingDir = path.join(tempRoot, 'tooling');
const binDir = path.join(tempRoot, 'bin');
const fixtureCmd = path.join(
  binDir,
  process.platform === 'win32' ? 'persistent-tool.cmd' : 'persistent-tool'
);

const writeFixtureCommand = () => {
  fs.mkdirSync(binDir, { recursive: true });
  if (process.platform === 'win32') {
    fs.writeFileSync(fixtureCmd, '@echo off\r\necho persistent tool 1.0\r\n', 'utf8');
    return;
  }
  fs.writeFileSync(fixtureCmd, '#!/usr/bin/env sh\nprintf \'persistent tool 1.0\\n\'\n', 'utf8');
  fs.chmodSync(fixtureCmd, 0o755);
};

try {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  writeFixtureCommand();

  __resetToolingCommandProbeCacheForTests();
  const first = resolveToolingCommandProfile({
    providerId: 'persistent-probe',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: toolingDir, cache: { dir: toolingDir } }
  });
  assert.equal(first.probe.ok, true, 'expected initial probe success');
  assert.equal(first.probe.cached, false, 'expected initial probe cache miss');

  const firstStats = __getToolingCommandProbeCacheStatsForTests();
  assert.equal(firstStats.persistentWrites >= 1, true, 'expected persistent probe cache write');

  __resetToolingCommandProbeCacheForTests();
  const second = resolveToolingCommandProfile({
    providerId: 'persistent-probe',
    cmd: fixtureCmd,
    args: [],
    repoRoot: root,
    toolingConfig: { dir: toolingDir, cache: { dir: toolingDir } }
  });
  assert.equal(second.probe.ok, true, 'expected persistent cache probe success');
  assert.equal(second.probe.cached, true, 'expected persistent cache hit');
  assert.equal(second.probe.cacheSource, 'persistent', 'expected persistent cache source');

  const secondStats = __getToolingCommandProbeCacheStatsForTests();
  assert.equal(secondStats.persistentHits >= 1, true, 'expected persistent cache hit stats');

  console.log('tooling doctor command profile persistent probe cache test passed');
} finally {
  __resetToolingCommandProbeCacheForTests();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
