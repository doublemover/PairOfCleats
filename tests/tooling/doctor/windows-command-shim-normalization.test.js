#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createToolingDoctorTempRoot,
  runToolingDoctorFixture
} from '../../helpers/tooling-doctor-fixture.js';

const tempRoot = await createToolingDoctorTempRoot('tooling-doctor-windows-command-shim-normalization');

const resolveCommandProfile = ({ cmd, args = [] }) => {
  const normalizedCmd = String(cmd || '').trim().toLowerCase();
  if (normalizedCmd === 'jdtls') {
    return {
      requested: { cmd, args },
      resolved: {
        cmd: 'jdtls.cmd',
        args,
        mode: 'direct',
        source: 'mock'
      },
      probe: {
        ok: true,
        attempted: [{ cmd, args }],
        resolvedPath: 'jdtls.cmd'
      }
    };
  }
  if (normalizedCmd === 'java') {
    return {
      requested: { cmd, args },
      resolved: {
        cmd: 'java',
        args,
        mode: 'direct',
        source: 'mock'
      },
      probe: {
        ok: false,
        attempted: [{ cmd, args }],
        resolvedPath: null
      }
    };
  }
  return {
    requested: { cmd, args },
    resolved: {
      cmd,
      args,
      mode: 'direct',
      source: 'mock'
    },
    probe: {
      ok: true,
      attempted: [{ cmd, args }],
      resolvedPath: String(cmd || '')
    }
  };
};

const report = await runToolingDoctorFixture({
  tempRoot,
  enabledTools: ['jdtls'],
  resolveCommandProfile
});

const provider = (report.providers || []).find((entry) => entry.id === 'jdtls');
assert.ok(provider, 'expected jdtls provider report');

const runtimeCheck = (provider.checks || []).find((check) => check.name === 'jdtls-runtime-java');
assert.ok(runtimeCheck, 'expected Java runtime check when jdtls resolves through .cmd shim');
assert.equal(runtimeCheck.status, 'error', 'expected Java runtime check to fail for missing java command');

const workspaceCheck = (provider.checks || []).find((check) => check.name === 'jdtls-workspace-model');
assert.ok(workspaceCheck, 'expected workspace-model check when jdtls resolves through .cmd shim');
assert.equal(workspaceCheck.status, 'warn', 'expected warn without workspace model markers');

console.log('tooling doctor windows command shim normalization test passed');
