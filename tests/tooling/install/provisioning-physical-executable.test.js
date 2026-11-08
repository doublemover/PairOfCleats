import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { identifyProvisioningExecutable, createToolProvisioningPlan, verifyToolProvisioningPlan,
  bindProvisioningCommand } from '../../../tools/tooling/provisioning-plan.js';

// UNVALIDATED: actual bounded byte/plan owners; inert probes, no physical links.
const temporary = await makeTempDir('poc-provisioning-physical-');
try {
  const selected = path.join(temporary, 'selected-runtime');
  const replacement = path.join(temporary, 'different-runtime');
  const alias = path.join(temporary, 'launcher-alias');
  const bytes = 'original selected fixture runtime bytes; never executed';
  await fsp.writeFile(selected, bytes);
  await fsp.writeFile(replacement, bytes);
  const readFile = fs.readFileSync;
  try {
    fs.readFileSync = (target, ...args) => { if (target === selected) throw new Error('unchecked pathname read is forbidden'); return readFile(target, ...args); };
    const identity = identifyProvisioningExecutable(selected);
    assert.equal(identity.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(identity.size, Buffer.byteLength(bytes));
  } finally { fs.readFileSync = readFile; }

  const tool = { id: 'physical-runtime-fixture', prerequisites: [{ id: 'node', command: alias, family: 'node', phase: 'launch', dependsOn: [] }] };
  const selection = { scope: 'cache', plan: null };
  const realpath = fs.realpathSync;
  let aliasTarget = selected, redirectSelected = false;
  try {
    fs.realpathSync = (target, ...args) => target === alias ? aliasTarget
      : redirectSelected && target === selected ? replacement : realpath(target, ...args);
    const preview = createToolProvisioningPlan({ tool, selection });
    assert.equal(preview.steps[0].command, selected);
    assert.equal(preview.steps[0].executable.path, selected);
    aliasTarget = replacement;
    const savedAliasPlan = { ...preview, steps: preview.steps.map(step => ({ ...step, command: alias })) };
    const launched = [];
    const verified = await verifyToolProvisioningPlan(savedAliasPlan, { probe: async command => {
      launched.push(command);
      return { ok: true, stdout: 'v26.12.1' };
    } });
    assert.deepEqual(launched, [selected], 'async verification executes the identified physical path, including prior alias-shaped plans');
    assert.equal(verified.steps[0].command, selected);
    assert.equal(bindProvisioningCommand({ cmd: 'node', requires: 'node', args: ['inert'] }, verified, {}).command, selected);
    redirectSelected = true;
    await assert.rejects(verifyToolProvisioningPlan(preview, { probe: async () => assert.fail('changed physical selection must not probe') }),
      /changed before async verification/, 'matching bytes at another physical path do not preserve selection identity');
    assert.throws(() => bindProvisioningCommand({ cmd: 'node', requires: 'node', args: [] }, verified, {}), /changed after verification/);
    redirectSelected = false;
    aliasTarget = selected;
    let syncProbes = 0;
    assert.throws(() => createToolProvisioningPlan({ tool, selection, probe: command => {
      assert.equal(command, selected);
      syncProbes++;
      fs.writeFileSync(selected, 'changed during the recognized version probe');
      return { ok: true, stdout: 'v26.12.1' };
    } }), /changed during verification/, 'a successful version probe cannot bless replacement bytes as its original executable');
    assert.equal(syncProbes, 1);
    await fsp.writeFile(selected, bytes);

    const trusted = createToolProvisioningPlan({ tool, selection, isAllowed: command => command !== selected,
      probe: () => assert.fail('untrusted physical target cannot probe') });
    assert.equal(trusted.steps[0].reason, 'command-missing-or-untrusted');
    assert.equal(trusted.steps[0].command, selected);
    const cancelled = new AbortController();
    let asyncProbes = 0;
    await assert.rejects(verifyToolProvisioningPlan(preview, { signal: cancelled.signal, probe: async () => {
      asyncProbes++; cancelled.abort(new Error('cancelled exact prerequisite probe')); return { ok: false, stdout: '' };
    } }), /cancelled exact prerequisite probe/);
    assert.equal(asyncProbes, 1);
    assert.throws(() => createToolProvisioningPlan({ tool, selection, signal: cancelled.signal,
      probe: () => assert.fail('already cancelled planning cannot probe') }), /cancelled exact prerequisite probe/);
  } finally { fs.realpathSync = realpath; }
} finally { await rmDirRecursive(temporary); }
console.log('Provisioning verification binds the selected physical executable and rejects drift.');
