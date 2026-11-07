#!/usr/bin/env node
// Authored actual-report fixture. Selected trusted inert runtime files and
// explicit probe adapters supply evidence; no language server/runtime executes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { buildToolingReport } from '../../../tools/tooling/utils.js';

const temporary = await makeTempDir('poc-tooling-report-readiness-');
try {
  const repo = path.join(temporary, 'repo'), bin = path.join(temporary, 'explicit-trusted-jdk-fixture', 'bin');
  await fs.mkdir(repo); await fs.mkdir(bin, { recursive: true });
  for (const name of ['java', 'javac']) await fs.writeFile(path.join(bin, name), 'inert trusted runtime fixture bytes');
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(temporary, 'home'), PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo]),
    PAIROFCLEATS_TRUSTED_CONFIG: null }, async () => {
    let serverProbes = 0, runtimeProbes = 0;
    const options = { skipScan: true, env: {},
      detectTool: async tool => { assert.equal(tool.id, 'jdtls'); serverProbes++; return { found: true,
        path: path.join(temporary, 'explicit-trusted-server-fixture'), source: 'fixture', probe: { ok: true } }; },
      resolvePrerequisite: name => path.join(bin, name), probePrerequisite: async command => {
        runtimeProbes++; assert.equal(command, path.join(bin, 'java'));
        return { ok: true, stderr: 'openjdk version "17.0.12"' };
      } };
    const blocked = await buildToolingReport(repo, ['java'], options);
    assert.equal(serverProbes, 1); assert.equal(runtimeProbes, 1, 'a rejected selected Java runtime prevents javac launch');
    const selected = blocked.tools[0];
    assert.equal(selected.found, false, 'installed server bytes cannot be reported available with an incompatible launch runtime');
    assert.equal(selected.executableFound, true, 'observed server location remains distinguishable from prerequisite readiness');
    assert.equal(selected.probe.ok, true);
    assert.equal(selected.provisioning.steps[0].reason, 'unsupported_runtime_version');
    assert.equal(selected.provisioning.steps[1].state, 'blocked');
    assert.equal(selected.readiness.consumer, 'not-qualified');
    const compatible = await buildToolingReport(repo, ['java'], { ...options, probePrerequisite: async command => ({ ok: true,
      stderr: command.endsWith('javac') ? 'javac 21.0.8' : 'openjdk version "21.0.8"' }) });
    assert.equal(compatible.tools[0].found, true);
    assert.equal(compatible.tools[0].readiness.state, 'executable-and-prerequisites-identified');
    assert.equal(compatible.tools[0].readiness.consumer, 'not-qualified', 'version/component probes do not fabricate language-server handshake qualification');
    let settled = false;
    const pending = Object.freeze(Object.assign(new Error('fixture prerequisite close pending'), {
      cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, pending); return settled; }
    }));
    let failure;
    try { await buildToolingReport(repo, ['java'], { ...options, probePrerequisite: async () => { throw pending; } }); }
    catch (error) { failure = error; }
    assert.equal(failure.cacheOwnershipReleased(), false, 'report cannot flatten a pending runtime into a retryable missing command');
    settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
    await assert.rejects(fs.stat(path.join(temporary, 'home', 'assets')), { code: 'ENOENT' }, 'read-only detection never prepares tool installation storage');
  });
} finally { await rmDirRecursive(temporary); }
console.log('Tooling detection reports launch prerequisites separately from executable presence and protocol qualification.');
