#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  __resetToolingCommandProbeCacheForTests,
  probeLspInitializeHandshake,
  resolveToolingCommandProfile
} from '../../../src/index/tooling/command-resolver.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `command-profile-probe-cache-invalidate-launch-failure-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const launchFailScriptPath = path.join(tempRoot, 'launch-fail-probe-ok.js');
await fs.writeFile(launchFailScriptPath, [
  '#!/usr/bin/env node',
  "const first = String(process.argv[2] || '').toLowerCase();",
  "if (first === '--version' || first === 'version' || first === '--help' || first === 'help' || first === '-h') {",
  "  process.stdout.write('probe-ok\\n');",
  '  process.exit(0);',
  '}',
  "process.stderr.write('launch failed intentionally\\n');",
  'process.exit(1);'
].join('\n'), 'utf8');

const providerId = 'cache-launch-failure';

try {
  __resetToolingCommandProbeCacheForTests();

  const first = resolveToolingCommandProfile({
    providerId,
    cmd: process.execPath,
    args: [launchFailScriptPath],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(first.probe.ok, true, 'expected initial probe success');
  assert.equal(first.probe.cached, false, 'expected initial probe cache miss');

  const second = resolveToolingCommandProfile({
    providerId,
    cmd: process.execPath,
    args: [launchFailScriptPath],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(second.probe.ok, true, 'expected second probe success');
  assert.equal(second.probe.cached, true, 'expected second probe cache hit before launch failure');

  const handshake = await probeLspInitializeHandshake({
    providerId,
    cmd: process.execPath,
    args: [launchFailScriptPath],
    cwd: root,
    timeoutMs: 1200
  });
  assert.equal(handshake.ok, false, 'expected initialize handshake failure for launch-fail command');

  const third = resolveToolingCommandProfile({
    providerId,
    cmd: process.execPath,
    args: [launchFailScriptPath],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(third.probe.ok, true, 'expected probe success after invalidation-triggered reprobe');
  assert.equal(third.probe.cached, false, 'expected launch failure to invalidate cached probe success');

  console.log('tooling doctor command profile launch-failure cache invalidation test passed');
} finally {
  __resetToolingCommandProbeCacheForTests();
  await fs.rm(tempRoot, { recursive: true, force: true });
}
