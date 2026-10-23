import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { probeLspInitializeHandshake, resolveToolingCommandProfile } from '../../../src/index/tooling/command-resolver.js';
import { createLspProviderTempRepo, resolveLspStubServerPath } from '../../helpers/lsp-provider-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

// Authored actual handshake-consumer regression; selected Node protocol fixtures
// do not qualify SourceKit, Phpactor, a CLR assembly or a real language toolchain.
const commandName = process.platform === 'win32' ? 'untrusted-handshake.cmd' : 'untrusted-handshake';
const root = await createLspProviderTempRepo({ name: 'handshake-admission-cancel', files: [
  { path: 'Package.swift', content: '// swift-tools-version: 6.2\nimport PackageDescription\nlet package = Package(name: "Fixture")\n' },
  { path: commandName, content: process.platform === 'win32'
    ? '@echo off\r\necho executed>handshake-executed.marker\r\nexit /b 0\r\n'
    : '#!/bin/sh\ntouch handshake-executed.marker\n' }
] });
const emptyRoot = path.join(root, 'installation-only');
await fs.mkdir(emptyRoot);
const args = [resolveLspStubServerPath(), '--mode', 'generic'];
try {
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]' }, async () => {
    for (const providerId of ['csharp-ls', 'phpactor', 'sourcekit', 'fsautocomplete']) {
      const profile = resolveToolingCommandProfile({ providerId, cmd: 'must-not-be-probed', repoRoot: root });
      assert.equal(profile.resolved.mode, 'blocked', `${providerId}: direct profile honors current workspace admission`);
      assert.match(profile.probe.validationFailure.reasonCode, /workspace_trust_required$/u);
      const denied = await probeLspInitializeHandshake({ providerId, cmd: process.execPath, args, cwd: root });
      assert.equal(denied.ok, false);
      assert.match(denied.errorCode, /workspace_trust_required$/u);
    }
    const denied = await probeLspInitializeHandshake({ providerId: 'fixture', cmd: path.join(root, commandName), cwd: root });
    assert.equal(denied.errorCode, 'untrusted-repository-command');
    await assert.rejects(fs.access(path.join(root, 'handshake-executed.marker')), { code: 'ENOENT' });
  });
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([root, emptyRoot]) }, async () => {
    for (const sourcekitOperationPlan of [null, { identity: 'forged' }]) {
      const events = [];
      const denied = await probeLspInitializeHandshake({ providerId: 'sourcekit', cmd: process.execPath, args,
        cwd: root, sourcekitOperationPlan, onLifecycleEvent: event => events.push(event) });
      assert.equal(denied.ok, false, 'trust alone never authorizes a package-loading SourceKit handshake');
      assert.equal(denied.errorCode, 'ERR_SOURCEKIT_OPERATION_PLAN');
      assert.equal(events.length, 0, 'passive admission runs before a client can spawn');
    }
    let settled = null;
    const positive = await probeLspInitializeHandshake({ providerId: 'sourcekit', cmd: process.execPath, args,
      cwd: emptyRoot, timeoutMs: 1500, onMetrics: metrics => { settled = metrics.termination; } });
    assert.equal(positive.ok, true, 'an explicitly selected trusted empty installation workspace remains usable');
    assert.equal(positive.capabilityEvidence, 'initialize-advertisement');
    assert.equal(settled.settled, true);

    const preaborted = new AbortController();
    preaborted.abort();
    let starts = 0;
    await assert.rejects(probeLspInitializeHandshake({ providerId: 'pyright', cmd: process.execPath, args, cwd: root,
      signal: preaborted.signal, onLifecycleEvent: () => { starts += 1; } }), { name: 'AbortError', code: 'ABORT_ERR' });
    assert.equal(starts, 0, 'pre-aborted consumers never acquire a child');

    for (const signalField of ['signal', 'abortSignal']) {
      const controller = new AbortController();
      const events = [];
      let metrics = null;
      await assert.rejects(probeLspInitializeHandshake({ providerId: 'pyright', cmd: process.execPath,
        args: [resolveLspStubServerPath(), '--mode', 'stall-initialize'], cwd: root, timeoutMs: 1500,
        [signalField]: controller.signal,
        onLifecycleEvent(event) {
          events.push(event);
          if (event.kind === 'start') queueMicrotask(() => controller.abort());
        },
        onMetrics(value) { metrics = value; }
      }), { name: 'AbortError', code: 'ABORT_ERR' });
      assert.equal(events.filter(event => event.kind === 'start').length, 1);
      assert.ok(events.some(event => event.kind === 'kill'), 'cancellation reaches the original transport owner');
      assert.equal(metrics.termination.settled, true, 'cancel rejection follows exact child/stream/tree settlement');
      assert.equal(metrics.termination.pendingChildren, 0);
    }
  });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Direct handshake admission and cancellation retain command, passive workspace and exact teardown authority');
